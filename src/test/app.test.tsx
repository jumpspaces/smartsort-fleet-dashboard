// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App.tsx'
import { clearCache } from '../lib/query.ts'
import { alert, device, fakeServer, overview, shellRoutes, signedIn } from './fakeServer.ts'

beforeEach(() => {
  localStorage.clear()
  clearCache()
  window.location.hash = ''
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('signing in', () => {
  it('trades credentials for a session and lands on Home', async () => {
    const server = fakeServer([
      {
        method: 'POST',
        path: '/fleet/login',
        reply: { accessToken: 'a', refreshToken: 'r', operator: { id: 'op1', email: 'ama@x.co', name: 'Ama', role: 'operator' } },
      },
      ...shellRoutes,
      { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } },
      { path: '/fleet/alerts', reply: { alerts: [] } },
    ])
    render(<App />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ama@x.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://cloud.test/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Every till is working')).toBeTruthy()
    expect(server.calls[0]).toMatchObject({ method: 'POST', path: '/fleet/login', body: { email: 'ama@x.co', password: 'secret-password' } })
    expect(JSON.parse(localStorage.getItem('fleet_session')!).apiBase).toBe('https://cloud.test')
  })

  it('shows the server’s reason when sign-in is refused', async () => {
    fakeServer([{ method: 'POST', path: '/fleet/login', status: 401, reply: { message: 'Wrong email or password.' } }])
    render(<App />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://cloud.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy()
  })
})

describe('Home', () => {
  it('folds a shop’s offline tills into one line and counts open alerts', async () => {
    signedIn()
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/devices',
        reply: {
          devices: [
            device({ deviceId: 'd1', machineName: 'Front', state: 'offline', reasons: [{ code: 'offline', label: 'x', severity: 'critical' }] }),
            device({ deviceId: 'd2', machineName: 'Back', state: 'offline', reasons: [{ code: 'offline', label: 'x', severity: 'critical' }] }),
            device({ deviceId: 'd3' }),
          ],
          total: 3,
          limit: 200,
          offset: 0,
        },
      },
      { path: '/fleet/alerts', reply: { alerts: [alert()] } },
    ])
    render(<App />)
    const card = (await screen.findByText('Needs attention')).closest('section')!
    await within(card).findByText('Kumasi Mart')
    expect(within(card).getAllByText('Not connected')).toHaveLength(1)
    expect(within(card).getByText('Front')).toBeTruthy()
    expect(within(card).getByText('Back')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText(String(overview.openAlerts))).toBeTruthy()
  })
})

describe('Alerts', () => {
  it('takes an alert and refetches the list', async () => {
    signedIn('operator')
    let acked = false
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/rules', reply: { rules: [] } },
      { path: '/fleet/alerts', reply: () => ({ alerts: acked ? [] : [alert()] }) },
      {
        method: 'POST',
        path: '/fleet/alerts/al1/ack',
        reply: () => {
          acked = true
          return {}
        },
      },
    ])
    render(<App />)
    await go('#/alerts')
    fireEvent.click(await screen.findByRole('button', { name: "I'm on it" }))
    expect(await screen.findByText('No open alerts')).toBeTruthy()
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/fleet/alerts/al1/ack')).toBe(true)
  })

  it('gives a viewer no buttons that change anything', async () => {
    signedIn('viewer')
    fakeServer([...shellRoutes, { path: '/fleet/rules', reply: { rules: [] } }, { path: '/fleet/alerts', reply: { alerts: [alert()] } }])
    render(<App />)
    await go('#/alerts')
    await screen.findByText('Not connected')
    expect(screen.queryByRole('button', { name: "I'm on it" })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull()
  })
})

describe('Tills', () => {
  it('sends filters from the URL to the server and shows the rows', async () => {
    signedIn()
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/tags', reply: { tags: [{ tag: 'pilot', devices: 1 }] } },
      { path: '/fleet/commands', reply: { commands: [] } },
      { path: '/fleet/devices', reply: { devices: [device()], total: 1, limit: 50, offset: 0 } },
    ])
    render(<App />)
    await go('#/tills?version=2.3.1&tag=pilot&removed=1')
    expect(await screen.findByText('Front till')).toBeTruthy()
    expect(screen.getByText('GHS 1,234.50')).toBeTruthy()
    const list = server.calls.find((c) => c.path === '/fleet/devices' && c.search.includes('limit=50'))!
    const q = new URLSearchParams(list.search)
    expect(q.get('version')).toBe('2.3.1')
    expect(q.get('tag')).toBe('pilot')
    expect(q.get('includeRemoved')).toBe('1')
  })

  it('runs a bulk fix on every matching till, skipping unlinked ones', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/tags', reply: { tags: [] } },
      { path: '/fleet/commands', reply: { commands: [{ name: 'sync.now', label: 'Force sync', description: 'Sends now.' }, { name: 'server.restart', label: 'Restart', description: '' }] } },
      {
        path: '/fleet/devices',
        reply: { devices: [device({ deviceId: 'd1' }), device({ deviceId: 'd2', keyVerified: false })], total: 2, limit: 200, offset: 0 },
      },
      { method: 'POST', path: /^\/fleet\/devices\/[^/]+\/commands$/, reply: { command: {} } },
    ])
    render(<App />)
    await go('#/tills')
    fireEvent.click(await screen.findByRole('button', { name: 'Act on 2 tills' }))
    const select = await screen.findByLabelText('What to do')
    // Restarting is never offered in bulk.
    expect(within(select).queryByText('Restart')).toBeNull()
    fireEvent.change(select, { target: { value: 'cmd:sync.now' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText(/Done for 1 till\./)).toBeTruthy()
    expect(screen.getByText(/Skipped 1 not linked/)).toBeTruthy()
    const posts = server.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/commands'))
    expect(posts.map((p) => p.path)).toEqual(['/fleet/devices/d1/commands'])
    expect(posts[0]!.body).toEqual({ command: 'sync.now' })
  })
})

