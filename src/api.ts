/**
 * Thin client for the cloud droplet's /fleet/* endpoints. The base URL and the
 * admin bearer are supplied by the login screen and kept in localStorage; every
 * call carries the bearer, and a 401 bubbles up so the UI can drop the session.
 */

export interface DeviceRow {
  deviceId: string
  shopId: string | null
  shopName: string | null
  appVersion: string | null
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
  firstReportAt: string
  lastReportAt: string
  online: boolean
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
}

/* ---- store onboarding (WS3): /api/stores/*, same admin bearer ---- */

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

export class Unauthorized extends Error {}

const trimBase = (base: string) => base.replace(/\/+$/, '')

export async function login(apiBase: string, password: string): Promise<string> {
  const res = await fetch(`${trimBase(apiBase)}/fleet/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.status === 401) throw new Unauthorized('Wrong password')
  if (res.status === 503) throw new Error('Fleet dashboard is not enabled on this server')
  if (!res.ok) throw new Error(`Login failed (HTTP ${res.status})`)
  const body = (await res.json()) as { token: string }
  return body.token
}

async function authedGet<T>(apiBase: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${trimBase(apiBase)}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new Unauthorized('Session expired')
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

export function getDevices(apiBase: string, token: string): Promise<{ devices: DeviceRow[] }> {
  return authedGet(apiBase, token, '/fleet/devices')
}

export function getErrors(
  apiBase: string,
  token: string,
  deviceId?: string,
): Promise<{ errors: ErrorRow[] }> {
  const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''
  return authedGet(apiBase, token, `/fleet/errors${q}`)
}

async function authedPost<T>(
  apiBase: string,
  token: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${trimBase(apiBase)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 401) throw new Unauthorized('Session expired')
  if (!res.ok) {
    // Server errors carry { error, message } — surface the message when present.
    const detail = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detail?.message ?? `Request failed (HTTP ${res.status})`)
  }
  return res.json() as Promise<T>
}

export function getShops(apiBase: string, token: string): Promise<{ shops: ShopRow[] }> {
  return authedGet(apiBase, token, '/api/stores')
}

export function provisionShop(
  apiBase: string,
  token: string,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  return authedPost(apiBase, token, '/api/stores/provision', input)
}

export function reissueClaimCode(
  apiBase: string,
  token: string,
  shopId: string,
): Promise<{ claimCode: string; expiresAt: string }> {
  return authedPost(apiBase, token, `/api/stores/${shopId}/claim-code`)
}

export function revokeStoreKey(
  apiBase: string,
  token: string,
  keyId: string,
): Promise<{ ok: true }> {
  return authedPost(apiBase, token, `/api/stores/keys/${keyId}/revoke`)
}
