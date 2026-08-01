/**
 * Client for the cloud droplet's fleet control plane.
 *
 * Sessions, not a stored password. Sign-in exchanges an operator's own
 * credentials for a short access token (30 min) and a refresh token (one working
 * day); every call carries the access token, and a 401 triggers exactly ONE
 * refresh attempt before the UI drops to the sign-in screen. That single-flight
 * refresh matters because the dashboard polls several endpoints at once — six
 * parallel 401s must not become six refresh calls, five of which race and lose.
 *
 * Health is no longer computed here. The server returns `state` and `reasons`
 * per device, because deciding them needs a time-windowed count of errors that
 * are still open after triage — a database question. This file transports; it
 * does not judge.
 */

/* ------------------------------------------------------------------- types */

export interface Operator {
  id: string
  email: string
  name: string
  role: 'admin' | 'operator' | 'viewer'
}

export interface Session {
  apiBase: string
  accessToken: string
  refreshToken: string
  operator: Operator
}

export type FleetState = 'healthy' | 'attention' | 'offline'

export interface HealthReason {
  code:
    | 'offline'
    | 'server_down'
    | 'sync_failed'
    | 'sync_stuck'
    | 'sync_deep'
    | 'errors_recent'
    | 'unverified_key'
  label: string
  severity: 'critical' | 'warning'
}

export interface DeviceRow {
  deviceId: string
  shopId: string | null
  shopName: string | null
  appVersion: string | null
  /** Renderer hot-patch in use, or null on the build from the installer. */
  bundleVersion: string | null
  platform: string | null
  osVersion: string | null
  mode: string | null
  serverHealthy: boolean | null
  appUptimeSec: number | null
  syncPending: number | null
  syncFailed: number | null
  oldestPendingAgeMs: number | null
  lastSyncAt: string | null
  salesTodayCount: number | null
  salesTodayPesewas: number | null
  dbSizeBytes: number | null
  /** False = reporting on the shared enrollment secret, identity unproven. */
  keyVerified: boolean
  firstReportAt: string
  lastReportAt: string
  /** Server-computed. */
  state: FleetState
  reasons: HealthReason[]
  online: boolean
  recentOpenErrorGroups: number
  openAlerts: number
}

export interface DevicePage {
  devices: DeviceRow[]
  total: number
  limit: number
  offset: number
}

export interface DeviceQuery {
  q?: string
  state?: FleetState | 'all'
  shopId?: string
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface ErrorRow {
  id: string
  deviceId: string
  shopId: string | null
  fingerprint: string
  source: string | null
  message: string
  stack: string | null
  appVersion: string | null
  count: number
  firstSeen: string
  lastSeen: string
  status: 'open' | 'resolved' | 'ignored' | null
}

export type GroupStatus = 'open' | 'resolved' | 'ignored'

export interface ErrorGroupRow {
  id: string
  fingerprint: string
  message: string
  source: string | null
  stack: string | null
  totalCount: number
  deviceCount: number
  firstVersion: string | null
  lastVersion: string | null
  firstSeen: string
  lastSeen: string
  status: GroupStatus
  resolvedAt: string | null
  resolvedInVersion: string | null
  regressedAt: string | null
}

export interface GroupPage {
  groups: ErrorGroupRow[]
  total: number
  limit: number
  offset: number
}

export interface GroupDevice {
  deviceId: string
  shopId: string | null
  count: number
  appVersion: string | null
  firstSeen: string
  lastSeen: string
}

export interface AlertRow {
  id: string
  ruleKey: string
  deviceId: string | null
  shopId: string | null
  shopName: string | null
  severity: 'warning' | 'critical'
  title: string
  detail: string | null
  state: 'open' | 'acknowledged' | 'resolved'
  openedAt: string
  lastSeenAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  notifiedAt: string | null
  notifyError: string | null
}

export interface CommandSpec {
  name: string
  label: string
  description: string
}

export interface CommandRow {
  id: string
  deviceId: string
  command: string
  payload: unknown
  state: 'pending' | 'sent' | 'done' | 'failed' | 'expired'
  issuedByLabel: string | null
  issuedAt: string
  sentAt: string | null
  completedAt: string | null
  expiresAt: string
  ok: boolean | null
  result: string | null
  error: string | null
}

export interface Overview {
  counts: { all: number; healthy: number; attention: number; offline: number }
  pendingCommands: number
  uptimeBps30d: number | null
  syncLagMs: { p50: number | null; p95: number | null }
  versions: { version: string; count: number }[]
  openErrorGroups: number
  openAlerts: number
  unverifiedDevices: number
  windowHours: number
}

export interface HistoryBeat {
  capturedAt: string
  syncPending: number | null
  syncFailed: number | null
  oldestPendingAgeMs: number | null
  salesTodayCount: number | null
  salesTodayPesewas: number | null
  appVersion: string | null
  serverHealthy: boolean | null
  errorGroups: number
}

export interface DeviceDayRow {
  day: string
  beats: number
  expectedBeats: number
  uptimeBps: number
  maxSyncPending: number | null
  maxSyncFailed: number | null
  salesCount: number | null
  salesPesewas: number | null
  appVersion: string | null
}

export interface DeviceHistory {
  beats: HistoryBeat[]
  days: DeviceDayRow[]
  uptimeBps: number | null
}

export interface AuditRow {
  id: string
  actorLabel: string | null
  action: string
  targetType: string | null
  targetId: string | null
  detail: unknown
  ip: string | null
  createdAt: string
}

/* ---- store onboarding: /api/stores/*, same operator session ---- */

export interface ShopMachine {
  keyId: string
  machineId: string
  machineName: string | null
  terminalCode: string
  keyPrefix: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  lastReportAt: string | null
}

export interface ShopRow {
  id: string
  name: string
  /** Typed alongside the staff ID when signing in to the cloud. */
  code: string | null
  location: string | null
  phone: string | null
  currency: string
  createdAt: string
  owner: { id: string; name: string; staffId: string; active: boolean } | null
  activated: boolean
  hasLiveClaimCode: boolean
  claimCodeExpiresAt: string | null
  machines: ShopMachine[]
}

export interface ProvisionInput {
  shopName: string
  location?: string
  phone?: string
  currency?: string
  ownerName: string
  staffId: string
}

export interface ProvisionResult {
  shopId: string
  shopCode: string
  ownerId: string
  claimCode: string
  expiresAt: string
}

/* ----------------------------------------------------------------- errors */

export class Unauthorized extends Error {}

/** Thrown for a 403 — signed in, but this role may not do that. */
export class Forbidden extends Error {}

const trimBase = (base: string) => base.replace(/\/+$/, '')

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null
  const message = body?.message ?? `Request failed (HTTP ${res.status})`
  if (res.status === 403) return new Forbidden(message)
  return new Error(message)
}