describe('session expiry', () => {
  it('drops back to sign-in when the refresh is refused', async () => {
    signedIn()
    fakeServer([
      { path: '/fleet/overview', status: 401, reply: {} },
      { path: '/fleet/assistant', status: 401, reply: {} },
      { path: '/fleet/devices', status: 401, reply: {} },
      { path: '/fleet/alerts', status: 401, reply: {} },
      { method: 'POST', path: '/fleet/refresh', status: 401, reply: {} },
    ])
    render(<App />)
    expect(await screen.findByText('Your session ended. Sign in to carry on.')).toBeTruthy()
    expect(localStorage.getItem('fleet_session')).toBeNull()
  })
})

describe('keyboard', () => {
  it('opens the go-to box with Ctrl+K and finds a page', async () => {
    signedIn()
    fakeServer([...shellRoutes, { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } }, { path: '/fleet/alerts', reply: { alerts: [] } }])
    render(<App />)
    await screen.findByText('Every till is working')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const box = await screen.findByPlaceholderText('Go to a page, shop or till…')
    fireEvent.change(box, { target: { value: 'backu' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(window.location.hash).toBe('#/backups'))
  })
})

describe('Updates', () => {
  it('starts a staged update on linked tills only, then stops it', async () => {
    signedIn('operator')
    const rollout = {
      id: 'r1',
      version: '2.3.1',
      note: null,
      targetLabel: 'Every till',
      state: 'canary',
      canaryPercent: 10,
      haltErrorDevices: 2,
      observeMinutes: 30,
      canaryIssuedAt: null,
      promotedAt: null,
      completedAt: null,
      haltedAt: null,
      haltReason: null,
      createdByLabel: 'ama',
      createdAt: '2026-11-16T09:00:00Z',
      progress: { total: 1, pending: 1, issued: 0, updated: 0, failed: 0, skipped: 0, reverted: 0, canaryTotal: 1, canaryUpdated: 0 },
      targets: [],
    }
    let halted = false
    const server = fakeServer([
      ...shellRoutes.map((r) => (r.path === '/fleet/overview' ? { ...r, reply: { ...overview, release: { ...overview.release, latestVersion: '2.4.0', rollableVersions: ['2.4.0'] } } } : r)),
      { path: '/fleet/rollouts', reply: { rollouts: [], active: null } },
      {
        path: '/fleet/devices',
        reply: { devices: [device({ deviceId: 'd1' }), device({ deviceId: 'd2', keyVerified: false }), device({ deviceId: 'd3', appVersion: '2.4.0' })], total: 3, limit: 200, offset: 0 },
      },
      { method: 'POST', path: '/fleet/rollouts', reply: { rollout: { ...rollout, version: '2.4.0' } } },
      { path: '/fleet/rollouts/r1', reply: () => ({ rollout: { ...rollout, state: halted ? 'halted' : 'canary' } }) },
      {
        method: 'POST',
        path: '/fleet/rollouts/r1/halt',
        reply: () => {
          halted = true
          return {}
        },
      },
    ])
    render(<App />)
    await go('#/updates')
    fireEvent.click(await screen.findByRole('button', { name: 'Start an update' }))
    await screen.findByRole('option', { name: /2\.4\.0/ })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    fireEvent.click(await screen.findByRole('link', { name: 'Watch it' }))
    const created = server.calls.find((c) => c.method === 'POST' && c.path === '/fleet/rollouts')!
    // Unlinked tills can't take commands; ones already on it don't need it.
    expect((created.body as { deviceIds: string[] }).deviceIds).toEqual(['d1'])
    expect(created.body).toMatchObject({ version: '2.4.0', canaryPercent: 10 })
    await go('#/updates/r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop it' }))
    expect(await screen.findAllByText('Stopped')).not.toHaveLength(0)
  })

  it('refuses to start when no signed version is published', async () => {
    signedIn('operator')
    fakeServer([
      ...shellRoutes.map((r) => (r.path === '/fleet/overview' ? { ...r, reply: { ...overview, release: { ...overview.release, rollableVersions: [] } } } : r)),
      { path: '/fleet/rollouts', reply: { rollouts: [], active: null } },
    ])
    render(<App />)
    await go('#/updates')
    fireEvent.click(await screen.findByRole('button', { name: 'Start an update' }))
    expect(await screen.findByText(/no signed package/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Shop features', () => {
  it('asks for a reason before switching a feature off, then sends it', async () => {
    signedIn('operator')
    const shop = { id: 's1', name: 'Kumasi Mart', code: 'KM', location: null, phone: null, currency: 'GHS', createdAt: '2026-10-01T00:00:00Z', owner: null, activated: true, hasLiveClaimCode: false, claimCodeExpiresAt: null, health: { healthy: 1, attention: 0, offline: 0 }, machines: [] }
    const edition = (on: boolean) => ({
      shopId: 's1',
      businessType: 'pharmacy',
      businessTypes: ['pharmacy'],
      version: 1,
      setupCompletedAt: null,
      features: [{ key: 'expiry', label: 'Expiry dates', description: '', built: true, enabled: on, source: null, reason: null, changedBy: null, changedAt: null, minAppVersion: null }],
    })
    let on = true
    const server = fakeServer([
      ...shellRoutes.map((r) => (r.path === '/api/stores' ? { ...r, reply: { shops: [shop] } } : r)),
      { path: '/api/stores/s1/edition', reply: () => edition(on) },
      {
        method: 'PUT',
        path: '/api/stores/s1/edition',
        reply: (req: { body: unknown }) => {
          on = (req.body as { features: Record<string, boolean> }).features.expiry!
          return edition(on)
        },
      },
    ])
    render(<App />)
    await go('#/shops/s1?tab=features')
    const sw = await screen.findByRole('switch', { name: 'Expiry dates' })
    fireEvent.click(sw)
    expect(await screen.findByText(/Say why you’re switching it off/)).toBeTruthy()
    expect(server.calls.some((c) => c.method === 'PUT')).toBe(false)
    fireEvent.change(screen.getByLabelText('Reason for the change'), { target: { value: 'Shop asked' } })
    fireEvent.click(sw)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Expiry dates' }).getAttribute('aria-checked')).toBe('false'))
    expect(server.calls.find((c) => c.method === 'PUT')!.body).toEqual({ features: { expiry: false }, reason: 'Shop asked' })
  })
})

describe('Shop machines', () => {
  it('renames a till and removes one only after confirming', async () => {
    signedIn('operator')
    const machine = { keyId: 'k1', machineId: 'm1', machineName: null, terminalCode: 'T1', mode: 'exclusive', keyPrefix: 'sk_ab', createdAt: '2026-10-01T00:00:00Z', lastSeenAt: null, revokedAt: null, removedAt: null, lastReportAt: null }
    const shop = { id: 's1', name: 'Kumasi Mart', code: 'KM', location: null, phone: null, currency: 'GHS', createdAt: '2026-10-01T00:00:00Z', owner: null, activated: true, hasLiveClaimCode: false, claimCodeExpiresAt: null, health: { healthy: 0, attention: 0, offline: 0 }, machines: [machine] }
    const server = fakeServer([
      ...shellRoutes.map((r) => (r.path === '/api/stores' ? { ...r, reply: { shops: [shop] } } : r)),
      { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } },
      { method: 'POST', path: '/api/stores/keys/k1/rename', reply: { machineName: 'Front' } },
      { method: 'POST', path: '/api/stores/keys/k1/remove', reply: {} },
    ])
    render(<App />)
    await go('#/shops/s1')
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Till name'), { target: { value: 'Front' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.calls.find((c) => c.path.endsWith('/rename'))?.body).toEqual({ machineName: 'Front' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(server.calls.some((c) => c.path.endsWith('/remove'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from shop' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'POST' && c.path.endsWith('/remove'))).toBe(true))
  })
})

