import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createApi,
  type Api,
  type Overview,
  type Session,
} from './api.ts'
import { Icon, type IconName } from './components/Icon.tsx'
import { Mark } from './components/Mark.tsx'
import { Button } from './components/ui.tsx'
import { duration, hostOf } from './lib/format.ts'
import { useRoute, type View } from './lib/route.ts'
import { useTheme, type ThemePref } from './lib/theme.ts'
import { Alerts } from './views/Alerts.tsx'
import { Audit } from './views/Audit.tsx'
import { Commands } from './views/Commands.tsx'
import { Errors } from './views/Errors.tsx'
import { Login } from './views/Login.tsx'
import { Operators } from './views/Operators.tsx'
import { Shops } from './views/Shops.tsx'
import { Terminals } from './views/Terminals.tsx'

const LS_SESSION = 'fleet_session'
const LS_API = 'fleet_api'
const REFRESH_MS = 30_000
/** Past this, the live dot stops claiming the numbers are current. */
const STALE_MS = REFRESH_MS * 3

/** Default API base: build-time VITE_FLEET_API, else empty (typed at login). */
const DEFAULT_API = (import.meta.env.VITE_FLEET_API as string | undefined) ?? ''

export type { View } from './lib/route.ts'

/**
 * Send someone to another view with a filter applied. Pushes a history entry,
 * so the link is shareable and Back returns where they came from.
 */
export type Navigate = (
  view: View,
  params?: Record<string, string | undefined>,
) => void

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(LS_SESSION)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    return parsed.accessToken && parsed.apiBase ? parsed : null
  } catch {
    return null
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(readSession)

  const onSignedIn = useCallback((s: Session) => {
    localStorage.setItem(LS_SESSION, JSON.stringify(s))
    localStorage.setItem(LS_API, s.apiBase)
    setSession(s)
  }, [])

  const onSignOut = useCallback(() => {
    localStorage.removeItem(LS_SESSION)
    setSession(null)
  }, [])

  if (!session) {
    return (
      <Login
        apiBase={localStorage.getItem(LS_API) ?? DEFAULT_API}
        onSignedIn={onSignedIn}
      />
    )
  }
  return <Dashboard session={session} onRenewed={onSignedIn} onSignOut={onSignOut} />
}

/* ---------------------------------------------------------------- dashboard */

