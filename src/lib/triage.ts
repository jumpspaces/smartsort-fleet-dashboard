import type { AlertRow, DeviceRow, ErrorGroupRow, FleetState, Overview } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { compactCount, exact, timeAgo } from './format.ts'
import { reasonPlain, rulePlain, tills } from './plain.ts'
import { ruleLabel, terminalName } from './state.ts'

/**
 * The Home queue: open alerts, unhealthy tills and today's app problems,
 * folded into one list with each problem in it once. Kept apart from the view
 * so the folding rules — the part that is easy to get subtly wrong — are tested
 * without rendering anything.
 */

/** App problems last seen within this window are queued; older ones are backlog. */
export const FRESH_ERROR_MS = 24 * 60 * 60 * 1000

export type Severity = 'critical' | 'warning'

export interface Item {
  key: string
  kind: 'alert' | 'device' | 'error'
  severity: Severity
  acknowledged: boolean
  /** The problem in everyday words. */
  title: string
  /** Shop and till, or how many. */
  where: string | null
  /** What usually fixes it. */
  hint: string | null
  /** The server's own wording, for hover text — whoever goes deeper still has it. */
  tech: string | null
  /** What the right-hand column says, e.g. "2h ago". */
  when: string
  whenTitle?: string
  /** Sort key: newest first within a severity. */
  at: number
  /** The alerts this row stands for — several when one rule fired on each of a shop's tills. */
  alerts?: AlertRow[]
  open: () => void
}

function where(shopName: string | null, terminal: string | null): string | null {
  return [shopName, terminal].filter(Boolean).join(' · ') || null
}

/**
 * "Kumasi Mart: local server is down" under a row that already says Kumasi
 * Mart — the server writes titles for webhooks, which have no other column.
 */