describe('sign-in page', () => {
  it('remembers a returning operator: server collapsed, email filled, password focused', async () => {
    localStorage.setItem('fleet_api_base', 'https://cloud.test')
    localStorage.setItem('fleet_last_email', 'ama@x.co')
    fakeServer([{ path: '/health', reply: { ok: true } }])
    render(<App />)
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ama@x.co')
    expect(document.activeElement?.id).toBe('password')
    expect(screen.queryByLabelText('Server address')).toBeNull()
    expect(await screen.findByText(/Reachable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change server' }))
    expect((screen.getByLabelText('Server address') as HTMLInputElement).value).toBe('https://cloud.test')
  })

  it('shows and hides the password, and says what is missing instead of greying the button', async () => {
    fakeServer([])
    render(<App />)
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(pw.type).toBe('text')
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(await screen.findByText('Enter your email.')).toBeTruthy()
  })
})

describe('keyboard triage', () => {
  it('j picks rows, Enter opens one, a takes an alert', async () => {
    signedIn('operator')
    let acked = false
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/rules', reply: { rules: [] } },
      {
        path: '/fleet/alerts',
        reply: (req: { url: URL }) => {
          const all = [alert({ state: acked ? 'acknowledged' : 'open' }), alert({ id: 'al2', deviceId: 'dev-9' })]
          return { alerts: req.url.searchParams.get('state') === 'all' ? all : all.filter((a) => a.state === 'open') }
        },
      },
      {
        method: 'POST',
        path: '/fleet/alerts/al1/ack',
        reply: () => {
          acked = true
          return {}
        },
      },
    ])
    render(<App />)
    await go('#/alerts')
    await screen.findAllByText('Not connected')
    fireEvent.keyDown(window, { key: 'j' })
    const rows = document.querySelectorAll('main [data-nav]')
    expect(rows[0]!.hasAttribute('data-nav-active')).toBe(true)
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => expect(server.calls.some((c) => c.path === '/fleet/alerts/al1/ack')).toBe(true))
    await go('#/alerts?state=all')
    await screen.findAllByText('Not connected')
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/(shops|tills)\//))
  })
})

describe('status bar', () => {
  it('shows the fleet pulse on every page and links into the filtered list', async () => {
    signedIn()
    fakeServer([...shellRoutes, { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } }, { path: '/fleet/alerts', reply: { alerts: [] } }])
    render(<App />)
    const bar = await screen.findByRole('region', { name: 'Fleet status' })
    await within(bar).findByText(/1 offline/)
    expect(within(bar).getByText(/1 offline/).closest('a')!.getAttribute('href')).toBe('#/tills?state=offline')
  })
})

