// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const quiet = { restarts: { count: 0, lastAt: null }, startsLastHour: 1, errors: { open: 0, occurrences: 0, lastSeenAt: null, groups: [] }, spike: null, lastCleared: null }
const space = {
  helper: { state: 'ok', seenAt: new Date().toISOString() },
  measuredAt: new Date().toISOString(),
  diskFreeBytes: 9 * 1024 ** 3,
  items: [
    { key: 'images', label: 'Old server images', what: 'Earlier deploys.', bytes: 1.4 * 1024 ** 3, count: 5 },
    { key: 'logs', label: 'Container logs', what: 'Crash output included.', bytes: 300 * 1000 ** 2, count: 3 },
    { key: 'predeploy', label: 'Pre-deploy database dumps', what: 'The dump each deploy takes.', bytes: 800 * 1000 ** 2, count: 4 },
    { key: 'bundles', label: 'Old screen updates', what: 'Bundles.', bytes: 0, count: 0 },
    { key: 'system', label: 'System logs and package downloads', what: 'Journal.', bytes: 120 * 1000 ** 2, count: 9 },
  ],
  totalBytes: 2.62 * 1000 ** 3,
  waiting: null,
  history: [
    {
      id: 'h1',
      requestedAt: '2026-11-17T10:00:00Z',
      by: 'Ama',
      items: ['images'],
      state: 'done',
      finishedAt: '2026-11-17T10:01:00Z',
      freedBytes: 0,
      results: { images: { ok: false, freedBytes: 0, count: 0, error: 'Error response from daemon: conflict: unable to remove' } },
    },
  ],
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

  it('clears the crashes, and says what it cleared', async () => {
    signedIn('operator')
    const crashes = {
      restarts: { count: 2, lastAt: '2026-11-18T08:40:00Z' },
      startsLastHour: 3,
      errors: {
        open: 1,
        occurrences: 14,
        lastSeenAt: '2026-11-18T08:41:00Z',
        groups: [{ fingerprint: 'f1', message: "TypeError: Cannot read properties of undefined — POST /api/sync/replicate", count: 14, lastSeenAt: '2026-11-18T08:41:00Z', cameBack: true }],
      },
      spike: { requests: 40, serverErrors: 12 },
      lastCleared: null,
    }
    const { calls } = fakeServer([
      ...shellRoutes,
      { path: '/fleet/cloud/clean-up', reply: { crashes, space: { ...space, helper: { state: 'missing', seenAt: null }, measuredAt: null } } },
      { path: '/fleet/cloud/crashes/clear', method: 'POST', reply: { at: '2026-11-18T09:00:00Z', starts: 3, errors: 1 } },
    ])
    render(<App />)
    await go('#/cloud?tab=cleanup')
    expect(await screen.findByText('A crash loop')).toBeTruthy()
    expect(screen.getByText('12 of 40 failed')).toBeTruthy()
    expect(screen.getByText('Came back')).toBeTruthy()
    // The helper isn't there yet: said plainly, and nothing to tick.
    expect(screen.getByText(/never reported from the droplet/)).toBeTruthy()
    // An operator can clear crashes but not free space.
    expect(screen.getByText('Only admins can free space.')).toBeTruthy()
    await act(async () => screen.getByRole('button', { name: 'Clear crashes' }).click())
    expect(await screen.findByText(/Cleared 3 starts and 1 error/)).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/fleet/cloud/crashes/clear')).toBe(true)
  })

  it('frees space through the helper, asking for the password, and leaves the dumps unticked', async () => {
    signedIn('admin')
    const { calls } = fakeServer([
      ...shellRoutes,
      { path: '/fleet/cloud/clean-up', reply: { crashes: quiet, space } },
      { path: '/fleet/cloud/clean-up', method: 'POST', status: 202, reply: space },
    ])
    render(<App />)
    await go('#/cloud?tab=cleanup')
    const images = (await screen.findByRole('checkbox', { name: 'Free Old server images' })) as HTMLInputElement
    expect(images.checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Free Pre-deploy database dumps' }) as HTMLInputElement).checked).toBe(false)
    // Nothing to free in the bundles: not ticked either.
    expect((screen.getByRole('checkbox', { name: 'Free Old screen updates' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('up to 1.4 GB')).toBeTruthy()
    // Last time, one kind failed: its reason is kept.
    expect(screen.getByText(/conflict: unable to remove/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Free 1\.\d GB…$/ }))
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Free it', hidden: true }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/fleet/cloud/clean-up')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/fleet/cloud/clean-up')
    expect(sent?.body).toEqual({ items: ['images', 'logs', 'system'], password: 'secret' })
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
