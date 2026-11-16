/**
 * Display formatting. Short forms for scanning; the exact value goes in a
 * `title` via `exact()`.
 */

/**
 * Integer minor units → "GHS 1,234.50", exact to the pesewa. Integer maths
 * throughout so no float ever rounds a sale, and zero never reads "-0.00".
 * The currency code is a label only — amounts are never converted.
 */
export function money(minor: number | null | undefined, currency = 'GHS'): string {
  if (minor == null) return '—'
  // Sign after the code, as the shop's own app writes it: "GHS -2.50".
  return `${currency} ${decimal(minor, true)}`
}

/**
 * Integer minor units → "-1234.50" (or grouped "1,234.50"), exact, by integer
 * maths. For spreadsheets too: no float, no "-0.00".
 */
export function decimal(minor: number, grouped = false): string {
  const abs = Math.abs(Math.trunc(minor))
  const major = Math.floor(abs / 100)
  const whole = grouped ? major.toLocaleString('en-US') : String(major)
  const frac = String(abs % 100).padStart(2, '0')
  return `${minor < 0 && abs !== 0 ? '-' : ''}${whole}.${frac}`
}

/** Compact duration: 45s, 12m, 6h, 3d. */
export function duration(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

const WEEK_MS = 7 * 24 * 3_600_000

/** "12m ago" for the last week, a date after that. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = now - t
  if (diff < 45_000) return 'just now'
  if (diff > WEEK_MS) return date(iso)
  return `${duration(diff)} ago`
}

export function until(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return t <= now ? 'now' : `in ${duration(t - now)}`
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Full local timestamp, for hover text. */
export function exact(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString()
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/** Basis points → "99.87%". */
export function pct(bps: number | null | undefined, digits = 2): string {
  if (bps == null) return '—'
  return `${(bps / 100).toFixed(digits)}%`
}

export function count(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US')
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

export function host(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }
}