describe('receiving serial-numbered stock', () => {
  it('needs one serial per piece before sending', async () => {
    signedIn('operator')
    const shop = { id: 's1', name: 'Adum Electronics', code: 'AE', location: null, phone: null, currency: 'GHS', createdAt: '2026-10-01T00:00:00Z', owner: null, activated: true, hasLiveClaimCode: false, claimCodeExpiresAt: null, health: { healthy: 0, attention: 0, offline: 0 }, machines: [] }
    const product = { id: 'p1', name: 'Tecno Spark', category: 'Phones', barcode: null, costPrice: 900, sellingPrice: 1200, stock: 2, expiredStock: 0, sold: 0, reorderLevel: null, packLabel: null, unitsPerPack: null, expiryDate: '', hidden: false, status: 'ok', trackSerials: true, soldBy: null }
    const server = fakeServer([
      ...shellRoutes.map((r) => (r.path === '/api/stores' ? { ...r, reply: { shops: [shop] } } : r)),
      { path: '/api/stores/s1/inventory', reply: { summary: { products: 1, lowStock: 0, outOfStock: 0, oversold: 0, hidden: 0, unitsOnHand: 2, expiredUnits: 0 }, categories: [], products: [product] } },
      { method: 'POST', path: '/api/stores/s1/batches', reply: {} },
    ])
    render(<App />)
    await go('#/shops/s1?tab=stock')
    fireEvent.click(await screen.findByRole('button', { name: 'Receive' }))
    fireEvent.change(screen.getByLabelText('How many arrived'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Serial numbers'), { target: { value: 'IMEI-1' } })
    // happy-dom doesn't submit a form from a button inside <dialog>; submit it directly.
    const form = screen.getByLabelText('Serial numbers').closest('form')!
    fireEvent.submit(form)
    expect(await screen.findByText(/2 needed, 1 entered/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Serial numbers'), { target: { value: 'IMEI-1\nIMEI-2' } })
    fireEvent.submit(form)
    await waitFor(() => expect(server.calls.find((c) => c.method === 'POST' && c.path.endsWith('/batches'))).toBeTruthy())
    const body = server.calls.find((c) => c.path.endsWith('/batches'))!.body as { lines: { serials: string[]; stock: number }[] }
    expect(body.lines[0]).toMatchObject({ stock: 2, serials: ['IMEI-1', 'IMEI-2'] })
  })
})

describe('Till remote control', () => {
  const CAPS = ['sync.now', 'server.restart', 'till.lock', 'till.unlock', 'notice.show', 'notice.clear', 'pull.inspect']
  const catalogue = {
    commands: [
      { name: 'sync.now', label: 'Force sync now', description: '', risk: 'safe', quietable: false, legacy: true },
      { name: 'server.restart', label: 'Restart local server', description: '', risk: 'disruptive', quietable: true, legacy: true },
      { name: 'till.lock', label: 'Lock this till', description: '', risk: 'destructive', quietable: true, legacy: false },
      { name: 'till.unlock', label: 'Unlock this till', description: '', risk: 'safe', quietable: false, legacy: false },
      { name: 'notice.show', label: 'Show a message', description: '', risk: 'safe', quietable: false, legacy: false },
      { name: 'notice.clear', label: 'Remove the message', description: '', risk: 'safe', quietable: false, legacy: false },
      { name: 'pull.inspect', label: 'List stuck rows', description: '', risk: 'safe', quietable: false, legacy: false },
    ],
  }
  const routes = (d: Record<string, unknown>) => [
    ...shellRoutes,
    { path: '/fleet/devices/dev-1', reply: { device: device(d) } },
    { path: '/fleet/commands', reply: catalogue },
    { path: '/fleet/devices/dev-1/commands', reply: { commands: [] } },
    { method: 'POST', path: '/fleet/devices/dev-1/live', reply: { liveUntil: new Date(Date.now() + 300_000).toISOString() } },
    { method: 'POST', path: '/fleet/devices/dev-1/commands', reply: { command: {} } },
  ]

  it('keeps the till live while its page is open, and asks for a password to lock it', async () => {
    signedIn('operator')
    const server = fakeServer(routes({ capabilities: CAPS }))
    render(<App />)
    await go('#/tills/dev-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Lock…' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'POST' && c.path === '/fleet/devices/dev-1/live')).toBe(true))

    fireEvent.change(await screen.findByLabelText('Message on the lock screen (optional)'), { target: { value: 'Call 0302 000 000' } })
    const send = screen.getByRole('button', { name: 'Lock the till' }) as HTMLButtonElement
    expect(send.disabled).toBe(true) // no password yet
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } })
    fireEvent.click(send)

    await waitFor(() => {
      const post = server.calls.find((c) => c.method === 'POST' && c.path === '/fleet/devices/dev-1/commands')
      expect(post?.body).toEqual({
        command: 'till.lock',
        payload: { reason: 'support_hold', message: 'Call 0302 000 000' },
        whenQuiet: true,
        password: 'my-password',
      })
    })
  })

  it('shows the lock the till reports, and offers to lift it', async () => {
    signedIn('operator')
    fakeServer(
      routes({
        capabilities: CAPS,
        controlState: { lock: { reason: 'stolen', message: null, since: new Date().toISOString() }, notice: null, config: {} },
      }),
    )
    render(<App />)
    await go('#/tills/dev-1')
    expect(await screen.findByText(/Locked from the console/)).toBeTruthy()
    expect(screen.getAllByText(/Missing or stolen/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lock…' })).toBeNull()
  })

  const later = new Date(Date.now() + 4 * 3_600_000).toISOString()
  const settingsView = (effective: Record<string, unknown> = {}, layers: Record<string, unknown> = {}) => ({
    layers: { fleet: {}, shop: {}, device: {}, ...layers },
    effective: { lock: null, notice: null, config: {}, configFrom: {}, syncHold: null, updateHold: null, ...effective },
    version: 'abc123',
    tillVersion: 'abc123',
    onTill: true,
  })

  it('says where a message on the till comes from, and pauses its sync only with a password', async () => {
    signedIn('operator')
    const server = fakeServer([
      {
        path: '/fleet/devices/dev-1/settings',
        reply: settingsView({ notice: { text: 'Stocktake tonight', tone: 'info', until: later, since: later, by: 'kofi@x.co', from: 'shop' } }),
      },
      { method: 'POST', path: '/fleet/devices/dev-1/holds', reply: settingsView() },
      ...routes({ capabilities: CAPS }),
    ])
    render(<App />)
    await go('#/tills/dev-1')
    expect(await screen.findByText(/Showing the message for its whole shop/)).toBeTruthy()
    expect(screen.getByText(/The till has these/)).toBeTruthy()

    fireEvent.click(await screen.findByRole('button', { name: 'Pause sync…' }))
    fireEvent.change(screen.getByLabelText('Why (optional)'), { target: { value: 'Reported stolen' } })
    const pause = screen.getByRole('button', { name: 'Pause sync' }) as HTMLButtonElement
    expect(pause.disabled).toBe(true) // no password yet
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } })
    fireEvent.click(pause)
    await waitFor(() => {
      const post = server.calls.find((c) => c.method === 'POST' && c.path === '/fleet/devices/dev-1/holds')
      expect(post?.body).toEqual({ kind: 'sync', on: true, reason: 'Reported stolen', password: 'my-password' })
    })
  })

  it('keeps a till out of updates, and sends it lifting a hold its shop did not set', async () => {
    signedIn('operator')
    const server = fakeServer([
      {
        path: '/fleet/devices/dev-1/settings',
        reply: settingsView({ updateHold: { reason: 'Printer quirk', since: later, by: 'kofi@x.co', from: 'device' } }),
      },
      { method: 'POST', path: '/fleet/devices/dev-1/holds', reply: settingsView() },
      ...routes({ capabilities: CAPS }),
    ])
    render(<App />)
    await go('#/tills/dev-1')
    expect(await screen.findByText(/“Printer quirk”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Let it update' }))
    await waitFor(() => {
      const post = server.calls.find((c) => c.method === 'POST' && c.path === '/fleet/devices/dev-1/holds')
      expect(post?.body).toEqual({ kind: 'updates', on: false })
    })
  })

  it('offers an older till only what it can run', async () => {
    signedIn('operator')
    fakeServer(routes({ capabilities: null, appVersion: '2.2.0' }))
    render(<App />)
    await go('#/tills/dev-1')
    expect(await screen.findByRole('button', { name: 'Force sync now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lock…' })).toBeNull()
    expect(screen.getByText(/need a newer app on this till \(it runs 2\.2\.0\)/)).toBeTruthy()
  })
})

