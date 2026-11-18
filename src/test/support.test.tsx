// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App.tsx'
import { clearCache } from '../lib/query.ts'
import { looksLikeReceipt } from '../lib/receipt.ts'
import { fakeServer, shellRoutes, signedIn, type Route } from './fakeServer.ts'

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

const shop = {
  id: 's1',
  name: 'Kumasi Mart',
  code: 'KUMA-1234',
  location: null,
  phone: '0244000000',
  currency: 'GHS',
  createdAt: '2026-10-01T00:00:00Z',
  owner: { name: 'Akosua', staffId: 'owner' },
  activated: true,
  hasLiveClaimCode: false,
  claimCodeExpiresAt: null,
  health: { healthy: 1, attention: 0, offline: 0 },
  machines: [],
}

const withShop: Route[] = shellRoutes.map((r) => (r.path === '/api/stores' ? { ...r, reply: { shops: [shop] } } : r))

describe('receipt numbers in ⌘K', () => {
  it('knows a receipt from a shop name', () => {
    for (const yes of ['TXN-T2-0451', 'txn-0451', 'T2-451', 't2 451', 'T2/451', '#451']) expect(looksLikeReceipt(yes)).toBe(true)
    for (const no of ['451', 'Kumasi', 'KUMA-1234', 'T2', '']) expect(looksLikeReceipt(no)).toBe(false)
  })
})

describe('owner locked out', () => {
  it('makes a reset code only with the operator’s password, and shows it once', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...withShop,
      { path: '/fleet/devices', reply: { devices: [], total: 0, limit: 200, offset: 0 } },
      { path: '/fleet/help', reply: { requests: [], counts: {} } },
      { path: '/fleet/phones', reply: { phones: [], versions: [], days: 7 } },
      {
        path: '/api/stores/s1/owner-reset',
        reply: { owners: [{ id: 'u1', name: 'Akosua', staffId: 'owner', active: true }], live: null, lastUsed: null },
      },
      {
        method: 'POST',
        path: '/api/stores/s1/owner-reset',
        reply: { code: 'K7P2M-9QXFA', expiresAt: '2030-01-01T00:00:00Z', owner: { id: 'u1', name: 'Akosua', staffId: 'owner', active: true } },
      },
    ])
    render(<App />)
    await go('#/shops/s1')
    fireEvent.click(await screen.findByRole('button', { name: 'Owner locked out' }))
    const make = (await screen.findByRole('button', { name: 'Make the code' })) as HTMLButtonElement
    expect(make.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } })
    fireEvent.click(make)
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST' && c.path === '/api/stores/s1/owner-reset')?.body).toEqual({ password: 'my-password', userId: 'u1' }),
    )
    expect(await screen.findByText('K7P2M-9QXFA')).toBeTruthy()
    expect(screen.getByText(/Read it to Akosua \(staff ID owner\)/)).toBeTruthy()
  })
})

describe('help requests', () => {
  const request = {
    id: 'h1',
    shopId: 's1',
    shopName: 'Kumasi Mart',
    shopCode: 'KUMA-1234',
    deviceId: 'dev-1',
    requesterName: 'Kofi',
    requesterRole: 'cashier',
    source: 'till',
    message: 'Printer prints blank receipts',
    callbackPhone: '0244111222',
    screen: 'checkout',
    status: 'open',
    reply: null,
    repliedAt: null,
    repliedByLabel: null,
    closedAt: null,
    closedByLabel: null,
    createdAt: '2026-11-18T08:00:00Z',
  }

  it('lists who is waiting, then replies with the till’s state in view', async () => {
    signedIn('operator')
    const server = fakeServer([
      ...withShop.map((r) => (r.path === '/fleet/overview' ? { ...r, reply: { ...(r.reply as object), openHelpRequests: 1 } } : r)),
      { path: '/fleet/help', reply: { requests: [request], counts: { open: 1 } } },
      {
        path: '/fleet/help/h1',
        reply: {
          ...request,
          tillName: 'Front till',
          snapshot: { terminalCode: 'T1', appVersion: '2.9.0', lastReportAt: null, serverHealthy: true, syncPending: 4, syncFailed: 0, lastSyncAt: null, lastPulledAt: null, diskFreeBytes: null, lastBackupAt: null, locked: false },
          logs: { id: 'c1', state: 'done', ok: true, result: '[server] printer: no paper', error: null, completedAt: null },
          logsNote: null,
        },
      },
      { method: 'POST', path: '/fleet/help/h1/reply', reply: { ...request, status: 'answered', snapshot: null, logs: null, logsNote: null, tillName: null, pushed: false } },
    ])
    render(<App />)
    await go('#/help')
    // The nav carries the count.
    expect(await screen.findByText('Printer prints blank receipts')).toBeTruthy()
    await go('#/help/h1')
    expect(await screen.findByText('Kumasi Mart asked for help')).toBeTruthy()
    expect(screen.getByText('[server] printer: no paper')).toBeTruthy()
    expect(screen.getByText('Sales waiting to send').nextElementSibling?.textContent).toBe('4')

    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Load the paper shiny side down.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'POST' && c.path === '/fleet/help/h1/reply')?.body).toEqual({ reply: 'Load the paper shiny side down.' }),
    )
  })
})

