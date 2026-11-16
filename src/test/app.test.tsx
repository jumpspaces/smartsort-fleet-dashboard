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