export function stripShop(title: string, shopName: string | null): string {
  if (!shopName) return title
  const prefix = `${shopName}: `
  const rest = title.startsWith(prefix) ? title.slice(prefix.length) : title
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

const techOf = (...parts: (string | null | undefined)[]): string | null =>
  parts.filter(Boolean).join('\n') || null

/**
 * One row per problem, critical first then newest. `now` is a parameter so
 * the 24-hour window is testable.
 */
export function buildQueue(
  alerts: AlertRow[],
  groups: ErrorGroupRow[],
  devices: DeviceRow[],
  onNavigate: Navigate,
  now: number = Date.now(),
): Item[] {
  const byId = new Map(devices.map((d) => [d.deviceId, d]))
  const items: Item[] = []

  // The server's "new error in the field" alert names its group only in prose
  // (the detail opens with the message), so match on that: the alert row then
  // opens the group, and the group is not queued a second time.
  const groupOf = (a: AlertRow): ErrorGroupRow | undefined =>
    a.ruleKey === 'errors.new_group' && a.detail
      ? groups.find((g) => a.detail!.startsWith(g.message.slice(0, 200)))
      : undefined
  const alerted = new Set(
    alerts.filter((a) => a.state !== 'resolved').map(groupOf).filter(Boolean).map((g) => g!.fingerprint),
  )

  // One rule firing on each of a shop's four tills is one thing to deal with,
  // not four rows: alerts collapse on (rule, shop, acknowledged).
  const bundles = new Map<string, AlertRow[]>()
  for (const a of alerts) {
    if (a.state === 'resolved') continue
    const key = a.deviceId && a.shopId ? `${a.ruleKey}|${a.shopId}|${a.state}` : `one|${a.id}`
    bundles.set(key, [...(bundles.get(key) ?? []), a])
  }
  for (const [key, list] of bundles) {
    const a = list[0]
    const many = list.length > 1
    const d = !many && a.deviceId ? byId.get(a.deviceId) : undefined
    const opened = Math.min(...list.map((x) => Date.parse(x.openedAt)))
    const openedIso = new Date(opened).toISOString()
    const undelivered = list.some((x) => x.notifyError)
    const group = !many ? groupOf(a) : undefined
    const plain = rulePlain(a.ruleKey)
    const serverTitle = stripShop(a.title || ruleLabel(a.ruleKey), a.shopName)
    items.push({
      key: `alert:${key}`,
      kind: 'alert',
      severity: list.some((x) => x.severity === 'critical') ? 'critical' : 'warning',
      acknowledged: a.state === 'acknowledged',
      title: plain?.title ?? serverTitle,
      where: group
        ? `${compactCount(group.totalCount)} times on ${tills(group.deviceCount)}`
        : where(a.shopName, many ? tills(list.length) : d ? terminalName(d) : null),
      hint: undelivered
        ? 'The notification for this could not be sent, so nobody else has been told.'
        : (plain?.hint ?? null),
      tech: techOf(group?.message ?? serverTitle, group ? null : a.detail),
      when: timeAgo(openedIso),
      whenTitle: `Started ${exact(openedIso)}`,
      at: opened,
      alerts: list,
      open: () =>
        group
          ? onNavigate('error', { id: group.fingerprint })
          : many && a.shopId
          ? onNavigate('shop', { id: a.shopId })
          : a.deviceId
            ? onNavigate('device', { id: a.deviceId })
            : a.shopId
              ? onNavigate('shop', { id: a.shopId })
              : onNavigate('alerts'),
    })
  }

  // Shops with a shop-level alert open (the "whole shop is dark" rollup): its
  // tills are already represented by that one row.
  const shopCovered = new Set(
    alerts.filter((a) => a.state !== 'resolved' && !a.deviceId && a.shopId).map((a) => a.shopId!),
  )

  // An unhealthy till with no alert of its own is the gap the evaluator has
  // not covered — but not when the only reason is recent errors, which the
  // app problems below already carry, once, fleet-wide.
  const loose: { d: DeviceRow; reasons: DeviceRow['reasons'] }[] = []
  for (const d of devices) {
    if (d.state === 'healthy' || d.mute || d.openAlerts > 0) continue
    if (d.shopId && shopCovered.has(d.shopId)) continue
    const reasons = d.reasons.filter((r) => r.code !== 'errors_recent')
    if (d.state !== 'offline' && reasons.length === 0) continue
    loose.push({ d, reasons })
  }

  // The same reason on many tills is one fleet-wide job (rotating keys, a bad
  // build), so past a couple it becomes one row that opens the list.
  const byReason = new Map<string, typeof loose>()
  for (const entry of loose) {
    const code = entry.d.state === 'offline' ? 'offline' : (entry.reasons[0]?.code ?? 'other')
    byReason.set(code, [...(byReason.get(code) ?? []), entry])
  }
  for (const [code, list] of byReason) {
    const offline = code === 'offline'
    const plain = reasonPlain(code)
    if (list.length > 2) {
      const shops = new Set(list.map((x) => x.d.shopId ?? 'none')).size
      const latest = Math.max(...list.map((x) => Date.parse(x.d.lastReportAt)))
      const latestIso = new Date(latest).toISOString()
      const first = list[0]
      items.push({
        key: `devices:${code}`,
        kind: 'device',
        severity: offline ? 'critical' : (first.reasons[0]?.severity ?? 'warning'),
        acknowledged: false,
        title: plain.title,
        where: `${tills(list.length)} in ${shops} shop${shops === 1 ? '' : 's'}`,
        hint: plain.hint,
        tech: first.reasons[0]?.label ?? null,
        when: timeAgo(latestIso),
        whenTitle: `Last heard from ${exact(latestIso)}`,
        at: latest,
        open: () => onNavigate('terminals', { state: offline ? 'offline' : 'attention' }),
      })
      continue
    }
    for (const { d, reasons } of list) {
      const more = reasons.filter((r) => r.code !== code).length
      items.push({
        key: `device:${d.deviceId}`,
        kind: 'device',
        severity: offline ? 'critical' : (reasons[0]?.severity ?? 'warning'),
        acknowledged: false,
        title: plain.title,
        where: where(d.shopName ?? 'No shop yet', terminalName(d)),
        hint: more > 0 ? `${plain.hint} Also ${more} other thing${more === 1 ? '' : 's'} on this till.` : plain.hint,
        tech: techOf(...reasons.map((r) => r.label)),
        when: timeAgo(d.lastReportAt),
        whenTitle: `Last heard from ${exact(d.lastReportAt)}`,
        at: Date.parse(d.lastReportAt),
        open: () => onNavigate('device', { id: d.deviceId }),
      })
    }
  }

  // An app problem with its own "new error in the field" alert is that alert.
  for (const g of groups) {
    const last = Date.parse(g.lastSeen)
    if (now - last > FRESH_ERROR_MS || alerted.has(g.fingerprint)) continue
    const regressed = g.regressedAt != null && now - Date.parse(g.regressedAt) < FRESH_ERROR_MS
    items.push({
      key: `error:${g.fingerprint}`,
      kind: 'error',
      severity: regressed || g.deviceCount >= 5 ? 'critical' : 'warning',
      acknowledged: false,
      title: regressed ? 'A fixed app problem is back' : 'The app hit a problem',
      where: `${compactCount(g.totalCount)} time${g.totalCount === 1 ? '' : 's'} on ${tills(g.deviceCount)}`,
      hint: 'Pass it to a developer — open it for the details to send them.',
      tech: g.message,
      when: timeAgo(g.lastSeen),
      whenTitle: `Last happened ${exact(g.lastSeen)}`,
      at: last,
      open: () => onNavigate('error', { id: g.fingerprint }),
    })
  }

  const rank = (s: Severity) => (s === 'critical' ? 0 : 1)
  return items.sort((a, b) => rank(a.severity) - rank(b.severity) || b.at - a.at)
}

/* -------------------------------------------------------------------- shops */

export interface ShopSummary {
  key: string
  shopId: string | null
  name: string
  total: number
  fine: number
  offline: number
  /** The worst any of its tills is. */
  state: FleetState
  /** Every till is silenced — someone already knows. */
  silenced: boolean
}

const RANK: Record<FleetState, number> = { offline: 0, attention: 1, healthy: 2 }

/**
 * The fleet by shop, worst first, because people think in shops ("is Kumasi
 * Mart all right?"), not in device IDs. Silenced tills count as fine for the
 * shop's state, so a planned outage does not sit at the top.
 */
export function summariseShops(devices: DeviceRow[]): ShopSummary[] {
  const map = new Map<string, ShopSummary>()
  for (const d of devices) {
    const key = d.shopId ?? '__none'
    let s = map.get(key)
    if (!s) {
      s = { key, shopId: d.shopId, name: d.shopName ?? 'Not in a shop yet', total: 0, fine: 0, offline: 0, state: 'healthy', silenced: true }
      map.set(key, s)
    }
    s.total += 1
    if (d.state === 'healthy') s.fine += 1
    if (d.state === 'offline') s.offline += 1
    if (!d.mute) s.silenced = false
    const counted: FleetState = d.mute ? 'healthy' : d.state
    if (RANK[counted] < RANK[s.state]) s.state = counted
  }
  return [...map.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name))
}

