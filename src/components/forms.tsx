import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ErrorNote } from './ui.tsx'

export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

/**
 * A button that asks "Sure?" in place before doing something hard to undo.
 * Inline rather than a browser confirm(), which blocks the page.
 */
export function ConfirmButton({
  children,
  confirm = 'Yes, do it',
  onConfirm,
  disabled,
  danger,
  small = true,
}: {
  children: ReactNode
  confirm?: string
  onConfirm: () => void
  disabled?: boolean
  danger?: boolean
  small?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const size = small ? ' sm' : ''
  if (!asking) {
    return (
      <button type="button" className={`btn${size}${danger ? ' danger' : ''}`} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    )
  }
  return (
    <span className="row" style={{ gap: 4 }}>
      <button
        type="button"
        className={`btn${size} ${danger ? 'danger-solid' : 'primary'}`}
        disabled={disabled}
        autoFocus
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {confirm}
      </button>
      <button type="button" className={`btn${size} ghost`} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  )
}

/** A modal on the native <dialog>, so focus trapping and Escape come for free. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className="dialog-body">
          <div className="spread" style={{ marginBottom: 16 }}>
            <h2>{title}</h2>
            <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

/** A one-time code shown big, with a copy button. */
export function CodeReveal({ label, code, note }: { label: string; code: string; note?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-reveal">
      <div className="small sub">{label}</div>
      <div className="spread">
        <code>{code}</code>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {note && <div className="small muted">{note}</div>}
    </div>
  )
}

/** Error from an action, if any. */
export function ActionError({ error }: { error: Error | null }) {
  return error ? <ErrorNote error={error} /> : null
}
