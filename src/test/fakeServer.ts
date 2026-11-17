import { vi } from 'vitest'

/**
 * A stand-in for the cloud: routes by method + path prefix, records every
 * request, answers JSON. Unknown routes answer 404 so a page that calls
 * something unexpected fails loudly rather than hanging.
 */
export type Handler = (req: { method: string; path: string; url: URL; body: unknown }) => unknown
export interface Route {
  method?: string
  path: string | RegExp
  reply: unknown | Handler
  status?: number
}

export function fakeServer(routes: Route[]) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body
    calls.push({ method, path: url.pathname, search: url.search, body })
    const route = routes.find(
      (r) => (r.method ?? 'GET') === method && (typeof r.path === 'string' ? url.pathname === r.path : r.path.test(url.pathname)),
    )
    if (!route) return new Response(JSON.stringify({ message: `no route ${method} ${url.pathname}` }), { status: 404 })
    const data = typeof route.reply === 'function' ? (route.reply as Handler)({ method, path: url.pathname, url, body }) : route.reply
    return new Response(JSON.stringify(data ?? {}), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch }
}

export const operator = (role: 'admin' | 'operator' | 'viewer' = 'operator') => ({
  id: 'op1',
  email: 'ama@jumpspaces.co',
  name: 'Ama',
  role,
})

export function signedIn(role: 'admin' | 'operator' | 'viewer' = 'operator') {
  localStorage.setItem(
    'fleet_session',
    JSON.stringify({ apiBase: 'https://cloud.test', accessToken: 'a', refreshToken: 'r', operator: operator(role) }),
  )
}

export const device = (over: Record<string, unknown> = {}) => ({
  deviceId: 'dev-1',
  shopId: 's1',
  shopName: 'Kumasi Mart',
  removedAt: null,
  machineName: 'Front till',
  terminalCode: 'T1',
  keyId: 'k1',
  appVersion: '2.3.1',
  bundleVersion: null,
  platform: 'win32',
  osVersion: '10',
  mode: 'exclusive',
  serverHealthy: true,
  appUptimeSec: 3600,
  syncPending: 0,
  syncFailed: 0,
  oldestPendingAgeMs: 0,
  lastSyncAt: '2026-11-16T09:00:00Z',
  lastPulledAt: '2026-11-16T09:00:00Z',
  pullQuarantined: 0,
  salesTodayCount: 12,
  salesTodayPesewas: 123450,
  dbSizeBytes: 1000,
  keyVerified: true,
  firstReportAt: '2026-10-01T09:00:00Z',
  lastReportAt: new Date().toISOString(),
  diskFreeBytes: null,
  diskTotalBytes: null,
  lastBackupAt: null,
  backupSizeBytes: null,
  backupError: null,
  clockSkewMs: 0,
  liveUntil: null,
  lastSaleAt: null,
  capabilities: null,
  controlState: null,
  state: 'healthy',
  reasons: [],
  online: true,
  recentOpenErrorGroups: 0,
  openAlerts: 0,
  mute: null,
  tags: [],
  noteCount: 0,
  pinnedNote: null,
  ...over,
})

export const overview = {
  counts: { all: 2, healthy: 1, attention: 0, offline: 1 },
  pendingCommands: 0,
  uptimeBps30d: 9950,
  syncLagMs: { p50: null, p95: null },
  versions: [{ version: '2.3.1', count: 2 }],
  openErrorGroups: 0,
  openAlerts: 1,
  unverifiedDevices: 0,
  windowHours: 24,
  release: { latestVersion: '2.3.1', releasedAt: null, installer: null, rollableVersions: ['2.3.1'], available: true },
}

export const alert = (over: Record<string, unknown> = {}) => ({
  id: 'al1',
  ruleKey: 'device.offline',
  deviceId: 'dev-2',
  shopId: 's1',
  shopName: 'Kumasi Mart',
  severity: 'critical',
  title: 'Terminal offline',
  detail: null,
  state: 'open',
  openedAt: '2026-11-16T08:00:00Z',
  lastSeenAt: '2026-11-16T09:00:00Z',
  acknowledgedAt: null,
  acknowledgedByLabel: null,
  resolvedAt: null,
  notifiedAt: '2026-11-16T08:00:01Z',
  notifyError: null,
  rollupCount: null,
  escalatedAt: null,
  escalations: 0,
  ...over,
})

/** The routes every signed-in page touches in the shell. */
export const shellRoutes: Route[] = [
  { path: '/fleet/overview', reply: overview },
  { path: '/fleet/assistant', reply: { systemEnabled: false, apiKey: { source: null, unreadable: false } } },
  { path: '/api/stores', reply: { shops: [] } },
  { method: 'POST', path: '/fleet/devices/heartbeats', reply: { strips: [] } },
  { path: '/fleet/commands/awaiting', reply: { commands: [] } },
]
