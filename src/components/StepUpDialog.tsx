import { useState, type FormEvent, type ReactNode } from 'react'
import { useAction } from '../lib/query.ts'
import { Dialog, Field } from './forms.tsx'
import { ErrorNote } from './ui.tsx'

/**
 * Ask for the operator's password before a drastic command. The server checks
 * it on the spot — a session token alone cannot lock a till.
 */
export function StepUpDialog({
  open,
  title,
  confirm,
  danger,
  hint = 'Asked again for the commands that take a till out of service or discard what it holds.',
  onClose,
  onConfirm,
  children,
}: {
  open: boolean
  title: string
  confirm: string
  danger?: boolean
  /** Under the password box: why it's being asked for. */
  hint?: string
  onClose: () => void
  onConfirm: (password: string) => Promise<unknown>
  children: ReactNode
}) {
  const [password, setPassword] = useState('')
  const act = useAction(async (pw: string) => {
    await onConfirm(pw)
    setPassword('')
    onClose()
  })
  const close = () => {
    setPassword('')
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} title={title}>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (password) void act.run(password)
        }}
      >
        {children}
        <Field label="Your password" id="step-up-password" hint={hint}>
          <input
            id="step-up-password"
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {act.error && <ErrorNote error={act.error} />}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'danger-solid' : 'primary'}`} disabled={!password || act.pending}>
            {act.pending ? 'Sending…' : confirm}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