/** "All 4 tills fine", "2 of 4 not connected", "1 of 3 needs a look". */
export function shopLine(s: ShopSummary): string {
  if (s.fine === s.total) return s.total === 1 ? 'Its till is fine' : `All ${s.total} tills fine`
  if (s.offline === s.total) return s.total === 1 ? 'Its till is not connected' : `None of ${s.total} tills connected`
  if (s.offline > 0) return `${s.offline} of ${s.total} not connected`
  if (s.total === 1) return 'Its till needs a look'
  const trouble = s.total - s.fine
  return `${trouble} of ${s.total} need${trouble === 1 ? 's' : ''} a look`
}

/* -------------------------------------------------------------------- copy */

export function headline(needs: number, loading: boolean): string {
  if (loading) return 'Home'
  if (needs === 0) return 'Everything’s running'
  return `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} a look`
}

export function subline(
  counts: Overview['counts'] | undefined,
  needs: number,
  inHand: number,
): string {
  if (!counts) return 'Anything that needs a person shows up here.'
  const parts = [`${tills(counts.all)}`]
  if (counts.offline > 0) parts.push(`${counts.offline} not connected`)
  if (counts.attention > 0) parts.push(`${counts.attention} need${counts.attention === 1 ? 's' : ''} a look`)
  if (counts.offline === 0 && counts.attention === 0) parts.push('all connected and fine')
  if (needs === 0 && inHand > 0) parts.push(`${inHand} being handled`)
  return parts.join(' · ')
}