/* ------------------------------------------------------------------ login */

export async function signIn(
  apiBase: string,
  email: string,
  password: string,
): Promise<Session> {
  const res = await fetch(`${trimBase(apiBase)}/fleet/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 503) {
    throw new Error('The fleet control plane is not enabled on this server')
  }
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as Omit<Session, 'apiBase'>
  return { apiBase: trimBase(apiBase), ...body }
}

/* ----------------------------------------------------------------- client */

export interface Api {
  operator: Operator
  apiBase: string
  overview(): Promise<Overview>
  devices(query?: DeviceQuery): Promise<DevicePage>
  device(deviceId: string): Promise<DeviceRow>
  deviceHistory(deviceId: string, hours?: number): Promise<DeviceHistory>
  deviceErrors(deviceId: string): Promise<ErrorRow[]>
  errorGroups(query?: { status?: GroupStatus | 'all'; q?: string; limit?: number; offset?: number }): Promise<GroupPage>
  groupDevices(fingerprint: string): Promise<GroupDevice[]>
  setGroupStatus(
    fingerprint: string,
    status: GroupStatus,
    resolvedInVersion?: string | null,
  ): Promise<void>
  alerts(state?: string): Promise<AlertRow[]>
  acknowledgeAlert(id: string): Promise<void>
  audit(limit?: number): Promise<AuditRow[]>
  commandCatalogue(): Promise<CommandSpec[]>
  deviceCommands(deviceId: string): Promise<CommandRow[]>
  issueCommand(deviceId: string, command: string, payload?: unknown): Promise<CommandRow>
  cancelCommand(id: string): Promise<void>
  shops(): Promise<ShopRow[]>
  provisionShop(input: ProvisionInput): Promise<ProvisionResult>
  reissueClaimCode(shopId: string): Promise<{ claimCode: string; expiresAt: string }>
  revokeStoreKey(keyId: string): Promise<void>
}

/**
 * Build the API surface for a signed-in session.
 *
 * `onRenewed` is called whenever a refresh produces new tokens so the caller can
 * persist them; `onExpired` when the session is beyond saving.
 */
export function createApi(
  initial: Session,
  hooks: { onRenewed: (s: Session) => void; onExpired: () => void },
): Api {
  let session = initial
  // One shared refresh at a time. Six concurrent 401s should produce one refresh
  // and five waiters, not six competing attempts that invalidate each other.
  let refreshing: Promise<boolean> | null = null

  async function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const res = await fetch(`${session.apiBase}/fleet/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        })
        if (!res.ok) return false
        const body = (await res.json()) as Omit<Session, 'apiBase'>
        session = { apiBase: session.apiBase, ...body }
        hooks.onRenewed(session)
        return true
      } catch {
        return false
      } finally {
        // Cleared on the next tick so waiters settled in this microtask all read
        // the same result before another refresh can start.
        setTimeout(() => {
          refreshing = null
        }, 0)
      }
    })()
    return refreshing
  }

  async function call<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
    const res = await fetch(`${session.apiBase}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
        Authorization: `Bearer ${session.accessToken}`,
      },
    })

    if (res.status === 401 && !retried) {
      if (await refresh()) return call<T>(path, init, true)
      hooks.onExpired()
      throw new Unauthorized('Session expired')
    }
    if (res.status === 401) {
      hooks.onExpired()
      throw new Unauthorized('Session expired')
    }
    if (!res.ok) throw await failure(res)
    return res.json() as Promise<T>
  }

  const post = <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

  const query = (params: Record<string, string | number | undefined>): string => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== 'all') qs.set(k, String(v))
    }
    const s = qs.toString()
    return s ? `?${s}` : ''
  }

  return {
    get operator() {
      return session.operator
    },
    get apiBase() {
      return session.apiBase
    },

    overview: () => call<Overview>('/fleet/overview'),

    devices: (q = {}) =>
      call<DevicePage>(
        `/fleet/devices${query({
          q: q.q,
          state: q.state,
          shopId: q.shopId,
          sort: q.sort,
          dir: q.dir,
          limit: q.limit,
          offset: q.offset,
        })}`,
      ),

    device: async (deviceId) =>
      (await call<{ device: DeviceRow }>(`/fleet/devices/${encodeURIComponent(deviceId)}`)).device,

    deviceHistory: (deviceId, hours = 48) =>
      call<DeviceHistory>(
        `/fleet/devices/${encodeURIComponent(deviceId)}/history${query({ hours })}`,
      ),

    deviceErrors: async (deviceId) =>
      (await call<{ errors: ErrorRow[] }>(`/fleet/errors${query({ deviceId })}`)).errors,

    errorGroups: (q = {}) =>
      call<GroupPage>(
        `/fleet/errors${query({ status: q.status, q: q.q, limit: q.limit, offset: q.offset })}`,
      ),

    groupDevices: async (fingerprint) =>
      (
        await call<{ devices: GroupDevice[] }>(
          `/fleet/errors/${encodeURIComponent(fingerprint)}/devices`,
        )
      ).devices,

    setGroupStatus: async (fingerprint, status, resolvedInVersion) => {
      await post(`/fleet/errors/${encodeURIComponent(fingerprint)}/status`, {
        status,
        resolvedInVersion: resolvedInVersion ?? null,
      })
    },

    alerts: async (state = 'open') =>
      (await call<{ alerts: AlertRow[] }>(`/fleet/alerts${query({ state })}`)).alerts,

    acknowledgeAlert: async (id) => {
      await post(`/fleet/alerts/${encodeURIComponent(id)}/ack`)
    },

    audit: async (limit = 100) =>
      (await call<{ entries: AuditRow[] }>(`/fleet/audit${query({ limit })}`)).entries,

    commandCatalogue: async () =>
      (await call<{ commands: CommandSpec[] }>('/fleet/commands')).commands,

    deviceCommands: async (deviceId) =>
      (
        await call<{ commands: CommandRow[] }>(
          `/fleet/devices/${encodeURIComponent(deviceId)}/commands`,
        )
      ).commands,

    issueCommand: async (deviceId, command, payload) =>
      (
        await post<{ command: CommandRow }>(
          `/fleet/devices/${encodeURIComponent(deviceId)}/commands`,
          { command, payload },
        )
      ).command,

    cancelCommand: async (id) => {
      await post(`/fleet/commands/${encodeURIComponent(id)}/cancel`)
    },

    shops: async () => (await call<{ shops: ShopRow[] }>('/api/stores')).shops,

    provisionShop: (input) => post<ProvisionResult>('/api/stores/provision', input),

    reissueClaimCode: (shopId) =>
      post<{ claimCode: string; expiresAt: string }>(
        `/api/stores/${encodeURIComponent(shopId)}/claim-code`,
      ),

    revokeStoreKey: async (keyId) => {
      await post(`/api/stores/keys/${encodeURIComponent(keyId)}/revoke`)
    },
  }
}
