import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { signIn, trimBase } from '../api/client.ts'
import type { Session } from '../api/types.ts'
import { host } from '../lib/format.ts'

const DEFAULT_API = (import.meta.env.VITE_FLEET_API as string | undefined) ?? ''
const LAST_API = 'fleet_api_base'
const LAST_EMAIL = 'fleet_last_email'

function stored(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

type Reach = 'idle' | 'checking' | 'ok' | 'down'

/**
 * Whether the server answers at all, checked quietly as the address settles.
 * Informational only — sign-in is never blocked on it, because a proxy or a
 * stricter CORS rule on /health can make a working server look unreachable.
 */
function useReachable(base: string): Reach {
  const [state, setState] = useState<Reach>('idle')
  useEffect(() => {
    const url = trimBase(base)
    if (!/^https?:\/\/.+/.test(url)) {
      setState('idle')
      return
    }
    setState('checking')
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      const timeout = window.setTimeout(() => ctrl.abort(), 5000)
      fetch(`${url}/health`, { signal: ctrl.signal })
        .then((r) => setState(r.ok ? 'ok' : 'down'))
        .catch(() => !ctrl.signal.aborted || setState('down'))
        .finally(() => window.clearTimeout(timeout))
    }, 400)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [base])
  return state
}

const REACH_LABEL: Record<Reach, string> = {
  idle: '',
  checking: 'Checking…',
  ok: 'Reachable',
  down: 'Not answering',
}

export function Login({ onSignedIn, expired }: { onSignedIn: (s: Session) => void; expired: boolean }) {
  const [apiBase, setApiBase] = useState(() => stored(LAST_API, DEFAULT_API))
  const [editingServer, setEditingServer] = useState(() => !stored(LAST_API, DEFAULT_API))
  const [email, setEmail] = useState(() => stored(LAST_EMAIL))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reach = useReachable(apiBase)
  const passwordRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // A returning operator only needs their password.
  useEffect(() => {
    ;(email ? passwordRef : emailRef).current?.focus()
    // Only on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return fail('Enter your email.', emailRef)
    if (!password) return fail('Enter your password.', passwordRef)
    if (!/^https?:\/\/.+/.test(trimBase(apiBase))) {
      setEditingServer(true)
      setError('Enter the server address, starting with https://')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await signIn(apiBase, email.trim(), password)
      store(LAST_API, session.apiBase)
      store(LAST_EMAIL, email.trim())
      onSignedIn(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
      setPassword('')
      passwordRef.current?.focus()
      setBusy(false)
    }
  }

  function fail(message: string, ref: React.RefObject<HTMLInputElement | null>) {
    setError(message)
    ref.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)

  return (
    <main className="login">
      <aside className="login-brand" aria-hidden="true">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>
            SmartSort Fleet
            <small>JumpSpaces</small>
          </span>
        </div>
        <div className="login-pitch">
          <h2>
            Every till, every shop,
            <br />
            one place.
          </h2>
          <p>See what needs attention, send a fix, and know who to call — before the shop has to call you.</p>
        </div>
        <TillGrid />
      </aside>

      <section className="login-panel">
        <div className="brand login-brand-compact">
          <span className="brand-mark">S</span>
          <span>SmartSort Fleet</span>
        </div>

        <form onSubmit={submit} noValidate className="login-form">
          <header>
            <h1>Sign in</h1>
            <p className="sub">Use your JumpSpaces operator account.</p>
          </header>

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
              ref={emailRef}
              className="input"
              type="email"
              autoComplete="username"
              inputMode="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <div className="spread">
              <label htmlFor="password">Password</label>
              <button type="button" className="link-btn" onClick={() => setShowPassword((v) => !v)} aria-controls="password">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              ref={passwordRef}
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKey}
              onKeyUp={onKey}
              aria-describedby={capsLock ? 'caps' : undefined}
            />
            {capsLock && (
              <div id="caps" className="hint" style={{ color: 'var(--warn)' }}>
                Caps Lock is on.
              </div>
            )}
          </div>

          <button className="btn primary login-submit" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-server">
            {editingServer ? (
              <div className="field">
                <label htmlFor="api">Server address</label>
                <input
                  id="api"
                  className="input"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="https://cloud.example.com"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                />
              </div>
            ) : (
              <div className="spread small">
                <span className="row" style={{ gap: 8 }}>
                  <span className={`reach ${reach}`} aria-hidden="true" />
                  <span className="sub">{host(apiBase)}</span>
                  {REACH_LABEL[reach] && <span className="muted">· {REACH_LABEL[reach]}</span>}
                </span>
                <button type="button" className="link-btn" onClick={() => setEditingServer(true)}>
                  Change server
                </button>
              </div>
            )}
            {editingServer && reach !== 'idle' && (
              <div className="row small" style={{ gap: 8, marginTop: 6 }}>
                <span className={`reach ${reach}`} aria-hidden="true" />
                <span className="muted" aria-live="polite">
                  {REACH_LABEL[reach]}
                </span>
              </div>
            )}
          </div>

          <footer className="login-help small muted">
            <p>Forgot your password? Ask an admin to set a new one under Settings → Team.</p>
            <p>Run a shop? Sign in to SmartSort on your till or phone instead — this page is for JumpSpaces staff.</p>
          </footer>
        </form>
      </section>
    </main>
  )
}

/**
 * Decoration: a field of tills in shades of ink, a few marked as needing a
 * look. Shapes, not hues — colour means state everywhere else in the console,
 * and this isn't real data.
 */
function TillGrid() {
  const cells = Array.from({ length: 84 }, (_, i) => {
    const n = (i * 37 + 11) % 97
    return n < 6 ? 'ring' : n < 9 ? 'gap' : n % 3 === 0 ? 'dim' : 'on'
  })
  return (
    <div className="till-grid">
      {cells.map((c, i) => (
        <span key={i} className={c} />
      ))}
    </div>
  )
}
