import type { AlertRow, DeviceRow, ErrorGroupRow, Overview } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { compactCount, exact, timeAgo } from './format.ts'
import { ruleLabel, terminalName } from './state.ts'

/**
 * The Triage queue: open alerts, unhealthy terminals and today's error groups,
 * folded into one list with each problem in it once. Kept apart from the view
 * so the folding rules — the part that is easy to get subtly wrong — are tested
 * without rendering anything.
 */

/** Error groups last seen within this window are queued; older ones are backlog. */
export const FRESH_ERROR_MS = 24 * 60 * 60 * 1000

export type Severity = 'critical' | 'warning'

export interface Item {
  key: string
  kind: 'alert' | 'device' | 'error'
  severity: Severity
  acknowledged: boolean
  title: string
  where: string | null
  detail: string | null
  /** What the right-hand column says, e.g. "opened 2h ago". */
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

/**
 * One row per problem, critical first then newest. `now` is a parameter so
 * the 24-hour error window is testable.
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
    items.push({
      key: `alert:${key}`,
      kind: 'alert',
      severity: list.some((x) => x.severity === 'critical') ? 'critical' : 'warning',
      acknowledged: a.state === 'acknowledged',
      title: group
        ? `New error: ${group.message}`
        : many
          ? ruleLabel(a.ruleKey)
          : stripShop(a.title || ruleLabel(a.ruleKey), a.shopName),
      where: group
        ? group.source
        : where(a.shopName, many ? `${list.length} terminals` : d ? terminalName(d) : null),
      detail: undelivered
        ? 'Could not be delivered'
        : a.rollupCount && a.rollupCount > 1
          ? null
          : group
            ? `${compactCount(group.totalCount)}× on ${group.deviceCount} terminal${group.deviceCount === 1 ? '' : 's'}`
            : many
              ? null
              : a.detail,
      when: `opened ${timeAgo(openedIso)}`,
      whenTitle: exact(openedIso),
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
  // terminals are already represented by that one row.
  const shopCovered = new Set(
    alerts.filter((a) => a.state !== 'resolved' && !a.deviceId && a.shopId).map((a) => a.shopId!),
  )

  // An unhealthy terminal with no alert of its own is the gap the evaluator has
  // not covered — but not when the only reason is recent errors, which the
  // error groups below already carry, once, fleet-wide.
  const loose: { d: DeviceRow; reasons: DeviceRow['reasons'] }[] = []
  for (const d of devices) {
    if (d.state === 'healthy' || d.mute || d.openAlerts > 0) continue
    if (d.shopId && shopCovered.has(d.shopId)) continue
    const reasons = d.reasons.filter((r) => r.code !== 'errors_recent')
    if (d.state !== 'offline' && reasons.length === 0) continue
    loose.push({ d, reasons })
  }

  // The same reason on many terminals is one fleet-wide job (rotating keys,
  // a bad build), so past a couple it becomes one row that opens the list.
  const byReason = new Map<string, typeof loose>()
  for (const entry of loose) {
    const code = entry.d.state === 'offline' ? 'offline' : (entry.reasons[0]?.code ?? 'other')
    byReason.set(code, [...(byReason.get(code) ?? []), entry])
  }
  for (const [code, list] of byReason) {
    const offline = code === 'offline'
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
        title: offline ? 'Terminals offline' : (first.reasons[0]?.label ?? 'Needs attention'),
        where: `${list.length} terminals in ${shops} shop${shops === 1 ? '' : 's'}`,
        detail: null,
        when: `seen ${timeAgo(latestIso)}`,
        whenTitle: exact(latestIso),
        at: latest,
        open: () => onNavigate('terminals', { state: offline ? 'offline' : 'attention' }),
      })
      continue
    }
    for (const { d, reasons } of list) {
      const reason = reasons[0]
      items.push({
        key: `device:${d.deviceId}`,
        kind: 'device',
        severity: offline ? 'critical' : (reason?.severity ?? 'warning'),
        acknowledged: false,
        title: offline ? 'Terminal offline' : (reason?.label ?? 'Needs attention'),
        where: where(d.shopName ?? 'Unclaimed', terminalName(d)),
        detail: reasons.length > 1 ? `+${reasons.length - 1} more` : null,
        when: `seen ${timeAgo(d.lastReportAt)}`,
        whenTitle: exact(d.lastReportAt),
        at: Date.parse(d.lastReportAt),
        open: () => onNavigate('device', { id: d.deviceId }),
      })
    }
  }

  // An error group with its own "new error in the field" alert is that alert.
  for (const g of groups) {
    const last = Date.parse(g.lastSeen)
    if (now - last > FRESH_ERROR_MS || alerted.has(g.fingerprint)) continue
    const regressed = g.regressedAt != null && now - Date.parse(g.regressedAt) < FRESH_ERROR_MS
    items.push({
      key: `error:${g.fingerprint}`,
      kind: 'error',
      severity: regressed || g.deviceCount >= 5 ? 'critical' : 'warning',
      acknowledged: false,
      title: g.message,
      where: g.source,
      detail: `${regressed ? 'Regressed · ' : ''}${compactCount(g.totalCount)}× on ${g.deviceCount} terminal${g.deviceCount === 1 ? '' : 's'}`,
      when: `last ${timeAgo(g.lastSeen)}`,
      whenTitle: exact(g.lastSeen),
      at: last,
      open: () => onNavigate('error', { id: g.fingerprint }),
    })
  }

  const rank = (s: Severity) => (s === 'critical' ? 0 : 1)
  return items.sort((a, b) => rank(a.severity) - rank(b.severity) || b.at - a.at)
}

/* -------------------------------------------------------------------- copy */

export function headline(needs: number, loading: boolean): string {
  if (loading) return 'Triage'
  if (needs === 0) return 'All clear'
  return `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you`
}

export function subline(
  counts: Overview['counts'] | undefined,
  needs: number,
  inHand: number,
): string {
  if (!counts) return 'Alerts, unhealthy terminals and today’s new errors, in one queue.'
  const parts = [`${counts.all} terminal${counts.all === 1 ? '' : 's'}`]
  if (counts.offline > 0) parts.push(`${counts.offline} offline`)
  if (counts.attention > 0) parts.push(`${counts.attention} need attention`)
  if (counts.offline === 0 && counts.attention === 0) parts.push('all checking in')
  if (needs === 0 && inHand > 0) parts.push(`${inHand} in hand`)
  return parts.join(' · ')
}
