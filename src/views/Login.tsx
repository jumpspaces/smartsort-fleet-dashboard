import { useState } from 'react'
import { signIn, type Session } from '../api.ts'
import { Mark } from '../components/Mark.tsx'
import { Button, Notice } from '../components/ui.tsx'

/**
 * Operator sign-in.
 *
 * This used to take a single shared "admin password" that WAS the bearer token,
 * stored forever. It now takes a named operator's own credentials and receives a
 * session that expires, so access can be granted, revoked and attributed one
 * person at a time — see the audit trail behind /fleet/audit.
 */
export function Login({
  apiBase,
  onSignedIn,
}: {
  apiBase: string
  onSignedIn: (session: Session) => void
}) {
  const [base, setBase] = useState(apiBase)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await signIn(base, email, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <Mark />
        <p className="login-lede">
          JumpSpaces-internal monitor for deployed SmartSort terminals.
        </p>

        <label className="field">
          <span>Server URL</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://cloud.example…"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && <Notice>{error}</Notice>}

        <Button
          type="submit"
          variant="primary"
          className="btn-block"
          busy={busy}
          busyLabel="Signing in…"
        >
          Sign in
        </Button>

        <p className="login-foot">
          Your own JumpSpaces account, not a shop sign-in. Accounts are created on
          the server with <code>npm run fleet:operator -- add</code>.
        </p>
      </form>
    </main>
  )
}