describe('find a sale', () => {
  it('shows the sale, and what each till has sent when it isn’t there', async () => {
    signedIn('viewer')
    const sale = {
      id: 'sale1',
      shopId: 's1',
      shopName: 'Kumasi Mart',
      shopCode: 'KUMA-1234',
      currency: 'GHS',
      receipt: 'TXN-T1-0451',
      terminalCode: 'T1',
      receiptNumber: 451,
      createdAt: '2026-11-18T09:00:00Z',
      receivedAt: '2026-11-18T09:00:05Z',
      total: 1250,
      paymentType: 'cash',
      cashAmount: 2000,
      momoAmount: 0,
      momoRef: null,
      momoNetwork: null,
      creditAmount: 0,
      discount: 0,
      cashier: 'Kofi',
      lines: [{ name: 'Rice 5kg', qty: 1250, soldBy: 'kg', unitPrice: 1000, lineTotal: 1250, discount: 0, options: null }],
      voided: null,
      returns: [],
      drawer: null,
      till: null,
    }
    const server = fakeServer([
      ...withShop,
      {
        path: '/fleet/receipts',
        reply: (req: { url: URL }) =>
          req.url.searchParams.get('q') === 'T1 451'
            ? { query: { terminalCode: 'T1', number: 451 }, sales: [sale], tills: null }
            : {
                query: { terminalCode: 'T1', number: 999 },
                sales: [],
                tills: [{ terminalCode: 'T1', deviceId: 'dev-1', name: 'Front till', removed: false, highestReceipt: 451, highestReceiptAt: null, lastReportAt: null, syncPending: 12, syncFailed: 0, lastSyncAt: null }],
              },
      },
    ])
    render(<App />)
    await go('#/receipts?q=T1%20451')
    expect(await screen.findByText('TXN-T1-0451')).toBeTruthy()
    // Weighed: 1250 thousandths of a kilo.
    expect(screen.getByText('1.25 kg')).toBeTruthy()
    expect(screen.getByText(/cash handed over GHS 20\.00/)).toBeTruthy()

    await go('#/receipts?q=T1%20999&shopId=s1')
    expect(await screen.findByText('Not in the cloud yet')).toBeTruthy()
    expect(screen.getByText('#0451')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(server.calls.some((c) => c.path === '/fleet/receipts' && c.search.includes('shopId=s1'))).toBe(true)
  })
})

describe('the cloud', () => {
  it('puts what needs doing first', async () => {
    signedIn('viewer')
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/cloud',
        reply: {
          checkedAt: '2026-11-18T09:00:00Z',
          server: { imageTag: 'sha-1dd4d0b', node: 'v22.22.2', startedAt: '2026-11-17T18:00:00Z', rssBytes: 200_000_000, lastAlertPassAt: new Date().toISOString() },
          disk: { path: '/', freeBytes: 30 * 1024 ** 3, totalBytes: 50 * 1024 ** 3 },
          diskLevel: 'ok',
          runway: { bytesPerDay: null, fullInDays: null },
          database: { bytes: 900_000_000, version: '16.4', connections: 8, maxConnections: 100, largest: [], migrations: { applied: 102, shipped: 102, lastAppliedAt: null } },
          backups: { visible: true, dir: '/srv/backups', files: [{ name: 'smartsort-2026-11-18.dump', bytes: 100, modifiedAt: '2026-11-18T03:00:00Z' }], newestAt: '2026-11-18T03:00:00Z', offsiteAt: null },
          cert: null,
          history: [],
          warnings: [{ key: 'cloud.backup_onbox', level: 'warning', title: 'The backups have not left the server', detail: 'Copy them off.' }],
        },
      },
    ])
    render(<App />)
    await go('#/cloud')
    expect(await screen.findByText('The backups have not left the server')).toBeTruthy()
    expect(screen.getByText('Never marked')).toBeTruthy()
    expect(screen.getByText('sha-1dd4d0b')).toBeTruthy()
  })
})