describe('Alert rules', () => {
  const rule = (over: Record<string, unknown>) => ({
    description: '',
    enabled: true,
    severity: null,
    runbookUrl: null,
    notes: null,
    autoFix: null,
    autoFixChoices: [],
    updatedBy: null,
    ...over,
  })

  it('lets an admin give a rule an automatic fix — only from the fixes that suit it', async () => {
    signedIn('admin')
    const server = fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/rules',
        reply: {
          rules: [
            rule({ key: 'sync.failed', label: 'Sync failures', autoFixChoices: [{ value: 'recipe:fix_sync', label: 'Unstick sync' }] }),
            rule({ key: 'device.offline', label: 'Terminal offline' }),
          ],
        },
      },
      { method: 'PUT', path: '/fleet/rules/sync.failed', reply: {} },
    ])
    render(<App />)
    await go('#/settings?tab=rules')
    fireEvent.change(await screen.findByLabelText('Automatic fix for Sync failures'), { target: { value: 'recipe:fix_sync' } })
    await waitFor(() => expect(server.calls.find((c) => c.method === 'PUT')?.body).toEqual({ autoFix: 'recipe:fix_sync' }))
    expect(screen.queryByLabelText('Automatic fix for Terminal offline')).toBeNull()
  })
})

describe('Tills settings', () => {
  it('sets a message for every till, and adds a weekly schedule', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/till-settings', reply: { fleet: {}, shops: [], devices: [] } },
      { method: 'PUT', path: '/fleet/till-settings', reply: { fleet: {} } },
      { path: '/fleet/schedules', reply: { schedules: [], commands: ['db.check', 'server.restart'] } },
      { method: 'POST', path: '/fleet/schedules', reply: { schedule: {} } },
      { path: '/fleet/recipes', reply: { recipes: [] } },
      {
        path: '/fleet/commands',
        reply: {
          commands: [
            { name: 'db.check', label: 'Check the database', description: '', risk: 'disruptive', quietable: true, legacy: false },
            { name: 'pull.skip', label: 'Discard a stuck row', description: '', risk: 'destructive', quietable: false, legacy: false },
          ],
        },
      },
    ])
    render(<App />)
    await go('#/settings?tab=tills')
    fireEvent.change(await screen.findByLabelText('Show a message'), { target: { value: 'Maintenance at 11pm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show on tills' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PUT' && c.path === '/fleet/till-settings')?.body).toEqual({
        notice: { text: 'Maintenance at 11pm', tone: 'info', hours: 24 },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add a schedule' }))
    const what = (await screen.findByLabelText('What to run')) as HTMLSelectElement
    // A destructive command is never on offer.
    expect([...what.options].map((o) => o.textContent)).toEqual(['Choose…', 'Check the database'])
    fireEvent.change(what, { target: { value: 'command:db.check' } })
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '03:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST' && c.path === '/fleet/schedules')?.body).toEqual({
        label: 'Check the database',
        scope: 'fleet',
        target: null,
        action: 'command:db.check',
        every: 'week',
        weekday: 0,
        atMinute: 210,
        whenQuiet: true,
      }),
    )
  })
})

describe('Shop till settings', () => {
  it('keeps a whole shop out of updates, with a reason', async () => {
    signedIn('operator')
    const shop = {
      id: 's1',
      name: 'Kumasi Mart',
      code: 'KM1',
      location: null,
      businessType: 'provisions',
      currency: 'GHS',
      createdAt: '2026-10-01T09:00:00Z',
      owner: null,
      activated: true,
      hasLiveClaimCode: false,
      claimCodeExpiresAt: null,
      health: { healthy: 1, attention: 0, offline: 0 },
      machines: [],
    }
    const server = fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/api/stores'),
      { path: '/api/stores', reply: { shops: [shop] } },
      { path: '/fleet/shops/s1/till-settings', reply: { fleet: { config: { reportIntervalSec: 600 } }, shop: {} } },
      { method: 'PUT', path: '/fleet/shops/s1/till-settings', reply: { shop: {} } },
    ])
    render(<App />)
    await go('#/shops/s1?tab=tills')
    // What the fleet sets shows through until the shop sets its own.
    const checkIns = (await screen.findByText('(the fleet)')).closest('dd')!
    expect(checkIns.textContent).toBe('every 10m (the fleet)')
    fireEvent.change(screen.getByLabelText('Why keep the shop out of updates'), { target: { value: 'Stocktake' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep the shop out of updates' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PUT')?.body).toEqual({ updateHold: { reason: 'Stocktake' } }),
    )
  })
})

