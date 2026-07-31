import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getDevices,
  getErrors,
  Unauthorized,
  type DeviceRow,
  type ErrorRow,
} from './api.ts'
import { Icon } from './components/Icon.tsx'
import { Mark } from './components/Mark.tsx'
import { Button, Notice } from './components/ui.tsx'
import { duration, hostOf } from './lib/format.ts'
import { useTheme, type ThemePref } from './lib/theme.ts'
import { DeviceDrawer } from './views/DeviceDrawer.tsx'
import { Login } from './views/Login.tsx'
import { Shops } from './views/Shops.tsx'
import { Terminals } from './views/Terminals.tsx'

const LS_API = 'fleet_api'
const LS_TOKEN = 'fleet_token'
const LS_VIEW = 'fleet_view'
const REFRESH_MS = 30_000
/** Past this, the live dot stops claiming the numbers are current. */
const STALE_MS = REFRESH_MS * 3

/** Default API base: build-time VITE_FLEET_API, else empty (typed at login). */
const DEFAULT_API = (import.meta.env.VITE_FLEET_API as string | undefined) ?? ''

type View = 'terminals' | 'shops'

export function App() {
  const [apiBase, setApiBase] = useState(() => localStorage.getItem(LS_API) ?? DEFAULT_API)
  const [token, setToken] = useState(() => localStorage.getItem(LS_TOKEN))

  const onLogin = useCallback((base: string, tok: string) => {
    localStorage.setItem(LS_API, base)
    localStorage.setItem(LS_TOKEN, tok)
    setApiBase(base)
    setToken(tok)
  }, [])

  const onLogout = useCallback(() => {
    localStorage.removeItem(LS_TOKEN)
    setToken(null)
  }, [])

  if (!token) return <Login apiBase={apiBase} onLogin={onLogin} />
  return <Dashboard apiBase={apiBase} token={token} onLogout={onLogout} />
}

/* ---------------------------------------------------------------- dashboard */

function Dashboard({
  apiBase,
  token,
  onLogout,
}: {
  apiBase: string
  token: string
  onLogout: () => void
}) {
  const [view, setView] = useState<View>(
    () => (localStorage.getItem(LS_VIEW) as View | null) ?? 'terminals',
  )
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  const [errors, setErrors] = useState<ErrorRow[]>([])
  const [selected, setSelected] = useState<DeviceRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [shopCount, setShopCount] = useState<number | null>(null)

  useEffect(() => {
    localStorage.setItem(LS_VIEW, view)
  }, [view])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [d, e] = await Promise.all([getDevices(apiBase, token), getErrors(apiBase, token)])
      setDevices(d.devices)
      setErrors(e.errors)
      setUpdatedAt(Date.now())
      setLoadError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onLogout()
      setLoadError(err instanceof Error ? err.message : 'Could not reach the fleet server')
    } finally {
      setRefreshing(false)
    }
  }, [apiBase, token, onLogout])

  usePolling(refresh, REFRESH_MS)

  const errorsByDevice = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of errors) m.set(e.deviceId, (m.get(e.deviceId) ?? 0) + e.count)
    return m
  }, [errors])

  return (
    <div className="shell">
      <Sidebar
        apiBase={apiBase}
        view={view}
        onView={setView}
        deviceCount={devices?.length ?? null}
        shopCount={shopCount}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onLogout={onLogout}
      />

      <main className="main">
        <div className="view">
          {loadError && <Notice>{loadError}</Notice>}

          {view === 'shops' ? (
            <Shops
              apiBase={apiBase}
              token={token}
              onUnauthorized={onLogout}
              onCount={setShopCount}
            />
          ) : (
            <Terminals
              devices={devices}
              errorsByDevice={errorsByDevice}
              loading={devices == null}
              onSelect={setSelected}
            />
          )}
        </div>
      </main>

      {selected && (
        <DeviceDrawer
          apiBase={apiBase}
          token={token}
          device={selected}
          errorCount={errorsByDevice.get(selected.deviceId) ?? 0}
          onClose={() => setSelected(null)}
          onUnauthorized={onLogout}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({
  apiBase,
  view,
  onView,
  deviceCount,
  shopCount,
  updatedAt,
  refreshing,
  onRefresh,
  onLogout,
}: {
  apiBase: string
  view: View
  onView: (v: View) => void
  deviceCount: number | null
  shopCount: number | null
  updatedAt: number | null
  refreshing: boolean
  onRefresh: () => void
  onLogout: () => void
}) {
  const [theme, setTheme] = useTheme()
  const since = useTicker(updatedAt != null)
  const age = updatedAt == null ? null : since - updatedAt
  const stale = age == null || age > STALE_MS

  const items: { id: View; label: string; icon: 'terminals' | 'shops'; count: number | null }[] = [
    { id: 'terminals', label: 'Terminals', icon: 'terminals', count: deviceCount },
    { id: 'shops', label: 'Shops', icon: 'shops', count: shopCount },
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
            {it.count != null && <span className="nav-count">{it.count}</span>}
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
          <Button variant="ghost" size="sm" onClick={onLogout}>
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
