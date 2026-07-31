import type { DeviceRow } from '../api.ts'

/**
 * One definition of "how is this terminal", used by the health bar, the
 * filters, the table and the drawer. Three mutually-exclusive buckets, so the
 * proportion bar adds up and a filter chip means exactly what it says.
 */
export type FleetState = 'healthy' | 'attention' | 'offline'

export const TONE: Record<FleetState, 'ok' | 'warn' | 'bad'> = {
  healthy: 'ok',
  attention: 'warn',
  offline: 'bad',
}

export const STATE_LABEL: Record<FleetState, string> = {
  healthy: 'Healthy',
  attention: 'Attention',
  offline: 'Offline',
}

export function fleetState(d: DeviceRow, errorCount: number): FleetState {
  if (!d.online) return 'offline'
  const pending = d.syncPending ?? 0
  const failed = d.syncFailed ?? 0
  if (failed > 0 || pending > 0 || errorCount > 0) return 'attention'
  return 'healthy'
}

/** Why a terminal needs attention, in the order an operator would act on it. */
export function attentionReason(d: DeviceRow, errorCount: number): string | null {
  const failed = d.syncFailed ?? 0
  const pending = d.syncPending ?? 0
  if (failed > 0) return `${failed} sync ${failed === 1 ? 'failure' : 'failures'}`
  if (pending > 0) return `${pending} queued to sync`
  if (errorCount > 0) return `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`
  return null
}