describe('closing a shop', () => {
  const shopRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Kumasi Mart',
    code: 'KM1',
    location: null,
    phone: null,
    currency: 'GHS',
    createdAt: '2026-10-01T09:00:00Z',
    owner: null,
    activated: true,
    hasLiveClaimCode: false,
    claimCodeExpiresAt: null,
    health: { healthy: 1, attention: 0, offline: 0 },
    machines: [],
    closure: null,
    ...over,
  })
  const closure = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    shopId: 's1',
    shopName: 'Kumasi Mart',
    shopCode: 'KM1',
    status: 'closed',
    reason: 'Stopped trading',
    closedAt: '2026-11-10T09:00:00Z',
    closedBy: 'op2',
    closedByLabel: 'kofi@jumpspaces.co',
    purgeAfter: '2026-12-10T09:00:00Z',
    purgeApprovedAt: null,
    purgeApprovedBy: null,
    purgeApprovedByLabel: null,
    exportedAt: null,
    exportedByLabel: null,
    reopenedAt: null,
    reopenedByLabel: null,
    purgedAt: null,
    purgeCounts: null,
    purgeError: null,
    ...over,
  })

  it('warns about unsent sales, then closes with a reason and a password', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/api/stores'),
      { path: '/api/stores', reply: { shops: [shopRow()] } },
      {
        path: '/api/stores/s1/closure',
        reply: { status: 'open', closure: null, purgeOn: null, unsent: [{ deviceId: 'dev-1', syncPending: 3, lastReportAt: null }], purgeAfterDays: 30 },
      },
      { method: 'POST', path: '/api/stores/s1/close', reply: { status: 'closed' } },
    ])
    render(<App />)
    await go('#/shops/s1?tab=closing')
    expect((await screen.findAllByText(/1 till still has 3 records it hasn't sent/)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Close shop…' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Why (optional)'), { target: { value: 'Stopped trading' } })
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close shop' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/stores/s1/close')?.body).toEqual({
        password: 'pw',
        reason: 'Stopped trading',
      }),
    )
  })

  it('asks a second operator to agree to deletion, and never the one who closed it', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/api/stores'),
      { path: '/api/stores', reply: { shops: [shopRow({ closure: { status: 'closed', closedAt: '2026-11-10T09:00:00Z', purgeAfter: '2026-12-10T09:00:00Z', purgeApprovedAt: null } })] } },
      { path: '/api/stores/s1/closure', reply: { status: 'closed', closure: closure(), purgeOn: null, unsent: [], purgeAfterDays: 30 } },
      { method: 'POST', path: '/api/stores/s1/purge-approval', reply: { status: 'closed' } },
    ])
    render(<App />)
    await go('#/shops/s1')
    // The overview says it's closed before anything else.
    expect(await screen.findByText(/Its tills and staff are cut off from the cloud/)).toBeTruthy()
    await go('#/shops/s1?tab=closing')
    fireEvent.click(await screen.findByRole('button', { name: 'Agree to delete…' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'pw2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agree to delete' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/stores/s1/purge-approval')?.body).toEqual({ password: 'pw2' }),
    )
  })

  it('shows the closer that someone else has to agree', async () => {
    signedIn('operator')
    fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/api/stores'),
      { path: '/api/stores', reply: { shops: [shopRow()] } },
      { path: '/api/stores/s1/closure', reply: { status: 'closed', closure: closure({ closedBy: 'op1' }), purgeOn: null, unsent: [], purgeAfterDays: 30 } },
    ])
    render(<App />)
    await go('#/shops/s1?tab=closing')
    expect(await screen.findByText(/You closed it, so someone else has to agree/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Agree to delete…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen shop…' })).toBeTruthy()
  })

  it('keeps closed shops out of the list, under their own filter with the deleted ones', async () => {
    signedIn('operator')
    fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/api/stores'),
      {
        path: '/api/stores',
        reply: {
          shops: [
            shopRow({ id: 's2', name: 'Accra Fresh' }),
            shopRow({ closure: { status: 'closed', closedAt: '2026-11-10T09:00:00Z', purgeAfter: '2026-12-10T09:00:00Z', purgeApprovedAt: null } }),
          ],
        },
      },
      {
        path: '/api/stores/closures',
        reply: {
          closures: [closure({ id: 'c2', shopId: 's9', shopName: 'Tema Corner', status: 'purged', purgedAt: '2026-11-01T09:00:00Z', purgeCounts: { sale: 40, product: 2 } })],
          purgeAfterDays: 30,
        },
      },
    ])
    render(<App />)
    await go('#/shops')
    expect(await screen.findByText('Accra Fresh')).toBeTruthy()
    expect(screen.queryByText('Kumasi Mart')).toBeNull()
    await go('#/shops?show=closed')
    expect(await screen.findByText('Kumasi Mart')).toBeTruthy()
    expect(await screen.findByText('Tema Corner')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })
})

describe('sign-in codes', () => {
  it('asks for the code after the password, and signs in with it', async () => {
    const server = fakeServer([
      {
        method: 'POST',
        path: '/fleet/login',
        status: (req) => ((req.body as { code?: string }).code ? 200 : 401),
        reply: (req: { body: unknown }) =>
          (req.body as { code?: string }).code
            ? { accessToken: 'a', refreshToken: 'r', operator: { id: 'op1', email: 'ama@x.co', name: 'Ama', role: 'operator', mfa: true } }
            : { error: 'two_factor_required', message: 'Enter the 6-digit code from your authenticator app.' },
      },
      ...shellRoutes,
      { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } },
      { path: '/fleet/alerts', reply: { alerts: [] } },
    ])
    render(<App />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ama@x.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://cloud.test/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const code = await screen.findByLabelText('Code from your authenticator app')
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Every till is working')).toBeTruthy()
    expect(server.calls.filter((c) => c.path === '/fleet/login').map((c) => (c.body as { code?: string }).code)).toEqual([undefined, '123456'])
  })

  it('when required, a session without a code sets them up before anything else', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/fleet/me/two-factor'),
      { path: '/fleet/me/two-factor', reply: { enabled: false, enabledAt: null, recoveryCodesLeft: 0, required: true } },
      { method: 'POST', path: '/fleet/me/two-factor/setup', reply: { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/SmartSort%20Fleet%3Aama?secret=JBSWY3DPEHPK3PXP' } },
      {
        method: 'POST',
        path: '/fleet/me/two-factor/enable',
        reply: {
          recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'],
          session: { accessToken: 'a2', refreshToken: 'r2', operator: { id: 'op1', email: 'ama@jumpspaces.co', name: 'Ama', role: 'operator', mfa: true } },
        },
      },
      { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } },
      { path: '/fleet/alerts', reply: { alerts: [] } },
    ])
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Set up sign-in codes' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    expect(await screen.findByAltText('QR code to scan with your authenticator app')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('The 6-digit code your app shows'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(await screen.findByText('aaaa-bbbb')).toBeTruthy()
    // The new session is the one kept: the old one ended when codes went on.
    expect(JSON.parse(localStorage.getItem('fleet_session')!).accessToken).toBe('a2')
    fireEvent.click(screen.getByLabelText("I've saved them"))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Every till is working')).toBeTruthy()
    expect(server.calls.find((c) => c.path === '/fleet/me/two-factor/enable')?.body).toEqual({ code: '654321' })
  })

  it('lets an admin clear the codes of someone who lost their phone', async () => {
    signedIn('admin')
    const server = fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/operators',
        reply: {
          operators: [
            { id: 'op1', email: 'ama@jumpspaces.co', name: 'Ama', role: 'admin', active: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z', twoFactorAt: '2026-11-01T00:00:00Z' },
            { id: 'op2', email: 'kofi@jumpspaces.co', name: 'Kofi', role: 'operator', active: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z', twoFactorAt: '2026-11-02T00:00:00Z' },
          ],
        },
      },
      { path: '/fleet/config', reply: { config: { requireCommandApproval: false, requireTwoFactor: false }, defaults: {} } },
      { method: 'POST', path: '/fleet/operators/op2/two-factor/reset', reply: { ok: true } },
    ])
    render(<App />)
    await go('#/settings')
    // Not for yourself: you'd turn your own off with a code instead.
    expect((await screen.findAllByRole('button', { name: 'Clear codes' })).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear codes' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear codes' }))
    await waitFor(() => expect(server.calls.find((c) => c.path === '/fleet/operators/op2/two-factor/reset')?.body).toEqual({ password: 'pw' }))
  })
})

