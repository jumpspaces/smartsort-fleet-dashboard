/**
 * Display formatting. Everything here is read at a glance by someone deciding
 * whether to act, so the bias is toward short forms with the exact value kept
 * available in a `title` (see `exact`).
 */

/** Pesewas (integer) → GHS display. */
export function cedis(pesewas: number): string {
  return `GHS ${(pesewas / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Compact duration: 45s, 12m, 6h, 3d. */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * "12m ago" up to a week, then an absolute date — past that point the relative
 * form stops carrying information anyone can act on.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 45_000) return 'just now'
  if (diff < 0) return 'just now'
  if (diff > WEEK_MS) return shortDate(then)
  return `${duration(diff)} ago`
}

export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return '—'
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return '—'
  const diff = at - Date.now()
  if (diff <= 0) return 'now'
  return `in ${duration(diff)}`
}

/** Full timestamp for `title` attributes — the relative form's escape hatch. */
export function exact(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString()
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Milliseconds since an ISO timestamp; Infinity when it can't be parsed. */
export function ageMs(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Date.now() - t
}

/** Bytes at the granularity a person reads: "1.4 GB", "380 MB". */
export function bytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/** Basis points → percent, as availability is written: 9987 → "99.87%". */
export function bps(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—'
  return `${(n / 100).toFixed(digits)}%`
}

/** Host portion of the API base, for the sidebar's connection line. */
export function hostOf(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base.replace(/^https?:\/\//, '').replace(/\/+$/, '') || '—'
  }
}
