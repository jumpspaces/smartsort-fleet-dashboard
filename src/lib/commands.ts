import type { Command, CommandSpec, CommandState, DbCheck, Device, HardwareReport, LockReason, Recipe, StuckRows } from '../api/types.ts'
import { bytes, plural } from './format.ts'

/**
 * Remote commands, in the console's words — shared by a till's own page and
 * the fleet-wide history, so a state reads the same wherever it is seen.
 */

export const COMMAND_STATE: Record<CommandState, string> = {
  awaiting_approval: 'Waiting for a second operator',
  pending: 'Waiting for the till',
  sent: 'Sent to the till',
  done: 'Done',
  failed: 'Failed',
  expired: 'Till never picked it up',
}

/** Shorter, for a badge in a table. */
export const COMMAND_STATE_SHORT: Record<CommandState, string> = {
  awaiting_approval: 'Needs approval',
  pending: 'Waiting',
  sent: 'Sent',
  done: 'Done',
  failed: 'Failed',
  expired: 'Never picked up',
}

export const isOpen = (c: Pick<Command, 'state'>) =>
  c.state === 'awaiting_approval' || c.state === 'pending' || c.state === 'sent'

export const LOCK_REASON_LABEL: Record<LockReason, { label: string; hint: string }> = {
  support_hold: {
    label: 'Paused by support',
    hint: 'The till says it is paused and will come back by itself.',
  },
  decommissioned: {
    label: 'Retired',
    hint: 'The till says it is no longer in use.',
  },
  stolen: {
    label: 'Missing or stolen',
    hint: 'The till says only that it is locked — nothing about why.',
  },
}

/**
 * The commands this till can be sent. A build that lists none knows the
 * original set; the server would refuse anything else, so the console never
 * offers it.
 */
export function supportedCommands(device: Pick<Device, 'capabilities'>, catalogue: CommandSpec[]): Set<string> {
  if (device.capabilities) return new Set(device.capabilities)
  // A server from before capabilities marks nothing as legacy — and refuses
  // nothing on those grounds either, so everything it lists is fair game.
  if (!catalogue.some((c) => typeof c.legacy === 'boolean')) return new Set(catalogue.map((c) => c.name))
  return new Set(catalogue.filter((c) => c.legacy).map((c) => c.name))
}

/** A JSON result the till sent back, or null if it is not one (or was cut short). */
function parseJson<T>(text: string | null | undefined, ok: (v: unknown) => v is T): T | null {
  if (!text) return null
  try {
    const value = JSON.parse(text) as unknown
    return ok(value) ? value : null
  } catch {
    return null
  }
}

export const parseStuckRows = (text: string | null | undefined) =>
  parseJson<StuckRows>(
    text,
    (v): v is StuckRows => !!v && typeof v === 'object' && Array.isArray((v as StuckRows).received) && Array.isArray((v as StuckRows).sending),
  )

export const parseDbCheck = (text: string | null | undefined) =>
  parseJson<DbCheck>(text, (v): v is DbCheck => !!v && typeof v === 'object' && Array.isArray((v as DbCheck).tables))

export const parseHardware = (text: string | null | undefined) =>
  parseJson<HardwareReport>(
    text,
    (v): v is HardwareReport => !!v && typeof v === 'object' && Array.isArray((v as HardwareReport).items),
  )

const PART: Record<HardwareReport['items'][number]['part'], string> = {
  printer: 'Receipt printer',
  drawer: 'Cash drawer',
  display: 'Customer screen',
}
export const hardwarePart = (p: HardwareReport['items'][number]['part']) => PART[p]

/** Recipes this till can run: every step must be one it knows. */
export function supportedRecipes(supported: Set<string>, recipes: Recipe[]): Recipe[] {
  return recipes.filter((r) => r.steps.every((s) => supported.has(s)))
}

/** One line for a command's outcome — structured results summarised, not dumped. */
export function outcomeLine(c: Pick<Command, 'command' | 'result' | 'error'>): string | null {
  if (c.error) return c.error
  if (!c.result) return null
  if (c.command === 'pull.inspect') {
    const r = parseStuckRows(c.result)
    if (r) {
      if (r.receivedTotal === 0 && r.sendingTotal === 0) return 'Nothing stuck.'
      return `${plural(r.receivedTotal, 'received row')} not applied, ${plural(r.sendingTotal, 'row')} not sent.`
    }
  }
  if (c.command === 'hardware.check') {
    const r = parseHardware(c.result)
    if (r) {
      const missing = r.items.filter((i) => i.status === 'missing')
      return missing.length === 0
        ? 'Everything set up was found.'
        : `${missing.map((i) => PART[i.part]).join(', ')} not found.`
    }
  }
  if (c.command === 'db.check') {
    const r = parseDbCheck(c.result)
    if (r) {
      const bad = r.tables.filter((t) => t.error).length
      const size = r.sizeBytes != null ? `, ${bytes(r.sizeBytes)}` : ''
      return bad === 0
        ? `All ${plural(r.tables.length, 'table')} read cleanly${size}.`
        : `${plural(bad, 'table')} could not be read${size}.`
    }
  }
  return c.result
}

/** When a command should go. `at` is a value from <input type="datetime-local">. */
export type Timing = { kind: 'now' } | { kind: 'quiet' } | { kind: 'closing' } | { kind: 'at'; at: string }

export function timingFields(t: Timing): { notBefore?: string; whenQuiet?: boolean; afterClosing?: boolean } {
  if (t.kind === 'quiet') return { whenQuiet: true }
  if (t.kind === 'closing') return { afterClosing: true }
  if (t.kind === 'at') {
    const when = new Date(t.at)
    if (!Number.isNaN(when.getTime())) return { notBefore: when.toISOString() }
  }
  return {}
}

/** A Date as <input type="datetime-local"> wants it: local time, to the minute. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "after 22:00", "when quiet" — the hold a waiting command is under, if any. */
export function holdLine(c: Pick<Command, 'notBefore' | 'whenQuiet' | 'state'>, now = Date.now()): string | null {
  if (c.state !== 'pending') return null
  const parts: string[] = []
  if (c.notBefore && Date.parse(c.notBefore) > now) {
    const at = new Date(c.notBefore)
    const sameDay = at.toDateString() === new Date(now).toDateString()
    parts.push(
      `not before ${at.toLocaleString([], sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`,
    )
  }
  if (c.whenQuiet) parts.push('once the till has gone 10 minutes without a sale')
  return parts.length ? `Held ${parts.join(', ')}` : null
}

/** Live mode, as the console can tell it from the device row. */
export type LiveState = 'off' | 'connecting' | 'live'

export function liveState(d: Pick<Device, 'liveUntil' | 'lastReportAt'>, now = Date.now()): LiveState {
  if (!d.liveUntil || Date.parse(d.liveUntil) <= now) return 'off'
  // A live till checks in every 15 seconds; one that hasn't within 45 has not
  // heard yet that it is being watched (it learns on its next ordinary beat).
  return now - Date.parse(d.lastReportAt) <= 45_000 ? 'live' : 'connecting'
}