describe('cloud address', () => {
  it('hands a pasted, signed move to the tills, with a password', async () => {
    signedIn('admin')
    const signed = { statement: '{"kind":"smartsort.cloud-address"}', signature: 'c2ln' }
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/till-settings', reply: { fleet: {}, shops: [], devices: [] } },
      { path: '/fleet/schedules', reply: { schedules: [], schedulable: [] } },
      { path: '/fleet/commands/catalogue', reply: { commands: [] } },
      { path: '/fleet/recipes', reply: { recipes: [] } },
      { path: '/fleet/cloud-address', reply: { signed: null, move: null, verified: null } },
      {
        method: 'PUT',
        path: '/fleet/cloud-address',
        reply: { signed, move: { apiUrl: 'https://cloud.jumpspaces.co', fleetUrl: 'https://cloud.jumpspaces.co', feedUrl: 'https://cloud.jumpspaces.co/updates', issuedAt: '2026-11-17T10:00:00Z' }, verified: true },
      },
    ])
    render(<App />)
    await go('#/settings?tab=tills')
    const box = await screen.findByLabelText('A signed move')
    fireEvent.change(box, { target: { value: 'not json' } })
    expect(screen.getByText(/isn't what the workflow prints/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Hand it to the tills…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(box, { target: { value: JSON.stringify(signed) } })
    fireEvent.click(screen.getByRole('button', { name: 'Hand it to the tills…' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand it out' }))
    await waitFor(() => expect(server.calls.find((c) => c.method === 'PUT' && c.path === '/fleet/cloud-address')?.body).toEqual({ ...signed, password: 'pw' }))
  })
})

describe('accounts', () => {
  const shopRow = { id: 's1', name: 'Kumasi Mart', code: 'KM1', location: null, phone: null, currency: 'GHS', createdAt: '2026-10-01T09:00:00Z', owner: null, activated: true, hasLiveClaimCode: false, claimCodeExpiresAt: null, health: { healthy: 1, attention: 0, offline: 0 }, machines: [], closure: null }
  const withShop = [...shellRoutes.filter((r) => r.path !== '/api/stores'), { path: '/api/stores', reply: { shops: [shopRow] } }]

  it('lists shops gone quiet, with what changed and a way to log the call', async () => {
    signedIn('operator')
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/accounts/quiet',
        reply: {
          shops: [{ shopId: 's1', name: 'Kumasi Mart', code: 'KM1', phone: '024', owner: 'Ama', reason: 'stopped', why: 'No sales for 6 days', lastSaleAt: '2026-11-11T09:00:00Z', lastWeekSales: 0, lastWeekPesewas: 0, usualWeekSales: 40, lastContactAt: null }],
        },
      },
    ])
    render(<App />)
    await go('#/accounts')
    expect(await screen.findByText('No sales for 6 days')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Log a call' }).getAttribute('href')).toContain('tab=contacts')
  })

  it('shows how far each new shop has got, and its next step', async () => {
    signedIn('operator')
    const step = (key: string, label: string, done: boolean, detail: string) => ({ key, label, done, detail })
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/accounts/setup',
        reply: {
          shops: [{ shopId: 's1', name: 'Kumasi Mart', code: 'KM1', owner: 'Ama', createdAt: '2026-11-10T09:00:00Z', daysIn: 7, done: 2, steps: [step('claimed', 'Owner set up', true, ''), step('tills', 'Till reporting', true, ''), step('products', 'Products in', false, '3 products')] }],
        },
      },
    ])
    render(<App />)
    await go('#/accounts?tab=setup')
    expect(await screen.findByText('Products in')).toBeTruthy()
    expect(screen.getByText('3 products')).toBeTruthy()
    expect(screen.getByText('2 of 3')).toBeTruthy()
  })

  it('marks a follow-up done', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes,
      { path: '/fleet/accounts/follow-ups', reply: { followUps: [{ id: 'c1', shopId: 's1', shopName: 'Kumasi Mart', summary: 'Promised to check receipts', followUpAt: '2026-11-18T09:00:00Z' }] } },
      { method: 'POST', path: '/fleet/accounts/follow-ups/c1/done', reply: {} },
    ])
    render(<App />)
    await go('#/accounts?tab=follow-ups')
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'POST' && c.path === '/fleet/accounts/follow-ups/c1/done')).toBe(true))
  })

  it('puts dated things on the calendar, and what is under way above them', async () => {
    signedIn('operator')
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString()
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/calendar',
        reply: {
          events: [{ at: soon, kind: 'renewal', title: "Kumasi Mart's Standard is due", shopId: 's1' }],
          ongoing: [{ at: '2026-11-10T09:00:00Z', kind: 'hold', title: 'Kept out of updates: Kumasi Mart', shopId: 's1' }],
        },
      },
    ])
    render(<App />)
    await go('#/calendar')
    expect(await screen.findByText("Kumasi Mart's Standard is due")).toBeTruthy()
    expect(screen.getByText('Under way now')).toBeTruthy()
    expect(screen.getByRole('link', { name: "Kumasi Mart's Standard is due" }).getAttribute('href')).toContain('tab=account')
  })

  it('logs a call with a follow-up on the shop', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...withShop,
      { path: '/api/stores/s1/contacts', reply: { contacts: [] } },
      { method: 'POST', path: '/api/stores/s1/contacts', reply: { contact: {} } },
    ])
    render(<App />)
    await go('#/shops/s1?tab=contacts')
    fireEvent.change(await screen.findByLabelText('What happened'), { target: { value: 'Printer jams after lunch' } })
    fireEvent.change(screen.getByLabelText('Follow up'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      const body = server.calls.find((c) => c.method === 'POST' && c.path === '/api/stores/s1/contacts')?.body as { kind: string; summary: string; followUpAt: string }
      expect(body).toMatchObject({ kind: 'call', summary: 'Printer jams after lunch' })
      expect(Date.parse(body.followUpAt)).toBeGreaterThan(Date.now() + 2 * 86_400_000)
    })
  })

  it('sets up a subscription in exact pesewas, and records a payment', async () => {
    signedIn('operator')
    const view = {
      subscription: { plan: 'Standard', amountPesewas: 15050, every: 'month', paidUntil: '2026-11-20T23:59:59Z', remindDays: 7, notes: null, lastRemindedAt: null, updatedByLabel: 'ama' },
      state: 'due_soon',
      payments: [],
      features: ['credit'],
    }
    let current: unknown = { subscription: null, state: 'none', payments: [], features: [] }
    const server = fakeServer([
      ...withShop,
      { path: '/api/stores/s1/subscription', reply: () => current },
      { method: 'PUT', path: '/api/stores/s1/subscription', reply: () => ((current = view), view) },
      { method: 'POST', path: '/api/stores/s1/subscription/payments', reply: view },
    ])
    render(<App />)
    await go('#/shops/s1?tab=account')
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    let dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Amount (GHS)'), { target: { value: '150.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ plan: 'Standard', amountPesewas: 15050, every: 'month' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }))
    await waitFor(() => expect(server.calls.find((c) => c.method === 'POST' && c.path.endsWith('/payments'))?.body).toMatchObject({ amountPesewas: 15050, method: 'MoMo' }))
  })

  it('says which tills are behind on the Updates page, and why', async () => {
    signedIn('operator')
    fakeServer([
      ...shellRoutes,
      { path: '/fleet/rollouts', reply: { rollouts: [], active: null } },
      {
        path: '/fleet/updates/lag',
        reply: { latest: '2.9.0', total: 3, onLatest: 1, byVersion: [], behind: [{ deviceId: 'dev-9', shopId: 's1', shopName: 'Kumasi Mart', version: '2.8.0', reason: 'failed', detail: 'Last update failed: no space', lastReportAt: null }] },
      },
    ])
    render(<App />)
    await go('#/updates')
    expect(await screen.findByText('1 till behind 2.9.0')).toBeTruthy()
    expect(screen.getByText('Update failed')).toBeTruthy()
    expect(screen.getByText('Last update failed: no space')).toBeTruthy()
  })
})

