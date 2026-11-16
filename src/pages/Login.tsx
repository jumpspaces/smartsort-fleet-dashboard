import { useState, type FormEvent } from 'react'
import { signIn } from '../api/client.ts'
import type { Session } from '../api/types.ts'

const DEFAULT_API = (import.meta.env.VITE_FLEET_API as string | undefined) ?? ''
const LAST_API = 'fleet_api_base'

function lastApi(): string {
  try {
    return localStorage.getItem(LAST_API) || DEFAULT_API
  } catch {
    return DEFAULT_API
  }
}

export function Login({ onSignedIn, expired }: { onSignedIn: (s: Session) => void; expired: boolean }) {
  const [apiBase, setApiBase] = useState(lastApi)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!apiBase.trim()) {
      setError('Enter the server address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await signIn(apiBase, email.trim(), password)
      try {
        localStorage.setItem(LAST_API, session.apiBase)
      } catch {
        // Not remembered; the default still applies next time.
      }
      onSignedIn(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="card login-card">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">S</span>
          <span>
            SmartSort Fleet
            <small>JumpSpaces operators</small>
          </span>
        </div>
        <form onSubmit={submit} noValidate>
          <h1>Sign in</h1>
          {expired && !error && <div className="notice info">Your session ended. Sign in to carry on.</div>}
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <details className="server" open={!apiBase}>
            <summary>Server{apiBase ? `: ${apiBase.replace(/^https?:\/\//, '')}` : ''}</summary>
            <div className="field">
              <label htmlFor="api" className="sr-only">
                Server address
              </label>
              <input
                id="api"
                className="input"
                type="url"
                placeholder="https://cloud.example.com"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
              />
            </div>
          </details>
          <button className="btn primary" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
