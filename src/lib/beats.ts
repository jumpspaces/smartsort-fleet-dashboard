import type { HistoryBeat } from '../api/types.ts'

export interface HourBucket {
  /** Start of the hour, ms. */
  at: number
  /** Most sales waiting to send at any check-in that hour; null = no check-in. */
  unsent: number | null
  /** Takings recorded during the hour, in pesewas; null = no check-in. */
  sales: number | null
}

/**
 * Fold heartbeats into hourly buckets for the last `hours`.
 *
 * Sales arrive as a running "today" total, so takings in an hour are the rise
 * between check-ins. The total drops back at the till's midnight; a drop is a
 * new day, and the new total is what was taken since.
 */
export function hourly(beats: HistoryBeat[], hours: number, now = Date.now()): HourBucket[] {
  const HOUR = 3_600_000
  const end = Math.floor(now / HOUR) * HOUR + HOUR
  const start = end - hours * HOUR
  const buckets: HourBucket[] = Array.from({ length: hours }, (_, i) => ({ at: start + i * HOUR, unsent: null, sales: null }))
  const sorted = [...beats].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
  let prevTotal: number | null = null
  for (const b of sorted) {
    const t = Date.parse(b.capturedAt)
    const total = b.salesTodayPesewas
    const delta = total == null ? 0 : prevTotal == null ? 0 : total >= prevTotal ? total - prevTotal : total
    if (total != null) prevTotal = total
    if (t < start || t >= end) continue
    const bucket = buckets[Math.floor((t - start) / HOUR)]!
    const unsent = (b.syncPending ?? 0) + (b.syncFailed ?? 0)
    bucket.unsent = Math.max(bucket.unsent ?? 0, unsent)
    bucket.sales = (bucket.sales ?? 0) + delta
  }
  return buckets
}