describe('machines', () => {
  const machine = (over: Record<string, unknown>) => ({
    keyId: 'k1', machineId: 'm1', machineName: 'cash', terminalCode: 'T9', mode: 'peer', keyPrefix: 'ss_store_d7', createdAt: '2026-09-30T09:00:00Z',
    lastSeenAt: null, revokedAt: null, removedAt: null, lastReportAt: null, ...over,
  })
  const shop = (machines: unknown[]) => ({
    id: 's1', name: 'Ressy', code: 'RESS-1413', location: null, phone: null, currency: 'GHS', createdAt: '2026-08-08T09:00:00Z', owner: null,
    activated: true, hasLiveClaimCode: false, claimCodeExpiresAt: null, health: { healthy: 0, attention: 0, offline: 0 }, machines, closure: null,
  })

  it('renumbers a till to a number never used, and deletes a removed one for good', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...shellRoutes.filter((r) => r.path !== '/api/stores'),
      { path: '/api/stores', reply: { shops: [shop([machine({}), machine({ keyId: 'k2', machineName: 'Temp', terminalCode: 'T8', revokedAt: '2026-09-29T09:00:00Z', removedAt: '2026-09-29T09:00:00Z' })])] } },
      { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } },
      { path: '/api/stores/s1/terminal-codes', reply: { free: ['T2', 'T4', 'T10'], spent: ['T1', 'T3', 'T5', 'T6', 'T7', 'T8', 'T9'] } },
      { method: 'POST', path: '/api/stores/keys/k1/terminal-code', reply: { from: 'T9', to: 'T2' } },
      { method: 'POST', path: '/api/stores/keys/k2/delete', reply: { terminalCode: 'T8', codeRetired: true } },
    ])
    render(<App />)
    await go('#/shops/s1')
    fireEvent.click(await screen.findByRole('button', { name: 'Change number' }))
    fireEvent.change(await screen.findByLabelText('New number (now T9)'), { target: { value: 'T2' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change number' }))
    await waitFor(() => expect(server.calls.find((c) => c.path === '/api/stores/keys/k1/terminal-code')?.body).toEqual({ code: 'T2' }))

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 removed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete for good' }))
    const dialog = screen.getAllByRole('dialog').find((d) => within(d).queryByLabelText('Your password'))!
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(server.calls.find((c) => c.path === '/api/stores/keys/k2/delete')?.body).toEqual({ password: 'pw' }))
  })
})