function Dashboard({
  session,
  onRenewed,
  onSignOut,
}: {
  session: Session
  onRenewed: (s: Session) => void
  onSignOut: () => void
}) {
  const { route, navigate, replace } = useRoute()
  const view = route.view
  const [overview, setOverview] = useState<Overview | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // One API object for the life of the session. Rebuilt only if the operator
  // signs in again, so views can hold it without re-fetching on every render.
  const api = useMemo<Api>(
    () =>
      createApi(session, {
        onRenewed,
        onExpired: onSignOut,
      }),
    // The token inside `session` changes on refresh, but createApi keeps its own
    // copy and updates it in place — rebuilding here would discard that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.operator.id, session.apiBase],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setOverview(await api.overview())
      setUpdatedAt(Date.now())
    } catch {
      // The views surface their own load errors against the data they own; a
      // failed KPI strip should not blank the page under it.
    } finally {
      setRefreshing(false)
    }
    setReloadKey((k) => k + 1)
  }, [api])

  usePolling(refresh, REFRESH_MS)

  return (
    <div className="shell">
      <Sidebar
        apiBase={api.apiBase}
        operator={session.operator}
        view={view}
        onView={navigate}
        overview={overview}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onSignOut={onSignOut}
      />

      <main className="main">
        <div className="view">
          {view === 'shops' ? (
            <Shops api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'errors' ? (
            <Errors api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'alerts' ? (
            <Alerts api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'commands' ? (
            <Commands api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'operators' ? (
            <Operators api={api} onUnauthorized={onSignOut} />
          ) : view === 'audit' ? (
            <Audit api={api} onUnauthorized={onSignOut} />
          ) : (
            <Terminals
              api={api}
              route={route}
              overview={overview}
              reloadKey={reloadKey}
              onNavigate={navigate}
              onReplace={replace}
            />
          )}
        </div>
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({
  apiBase,
  operator,
  view,
  onView,
  overview,
  updatedAt,
  refreshing,
  onRefresh,
  onSignOut,
}: {
  apiBase: string
  operator: Session['operator']
  view: View
  onView: (v: View) => void
  overview: Overview | null
  updatedAt: number | null
  refreshing: boolean
  onRefresh: () => void
  onSignOut: () => void
}) {
  const [theme, setTheme] = useTheme()
  const since = useTicker(updatedAt != null)
  const age = updatedAt == null ? null : since - updatedAt
  const stale = age == null || age > STALE_MS

  const items: {
    id: View
    label: string
    icon: IconName
    count: number | null
    /** Counts that mean "unfinished work" get weight; totals stay quiet. */
    urgent?: boolean
  }[] = [
    { id: 'terminals', label: 'Terminals', icon: 'terminals', count: overview?.counts.all ?? null },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: 'bell',
      count: overview?.openAlerts ?? null,
      urgent: (overview?.openAlerts ?? 0) > 0,
    },
    {
      id: 'errors',
      label: 'Errors',
      icon: 'bug',
      count: overview?.openErrorGroups ?? null,
      urgent: (overview?.openErrorGroups ?? 0) > 0,
    },
    { id: 'shops', label: 'Shops', icon: 'shops', count: null },
    { id: 'commands', label: 'Commands', icon: 'prompt', count: null },
    { id: 'audit', label: 'Audit', icon: 'list', count: null },
    ...(operator.role === 'admin'
      ? [{ id: 'operators' as const, label: 'Settings', icon: 'users' as const, count: null }]
      : []),
  ]

  return (
    <header className="sidebar">
      <Mark />

      <nav className="nav" aria-label="Sections">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className="nav-item"
            aria-current={view === it.id ? 'page' : undefined}
            onClick={() => onView(it.id)}
          >
            <Icon name={it.icon} />
            {it.label}
            {it.count != null && it.count > 0 && (
              <span className="nav-count" data-urgent={it.urgent || undefined}>
                {it.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="conn">
          <span className="conn-host" title={apiBase}>
            {hostOf(apiBase)}
          </span>
          <span className="conn-live">
            <span className="dot dot-live" data-stale={stale || undefined} aria-hidden="true" />
            {age == null
              ? 'Connecting…'
              : stale
                ? `Last update ${duration(age)} ago`
                : `Live · ${duration(age)} ago`}
          </span>
          <span className="conn-who" title={`${operator.name} · ${operator.role}`}>
            {operator.email}
          </span>
        </div>

        <div className="sidebar-actions">
          <ThemeToggle theme={theme} onTheme={setTheme} />
          <Button
            variant="ghost"
            className="btn-icon"
            onClick={onRefresh}
            busy={refreshing}
            aria-label="Refresh now"
            title="Refresh now"
          >
            {!refreshing && <Icon name="refresh" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}

function ThemeToggle({
  theme,
  onTheme,
}: {
  theme: ThemePref
  onTheme: (t: ThemePref) => void
}) {
  const opts: { id: ThemePref; icon: 'sun' | 'moon' | 'auto'; label: string }[] = [
    { id: 'light', icon: 'sun', label: 'Light' },
    { id: 'dark', icon: 'moon', label: 'Dark' },
    { id: 'system', icon: 'auto', label: 'Match system' },
  ]
  return (
    <div className="segmented" role="group" aria-label="Colour theme">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-current={theme === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => onTheme(o.id)}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------- timing */

/**
 * Poll on an interval, but only while the tab is visible — a dashboard left
 * open on a second monitor overnight should not keep hitting the droplet, and
 * the first thing anyone wants on returning is a fresh read anyway.
 */
function usePolling(run: () => void | Promise<void>, ms: number) {
  const latest = useRef(run)
  latest.current = run

  useEffect(() => {
    let timer: number | undefined

    const tick = () => {
      if (document.visibilityState === 'visible') void latest.current()
    }
    const start = () => {
      window.clearInterval(timer)
      timer = window.setInterval(tick, ms)
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void latest.current()
      start()
    }

    void latest.current()
    start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms])
}

/** Re-renders once a second so "12s ago" stays honest between polls. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}
