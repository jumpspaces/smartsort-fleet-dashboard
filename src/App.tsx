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
import { pageName } from './lib/plain.ts'
import { PARENT, useRoute, type View } from './lib/route.ts'
import { useDensity } from './lib/density.ts'
import { useTheme, type ThemePref } from './lib/theme.ts'
import { Palette } from './components/Palette.tsx'
import { Shortcuts } from './components/Shortcuts.tsx'
import { Alerts } from './views/Alerts.tsx'
import { Audit } from './views/Audit.tsx'
import { Backups } from './views/Backups.tsx'
import { Quality } from './views/Quality.tsx'
import { Commands } from './views/Commands.tsx'
import { Rollouts } from './views/Rollouts.tsx'
import { Trends } from './views/Trends.tsx'
import { Device } from './views/Device.tsx'
import { ErrorGroup } from './views/ErrorGroup.tsx'
import { Errors } from './views/Errors.tsx'
import { Login } from './views/Login.tsx'
import { Operators } from './views/Operators.tsx'
import { Shop } from './views/Shop.tsx'
import { Shops } from './views/Shops.tsx'
import { Terminals } from './views/Terminals.tsx'
import { Triage } from './views/Triage.tsx'

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
  const { route, navigate, replace, back } = useRoute()
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

  // ⌘K / Ctrl-K anywhere. Registered on the shell rather than inside the
  // palette so it works from any view, including one with a focused input.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      // `?` only when nobody is typing — otherwise it steals the character from
      // the search box, which is where people are most likely to press it.
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setShortcutsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="shell">
      <Sidebar
        apiBase={api.apiBase}
        operator={session.operator}
        // A detail page belongs to its list, so the rail keeps that section lit
        // rather than going blank the moment you open something.
        view={PARENT[view] ?? view}
        onView={navigate}
        overview={overview}
        onSignOut={onSignOut}
      />

      <main className="main">
        <StatusBar
          overview={overview}
          updatedAt={updatedAt}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          onNavigate={navigate}
          onSearch={() => setPaletteOpen(true)}
        />
        <div className="view" data-view={view}>
          {view === 'device' ? (
            <Device
              // Remount per terminal: a page carrying another one's loaded
              // history and errors while the new ones arrive is worse than
              // a moment of skeleton.
              key={route.params.id}
              api={api}
              deviceId={route.params.id ?? ''}
              reloadKey={reloadKey}
              onNavigate={navigate}
              onBack={() => back('terminals')}
            />
          ) : view === 'shop' ? (
            <Shop
              key={route.params.id}
              api={api}
              shopId={route.params.id ?? ''}
              reloadKey={reloadKey}
              onNavigate={navigate}
              onBack={() => back('shops')}
              onUnauthorized={onSignOut}
            />
          ) : view === 'error' ? (
            <ErrorGroup
              key={route.params.id}
              api={api}
              fingerprint={route.params.id ?? ''}
              reloadKey={reloadKey}
              onNavigate={navigate}
              onBack={() => back('errors')}
            />
          ) : view === 'shops' ? (
            <Shops api={api} reloadKey={reloadKey} onNavigate={navigate} />
          ) : view === 'errors' ? (
            <Errors api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'alerts' ? (
            <Alerts api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'commands' ? (
            <Commands api={api} route={route} reloadKey={reloadKey} onNavigate={navigate} onReplace={replace} />
          ) : view === 'rollouts' ? (
            <Rollouts api={api} reloadKey={reloadKey} onNavigate={navigate} />
          ) : view === 'trends' ? (
            <Trends api={api} reloadKey={reloadKey} onNavigate={navigate} />
          ) : view === 'backups' ? (
            <Backups api={api} reloadKey={reloadKey} onNavigate={navigate} />
          ) : view === 'quality' ? (
            <Quality api={api} reloadKey={reloadKey} onNavigate={navigate} />
          ) : view === 'operators' ? (
            <Operators api={api} onUnauthorized={onSignOut} />
          ) : view === 'audit' ? (
            <Audit api={api} onUnauthorized={onSignOut} />
          ) : view === 'terminals' ? (
            <Terminals
              api={api}
              route={route}
              overview={overview}
              reloadKey={reloadKey}
              onNavigate={navigate}
              onReplace={replace}
            />
          ) : (
            <Triage
              api={api}
              overview={overview}
              reloadKey={reloadKey}
              onNavigate={navigate}
              onUnauthorized={onSignOut}
            />
          )}
        </div>
      </main>

      {paletteOpen && (
        <Palette api={api} onNavigate={navigate} onClose={() => setPaletteOpen(false)} />
      )}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ sidebar */

interface NavItem {
  id: View
  label: string
  icon: IconName
  count?: number | null
  /** Counts that mean "unfinished work" get weight; totals stay quiet. */
  urgent?: boolean
}

/**
 * Five places cover a normal day: is anything wrong, which shop, what alerts
 * fired, what version the tills are on, who can sign in. Everything else is
 * real but occasional, so it sits under "More" — still one click away, not
 * eleven equal choices for someone who just wants to know if the shops are up.
 */
function navGroups(overview: Overview | null, role: Session['operator']['role']): {
  label: string | null
  items: NavItem[]
}[] {
  const alerts = overview?.openAlerts ?? null
  const errors = overview?.openErrorGroups ?? null
  const item = (id: View, icon: IconName, extra: Partial<NavItem> = {}): NavItem => ({
    id,
    label: pageName(id),
    icon,
    ...extra,
  })
  return [
    {
      label: null,
      items: [
        item('triage', 'inbox'),
        item('shops', 'shops'),
        item('alerts', 'bell', { count: alerts, urgent: (alerts ?? 0) > 0 }),
        item('rollouts', 'rocket'),
        ...(role === 'admin' ? [item('operators', 'users')] : []),
      ],
    },
    {
      label: 'More',
      items: [
        item('terminals', 'terminals', { count: overview?.counts.all ?? null }),
        item('errors', 'bug', { count: errors }),
        item('backups', 'shield'),
        item('quality', 'note'),
        item('trends', 'trend'),
        item('commands', 'prompt'),
        item('audit', 'list'),
      ],
    },
  ]
}

const ROLE_LABEL: Record<Session['operator']['role'], string> = {
  admin: 'Admin',
  operator: 'Support',
  viewer: 'Can view only',
}

const LS_MORE = 'fleet_nav_more'

/** Whether "More" is unfolded — a per-person convenience, so browser storage. */
function useMoreOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LS_MORE) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOpen(next)
    try {
      if (next) localStorage.setItem(LS_MORE, '1')
      else localStorage.removeItem(LS_MORE)
    } catch {
      /* private window: it just will not be remembered */
    }
  }, [])
  return [open, set]
}

