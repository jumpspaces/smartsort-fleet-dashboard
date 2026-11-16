import type { ReactNode } from 'react'
import type { FleetState, HeartbeatStrip } from '../api/types.ts'
import { Unauthorized } from '../api/client.ts'
import { ago, exact } from '../lib/format.ts'
import { STATE_LABEL } from '../lib/plain.ts'
import { Icon } from './Icon.tsx'

export function PageHeader({
  title,
  sub,
  back,
  actions,
}: {
  title: ReactNode
  sub?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <header>
      {back && (
        <a className="crumb" href={back.href}>
          <Icon name="back" size={14} />
          {back.label}
        </a>
      )}
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </header>
  )
}

export function Card({
  title,
  sub,
  actions,
  flush,
  children,
}: {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function StateBadge({ state, muted }: { state: FleetState; muted?: boolean }) {
  return (
    <span className={`badge ${state}`} title={muted ? 'Alerts are muted for this till' : undefined}>
      {STATE_LABEL[state]}
      {muted ? ' · muted' : ''}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  // An expired session is handled by bouncing to sign-in; no point shouting.
  if (error instanceof Unauthorized) return null
  return (
    <div className="notice" role="alert">
      <span style={{ flex: 1 }}>{error.message}</span>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" style={{ padding: 16, gap: 14 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${90 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  )
}

/**
 * Loading → error → content, in one place, so no page forgets a state.
 * Cached data keeps showing through a failed refresh, with the error above it.
 */
export function Loadable<T>({
  q,
  rows,
  children,
}: {
  q: { data: T | undefined; error: Error | undefined; loading: boolean; reload: () => void }
  rows?: number
  children: (data: T) => ReactNode
}) {
  if (q.data === undefined) {
    if (q.error)
      return (
        <div style={{ padding: 16 }}>
          <ErrorNote error={q.error} onRetry={q.reload} />
        </div>
      )
    return <Skeleton rows={rows} />
  }
  return (
    <>
      {q.error && (
        <div style={{ padding: '12px 16px 0' }}>
          <ErrorNote error={q.error} onRetry={q.reload} />
        </div>
      )}
      {children(q.data)}
    </>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; n?: number }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.n != null && <span className="n">{o.n}</span>}
        </button>
      ))}
    </div>
  )
}

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="search">
      <Icon name="search" size={14} />
      <span className="sr-only">{placeholder}</span>
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function When({ iso }: { iso: string | null | undefined }) {
  return (
    <time className="nowrap" dateTime={iso ?? undefined} title={exact(iso)}>
      {ago(iso)}
    </time>
  )
}

/** "Updated 12s ago", pulsing while a refresh is in flight. */
export function Live({ updatedAt, busy }: { updatedAt: number; busy: boolean }) {
  return (
    <span className={busy ? 'live busy' : 'live'} aria-live="off">
      {updatedAt ? `Updated ${ago(new Date(updatedAt).toISOString())}` : 'Loading'}
    </span>
  )
}

/**
 * Liveness over the last day: one bar per bucket. Full = every expected
 * heartbeat arrived, part = some did, none = the till was silent.
 */
export function Strip({ strip, large }: { strip: HeartbeatStrip | undefined; large?: boolean }) {
  if (!strip) return <div className={large ? 'strip lg' : 'strip'} aria-hidden="true" />
  const missed = strip.buckets.filter((b) => b === 0).length
  return (
    <div
      className={large ? 'strip lg' : 'strip'}
      role="img"
      aria-label={missed ? `Silent for ${missed} of ${strip.buckets.length} periods` : 'Connected throughout'}
    >
      {strip.buckets.map((b, i) => {
        const cls = b === 0 ? 'none' : b >= strip.expectedPerBucket * 0.8 ? 'full' : 'part'
        const from = new Date(strip.fromMs + i * strip.bucketMs)
        return <span key={i} className={cls} title={`${from.toLocaleString()}: ${b} of ${strip.expectedPerBucket} check-ins`} />
      })}
    </div>
  )
}
