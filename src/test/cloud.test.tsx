// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App.tsx'
import { clearCache } from '../lib/query.ts'
import { fakeServer, shellRoutes, signedIn } from './fakeServer.ts'

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

const overview = {
  checkedAt: '2026-11-18T09:00:00Z',
  server: { imageTag: 'sha-8e28109', node: 'v22.22.2', startedAt: '2026-11-18T08:00:00Z', rssBytes: 200_000_000, lastAlertPassAt: new Date().toISOString() },
  disk: { path: '/', freeBytes: 30 * 1024 ** 3, totalBytes: 50 * 1024 ** 3 },
  diskLevel: 'ok',
  runway: { bytesPerDay: null, fullInDays: null },
  database: { bytes: 900_000_000, version: '16.4', connections: 8, maxConnections: 100, largest: [], migrations: { applied: 102, shipped: 102, lastAppliedAt: null } },
  backups: {
    visible: true,
    dir: '/srv/backups',
    files: [],
    newestAt: '2026-11-18T03:00:00Z',
    offsiteAt: '2026-11-18T04:00:00Z',
    verified: { at: '2026-11-18T03:05:00Z', dump: 'smartsort-2026-11-18.dump', ok: false, tables: null, sales: null, error: 'pg_restore: relation "sale" does not exist' },
  },
  cert: null,
  history: [],
  warnings: [{ key: 'cloud.restore_unverified', level: 'critical', title: 'The last restore check failed', detail: 'It didn’t restore.' }],
  machine: {
    cpus: 2,
    load: [3.5, 2.1, 1.2],
    uptimeSec: 86_400,
    memory: { totalBytes: 2 * 1024 ** 3, availableBytes: 1024 ** 3, swapTotalBytes: 0, swapFreeBytes: 0, containerLimitBytes: null, containerUsedBytes: null, measured: true },
    folders: [{ label: 'Update feed (installers)', path: '/srv/updates', bytes: 1.4 * 1024 ** 3, files: 12, truncated: false }],
  },
  boots: { recent: [], lastHour: 1 },
  requests: { day: { requests: 18_000, clientErrors: 40, serverErrors: 3 }, last15m: { requests: 190, serverErrors: 0 }, since: '2026-11-18T08:00:00Z' },
  dependencies: [{ name: 'Expo push', what: 'Notifications', health: 'failing', lastOkAt: null, lastFailAt: '2026-11-18T08:30:00Z', lastError: 'Expo answered 503.' }],
  settings: { checked: 14, problems: 2 },
}

describe('the Cloud page', () => {
  it('shows a failed restore check, the machine and what the cloud depends on', async () => {
    signedIn('viewer')
    fakeServer([...shellRoutes, { path: '/fleet/cloud', reply: overview }])
    render(<App />)
    await go('#/cloud')
    expect(await screen.findByText('The last restore check failed')).toBeTruthy()
    expect(screen.getByText(/relation "sale" does not exist/)).toBeTruthy()
    // Load above the CPU count is called out.
    expect(screen.getByText('More work than CPUs')).toBeTruthy()
    expect(screen.getByText('Expo answered 503.')).toBeTruthy()
    expect(screen.getByRole('link', { name: '2 settings to fix' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'sha-8e28109' }).getAttribute('href')).toContain('/commit/8e28109')
  })

  it('lists routes by pattern, and sorts by failures on request', async () => {
    signedIn('viewer')
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/cloud/requests',
        reply: {
          since: '2026-11-18T08:00:00Z',
          hours: [{ hour: '2026-11-18T08:00:00Z', requests: 900, clientErrors: 2, serverErrors: 5, p95Ms: 250, slowestMs: 4000 }],
          routes: [
            { route: 'POST /fleet/report', requests: 800, clientErrors: 0, serverErrors: 0, avgMs: 20, p95Ms: 50, slowestMs: 300 },
            { route: 'POST /api/sync/replicate', requests: 100, clientErrors: 2, serverErrors: 5, avgMs: 120, p95Ms: 1000, slowestMs: 4000 },
          ],
          last15m: { requests: 40, serverErrors: 0 },
          day: { requests: 900, clientErrors: 2, serverErrors: 5 },
        },
      },
    ])
    render(<App />)
    await go('#/cloud?tab=requests')
    const table = (await screen.findByText('POST /fleet/report')).closest('table')!
    const firstRoute = () => within(table).getAllByRole('row')[1]!.textContent
    expect(firstRoute()).toContain('POST /fleet/report')
    await act(async () => screen.getByRole('button', { name: 'Failing' }).click())
    expect(firstRoute()).toContain('POST /api/sync/replicate')
    expect(screen.getByText('4.0s')).toBeTruthy()
  })

  it('reads each start as a deploy, restart or rollback', async () => {
    signedIn('viewer')
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/cloud/deploys',
        reply: {
          boots: [
            { id: 'c', startedAt: '2026-11-18T08:12:00Z', imageTag: 'sha-1111111', kind: 'rollback', from: 'sha-2222222', ranForMs: null },
            { id: 'b', startedAt: '2026-11-18T08:10:00Z', imageTag: 'sha-2222222', kind: 'deploy', from: 'sha-1111111', ranForMs: 120_000 },
          ],
        },
      },
    ])
    render(<App />)
    await go('#/cloud?tab=deploys')
    expect(await screen.findByText('Rollback')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('2m')).toBeTruthy()
  })

  it('puts what is wrong first in the settings, and never shows a value', async () => {
    signedIn('viewer')
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/cloud/settings',
        reply: {
          settings: [
            { key: 'FLEET_METRICS_TOKEN', label: 'Metrics token', level: 'optional', state: 'default', note: 'Off.' },
            { key: 'EDITION_SIGNING_KEY', label: 'Edition signing key', level: 'required', state: 'broken', note: "Set, but it isn't the key the tills trust." },
            { key: 'FLEET_HEARTBEAT_URL', label: 'Outside heartbeat', level: 'recommended', state: 'missing', note: 'Not set.' },
          ],
          dependencies: [],
        },
      },
    ])
    render(<App />)
    await go('#/cloud?tab=settings')
    const table = (await screen.findByText('Edition signing key')).closest('table')!
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows[0]).toContain('Edition signing key')
    expect(rows[0]).toContain('Not working')
    expect(rows[2]).toContain('Metrics token')
  })

  it('names a transaction left open', async () => {
    signedIn('viewer')
    fakeServer([
      ...shellRoutes,
      {
        path: '/fleet/cloud/database',
        reply: {
          bytes: 900_000_000,
          version: '16.4',
          connections: [
            { state: 'idle', count: 6 },
            { state: 'idle in transaction', count: 1 },
          ],
          maxConnections: 100,
          largest: [],
          migrations: { applied: 102, shipped: 102, lastAppliedAt: null },
          openTransactions: [{ pid: 4242, state: 'idle in transaction', ageMs: 12 * 60_000, waiting: 'Client:ClientRead', application: 'psql', query: 'update batch set qty = $1 where id = $2' }],
          blocked: [],
          deadRows: [],
          cacheHitPct: 99.7,
          commits: 10,
          rollbacks: 0,
          deadlocks: 0,
        },
      },
    ])
    render(<App />)
    await go('#/cloud?tab=database')
    expect(await screen.findByText('update batch set qty = $1 where id = $2')).toBeTruthy()
    expect(screen.getByText('12m')).toBeTruthy()
    expect(screen.getByText('7 of 100 in use')).toBeTruthy()
  })
})