function Sidebar({
  apiBase,
  operator,
  view,
  onView,
  overview,
  onSignOut,
}: {
  apiBase: string
  operator: Session['operator']
  view: View
  onView: (v: View) => void
  overview: Overview | null
  onSignOut: () => void
}) {
  const [theme, setTheme] = useTheme()
  const [density, setDensity] = useDensity()
  const [moreOpen, setMoreOpen] = useMoreOpen()
  const groups = navGroups(overview, operator.role)

  return (
    <header className="sidebar">
      <Mark />

      <nav className="nav" aria-label="Sections">
        {groups.map((group, gi) => {
          const folded = group.label === 'More' && !moreOpen && !group.items.some((it) => it.id === view)
          return (
            <div className="nav-group" key={group.label ?? gi}>
              {group.label === 'More' ? (
                <button
                  type="button"
                  className="nav-more"
                  aria-expanded={!folded}
                  onClick={() => setMoreOpen(folded)}
                >
                  More
                  <Icon name="chevron" size={12} />
                </button>
              ) : (
                group.label && <span className="nav-label">{group.label}</span>
              )}
              {!folded &&
                group.items.map((it) => (
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
            </div>
          )
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="conn-row">
          <div className="conn">
            <span className="conn-who" title={`${operator.name} · ${operator.role}`}>
              {operator.name}
            </span>
            <span className="conn-host" title={`${operator.role} · ${hostOf(apiBase)}`}>
              {ROLE_LABEL[operator.role]}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>

        <div className="sidebar-actions">
          <ThemeToggle theme={theme} onTheme={setTheme} />
          <Button
            variant="ghost"
            className="btn-icon"
            aria-label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
            title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
          >
            <Icon name="list" />
          </Button>
        </div>
      </div>
    </header>
  )
}

/* --------------------------------------------------------------- status bar */

/**
 * The fleet's state on every page, not just the first one. Somebody deep in a
 * rollout or a shop's inventory still sees a till drop offline, because the
 * counts that say so sit above whatever they are reading, and each one is a
 * link to exactly those terminals.
 */
function StatusBar({
  overview,
  updatedAt,
  refreshing,
  onRefresh,
  onNavigate,
  onSearch,
}: {
  overview: Overview | null
  updatedAt: number | null
  refreshing: boolean
  onRefresh: () => void
  onNavigate: Navigate
  onSearch: () => void
}) {
  const since = useTicker(updatedAt != null)
  const age = updatedAt == null ? null : since - updatedAt
  const stale = age == null || age > STALE_MS
  const c = overview?.counts

  return (
    <div className="statusbar">
      <div className="pulse" aria-label="Tills right now">
        {c ? (
          <>
            <button type="button" className="pulse-item" onClick={() => onNavigate('terminals', { state: 'healthy' })}>
              <span className="dot" data-tone="ok" aria-hidden="true" />
              <b className="num">{c.healthy}</b> fine
            </button>
            {c.attention > 0 && (
              <button
                type="button"
                className="pulse-item"
                data-hot="true"
                onClick={() => onNavigate('terminals', { state: 'attention' })}
              >
                <span className="dot" data-tone="warn" aria-hidden="true" />
                <b className="num">{c.attention}</b> need{c.attention === 1 ? 's' : ''} a look
              </button>
            )}
            {c.offline > 0 && (
              <button
                type="button"
                className="pulse-item"
                data-hot="true"
                data-tone="bad"
                onClick={() => onNavigate('terminals', { state: 'offline' })}
              >
                <span className="dot" data-tone="bad" aria-hidden="true" />
                <b className="num">{c.offline}</b> not connected
              </button>
            )}
          </>
        ) : (
          <span className="skeleton" style={{ width: 240, height: 14 }} aria-hidden="true" />
        )}
      </div>

      <button type="button" className="omnibox" onClick={onSearch}>
        <Icon name="search" size={14} />
        <span>Search shops and tills</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="statusbar-end">
        <span className="conn-live" title={updatedAt ? new Date(updatedAt).toLocaleTimeString() : undefined}>
          <span className="dot dot-live" data-stale={stale || undefined} aria-hidden="true" />
          {age == null ? 'Connecting…' : stale ? `Updated ${duration(age)} ago` : 'Up to date'}
        </span>
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
      </div>
    </div>
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
