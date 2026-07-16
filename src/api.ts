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
