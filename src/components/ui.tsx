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

/* ------------------------------------------------------------------ drawer */

/**
 * Native `<dialog>` in modal mode. That buys the focus trap, Escape, inert
 * background and top-layer stacking from the platform, which is both less code
 * and more correct than the div-with-a-backdrop this replaces.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={typeof title === 'string' ? title : undefined}
      onCancel={(e) => {
        // Let React own the open state rather than the DOM closing behind it.
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // In the top layer the backdrop is part of the dialog's own box, so a
        // click landing on the element itself is a click outside the panel.
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="drawer-inner">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="drawer-title">{title}</h2>
            {subtitle && <div className="row-sub">{subtitle}</div>}
          </div>
          <Button variant="ghost" className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </dialog>
  )
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
