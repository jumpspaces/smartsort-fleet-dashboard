import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'

export type Tone = 'ok' | 'warn' | 'bad' | 'idle'

/* ------------------------------------------------------------------ button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  busy?: boolean
  /** Shown in place of the label while `busy`; keeps the button's own width. */
  busyLabel?: string
}

export function Button({
  variant = 'default',
  size = 'md',
  busy = false,
  busyLabel,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' && `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      disabled={disabled || busy}
      data-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy ? (busyLabel ?? children) : children}
    </button>
  )
}

/* -------------------------------------------------------------- status marks */

/** Dot + word. Never the dot alone — hue must not be the only carrier. */
export function Status({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="status" data-tone={tone}>
      <span className="dot" data-tone={tone} />
      {label}
    </span>
  )
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="chip" data-tone={tone}>
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------- states */

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="alert">
      <Icon name="alert" />
      <span>{children}</span>
    </div>
  )
}

export function Empty({
  icon = 'inbox',
  title,
  children,
  action,
}: {
  icon?: IconName
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-glyph">
        <Icon name={icon} size={18} />
      </span>
      <div className="empty-title">{title}</div>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  )
}

/** Table-shaped skeleton, so the layout doesn't jump when rows land. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton" style={{ width: 74 }} />
          <div className="skeleton" style={{ width: `${64 - i * 6}%` }} />
          <div className="skeleton" style={{ width: '54%' }} />
          <div className="skeleton" style={{ width: '38%' }} />
          <div className="skeleton" style={{ width: '46%' }} />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- copy */

export function CopyButton({
  value,
  label = 'Copy',
  size = 'sm',
}: {
  value: string
  label?: string
  size?: 'sm' | 'md'
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard is blocked on insecure origins; the value is selectable, so
      // failing quietly beats an error the operator can do nothing about.
      setCopied(false)
    }
  }

  return (
    <Button size={size} onClick={() => void copy()}>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? 'Copied' : label}
    </Button>
  )
}

/* -------------------------------------------------------------- definition */

export function KV({ k, v, title }: { k: string; v: ReactNode; title?: string }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd title={title}>{v}</dd>
    </div>
  )
}

/* -------------------------------------------------------------------- page */

/**
 * The head of a detail page: where you are, one level up, and what you can do
 * to it. The back link is a real control rather than a reliance on the browser's
 * — these pages are linked to directly from alerts, errors and chat messages, so
 * arriving with no history behind you is the normal case, not the edge one.
 */
export function PageHead({
  back,
  title,
  subtitle,
  actions,
}: {
  back: { label: string; onClick: () => void }
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="view-head">
      <div style={{ minWidth: 0 }}>
        <button type="button" className="backlink" onClick={back.onClick}>
          <Icon name="chevron" size={13} className="backlink-chev" />
          {back.label}
        </button>
        <h1 className="view-title">{title}</h1>
        {subtitle && <div className="view-sub">{subtitle}</div>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  )
}

/**
 * One titled block of a page. Detail used to live in a drawer where a rule under
 * a heading was enough separation; at full width the same sections need to be
 * distinct objects, or they read as one unbroken column of prose.
 */
export function Card({
  title,
  actions,
  children,
}: {
  /** Usually a string; a node when the title carries state of its own (a
      rollout's version and where it has got to are one heading, not two). */
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {actions}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

/** A detail page's two columns: the substance, and the reference material. */
export function Columns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="detail">
      <div className="detail-col">{main}</div>
      <div className="detail-col detail-side">{side}</div>
    </div>
  )
}
