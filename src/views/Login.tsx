import { useState } from 'react'
import { login } from '../api.ts'
import { Mark } from '../components/Mark.tsx'
import { Button, Notice } from '../components/ui.tsx'

export function Login({
  apiBase,
  onLogin,
}: {
  apiBase: string
  onLogin: (base: string, token: string) => void
}) {
  const [base, setBase] = useState(apiBase)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const token = await login(base, password)
      onLogin(base.replace(/\/+$/, ''), token)
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
          <span>Admin password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            autoComplete="current-password"
          />
        </label>

        {error && <Notice>{error}</Notice>}

        <Button type="submit" variant="primary" className="btn-block" busy={busy} busyLabel="Signing in…">
          Sign in
        </Button>

        <p className="login-foot">
          This is the fleet admin secret, not a shop sign-in.
        </p>
      </form>
    </main>
  )
}
