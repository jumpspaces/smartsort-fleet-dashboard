import type { AlertRow, FleetState, GroupStatus, HealthReason } from '../api.ts'
import type { Tone } from '../components/ui.tsx'

/**
 * Display vocabulary for the states the SERVER decides.
 *
 * This file used to contain the health rules themselves. They moved to the
 * server (lib/fleet-health.ts) because deciding them needs a 24-hour window over
 * error groups that are still open after triage — the client only ever saw
 * lifetime totals, which is why a single error in March pinned a terminal at
 * "Attention" forever. What is left here is the mapping from a state to how it
 * looks and reads, which is genuinely a client concern.
 */

export const TONE: Record<FleetState, Tone> = {
  healthy: 'ok',
  attention: 'warn',
  offline: 'bad',
}

export const STATE_LABEL: Record<FleetState, string> = {
  healthy: 'Healthy',
  attention: 'Attention',
  offline: 'Offline',
}

/**
 * The one-line "why", for a table cell. Reasons arrive worst-first, so the head
 * of the list is the thing to act on; the rest stay available in the drawer.
 */
export function primaryReason(reasons: HealthReason[]): string | null {
  return reasons[0]?.label ?? null
}

export const severityTone = (severity: 'critical' | 'warning'): Tone =>
  severity === 'critical' ? 'bad' : 'warn'

export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  ignored: 'Ignored',
}

export const GROUP_STATUS_TONE: Record<GroupStatus, Tone> = {
  open: 'warn',
  resolved: 'ok',
  ignored: 'idle',
}

export const ALERT_STATE_LABEL: Record<AlertRow['state'], string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export const ALERT_STATE_TONE: Record<AlertRow['state'], Tone> = {
  open: 'bad',
  acknowledged: 'warn',
  resolved: 'ok',
}

/**
 * Rule keys are stable identifiers, not prose. This is the only place that turns
 * them into something a human reads, so a new rule shows up here or not at all.
 */
export const RULE_LABEL: Record<string, string> = {
  'device.offline': 'Terminal offline',
  'server.down': 'Local server down',
  'sync.failed': 'Sync failures',
  'sync.stuck': 'Sync queue stuck',
  'sync.deep': 'Sync queue backing up',
  'errors.spike': 'Error spike',
  'errors.new_group': 'New error in the field',
  'sales.flatline': 'No sales today',
}

export const ruleLabel = (key: string): string => RULE_LABEL[key] ?? key
