import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Palette, ShortcutHelp } from './components/Palette.tsx'
import { isTyping } from './lib/match.ts'
import { clearRowNav, handleRowKey } from './lib/rownav.ts'
import { StatusBar } from './components/StatusBar.tsx'
import { notifySupported, useAlertNotifications, useNotifyPref } from './lib/notify.ts'
import { useRecordVisit } from './lib/visit.ts'
import { useAlerts } from './data.ts'
import { useDensity } from './lib/prefs.ts'
import type { Session } from './api/types.ts'
import { Icon, type IconName } from './components/Icon.tsx'
import { useOverview } from './data.ts'
import { host } from './lib/format.ts'
import { clearCache } from './lib/query.ts'
import { href, useLocation, type Route } from './lib/router.ts'
import { loadSession, saveSession, SessionProvider, useSession } from './lib/session.tsx'
import { useTheme, type Theme } from './lib/theme.ts'
import { Alerts } from './pages/Alerts.tsx'
import { Home } from './pages/Home.tsx'
import { Login } from './pages/Login.tsx'
import { TwoFactorGate } from './components/TwoFactor.tsx'
import { Shop } from './pages/Shop.tsx'
import { Shops } from './pages/Shops.tsx'
import { Till } from './pages/Till.tsx'
import { Tills } from './pages/Tills.tsx'
import { Problem, Problems } from './pages/Problems.tsx'
import { Activity, Backups, Fixes, History, Records } from './pages/Reports.tsx'
import { Settings } from './pages/Settings.tsx'
import { Accounts } from './pages/Accounts.tsx'
import { Calendar } from './pages/Calendar.tsx'
import { Update, Updates } from './pages/Updates.tsx'

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [expired, setExpired] = useState(false)

  const end = useCallback((why: 'expired' | 'signout') => {
    saveSession(null)
    clearCache()
    setExpired(why === 'expired')
    setSession(null)
  }, [])
  const onExpired = useCallback(() => end('expired'), [end])
  const onSignOut = useCallback(() => end('signout'), [end])

  if (!session) {
    return (
      <Login
        expired={expired}
        onSignedIn={(s) => {
          saveSession(s)
          setExpired(false)
          setSession(s)
        }}
      />
    )
  }
  return (
    <SessionProvider session={session} onExpired={onExpired} onSignOut={onSignOut}>
      <TwoFactorGate>
        <Shell />
      </TwoFactorGate>
    </SessionProvider>
  )
}

type Nav = { page: Route['page']; path: string; label: string; icon: IconName; also?: Route['page'] }

/** Daily work first, then looking back, then setup. */
const NAV: { group: string | null; items: Nav[] }[] = [
  {
    group: null,
    items: [
      { page: 'home', path: '/', label: 'Home', icon: 'home' },
      { page: 'alerts', path: '/alerts', label: 'Alerts', icon: 'bell' },
      { page: 'tills', path: '/tills', label: 'Tills', icon: 'till', also: 'till' },
      { page: 'shops', path: '/shops', label: 'Shops', icon: 'shop', also: 'shop' },
      { page: 'accounts', path: '/accounts', label: 'Accounts', icon: 'people' },
      { page: 'calendar', path: '/calendar', label: 'Calendar', icon: 'calendar' },
    ],
  },
  {
    group: 'Fixing',
    items: [
      { page: 'problems', path: '/problems', label: 'App problems', icon: 'bug', also: 'problem' },
      { page: 'fixes', path: '/fixes', label: 'Remote fixes', icon: 'wrench' },
      { page: 'updates', path: '/updates', label: 'Updates', icon: 'upload', also: 'update' },
    ],
  },
  {
    group: 'Looking back',
    items: [
      { page: 'history', path: '/history', label: 'History', icon: 'chart' },
      { page: 'backups', path: '/backups', label: 'Backups', icon: 'disk' },
      { page: 'records', path: '/records', label: 'Records check', icon: 'check' },
      { page: 'activity', path: '/activity', label: 'Activity log', icon: 'list' },
    ],
  },
  { group: null, items: [{ page: 'settings', path: '/settings', label: 'Settings', icon: 'gear' }] },
]

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON: Record<Theme, IconName> = { system: 'auto', light: 'sun', dark: 'moon' }

function Shell() {
  const { route, params } = useLocation()
  const { session, signOut } = useSession()
  const [theme, setTheme] = useTheme()
  const [density, setDensity] = useDensity()
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      if (e.key === '/') {
        const box = document.querySelector<HTMLInputElement>('main input[type="search"]')
        if (box) {
          e.preventDefault()
          box.focus()
        }
      } else if (e.key === '?') {
        e.preventDefault()
        setHelp(true)
      } else if (['j', 'k', 'Enter', 'a', 'Escape'].includes(e.key) && handleRowKey(e.key)) {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const overview = useOverview()
  const openAlerts = overview.data?.openAlerts ?? 0
  const openProblems = overview.data?.openErrorGroups ?? 0
  const alerts = useAlerts('open')
  const [notifyOn, toggleNotify] = useNotifyPref()
  useAlertNotifications(alerts.data, notifyOn)
  useRecordVisit(session.operator.id)
  const pageKey = route.page + ('id' in route ? route.id : '')
  useEffect(() => clearRowNav(), [pageKey])

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>
            SmartSort Fleet
            <small>JumpSpaces</small>
          </span>
        </div>
        {NAV.map((g, gi) => (
          <div key={gi} style={{ display: 'contents' }}>
            {g.group && <div className="nav-group">{g.group}</div>}
            {!g.group && gi > 0 && <div className="nav-group" aria-hidden="true" />}
            {g.items.map((n) => (
              <a
                key={n.page}
                className="nav-link"
                href={href(n.path)}
                aria-current={route.page === n.page || route.page === n.also ? 'page' : undefined}
                aria-label={n.label}
                title={n.label}
              >
                <Icon name={n.icon} />
                <span className="nav-label-text">{n.label}</span>
                {n.page === 'alerts' && openAlerts > 0 && <span className="nav-count">{openAlerts}</span>}
                {n.page === 'problems' && openProblems > 0 && <span className="nav-count quiet">{openProblems}</span>}
              </a>
            ))}
          </div>
        ))}
        <div className="nav-foot">
          <div className="who" title={session.operator.email}>
            {session.operator.name}
            <div className="muted small">{session.operator.role}</div>
          </div>
          <div className="host muted small">{host(session.apiBase)}</div>
          <div className="nav-foot-row">
            <button
              className="btn icon ghost"
              onClick={() => setTheme(NEXT_THEME[theme])}
              title={`Theme: ${theme}`}
              aria-label={`Theme: ${theme}. Change theme`}
            >
              <Icon name={THEME_ICON[theme]} />
            </button>
            <button
              className="btn icon ghost"
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
              title={density === 'compact' ? 'Roomier rows' : 'Compact rows'}
              aria-label={density === 'compact' ? 'Switch to roomier rows' : 'Switch to compact rows'}
              aria-pressed={density === 'compact'}
            >
              <Icon name="rows" />
            </button>
            {notifySupported() && (
              <button
                className="btn icon ghost"
                onClick={() => void toggleNotify()}
                aria-pressed={notifyOn}
                title={notifyOn ? 'Desktop alerts on — urgent alerts pop up while this tab is in the background' : 'Turn on desktop alerts for urgent alerts'}
                aria-label={notifyOn ? 'Turn off desktop alerts' : 'Turn on desktop alerts'}
                style={notifyOn ? { color: 'var(--ink)', background: 'var(--surface-2)' } : undefined}
              >
                <Icon name="bell" />
              </button>
            )}
            <button className="btn icon ghost" onClick={() => setPalette(true)} title="Go to… (⌘K)" aria-label="Go to a page, shop or till">
              <Icon name="search" />
            </button>
            <button className="btn icon ghost" onClick={signOut} title="Sign out" aria-label="Sign out">
              <Icon name="out" />
            </button>
          </div>
        </div>
      </nav>
      <Palette open={palette} onClose={() => setPalette(false)} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
      <main className="main">
        <ErrorBoundary key={route.page + ('id' in route ? route.id : '')}>
          <Page route={route} params={params} />
        </ErrorBoundary>
        <StatusBar />
      </main>
    </div>
  )
}

function Page({ route, params }: { route: Route; params: URLSearchParams }) {
  switch (route.page) {
    case 'home':
      return <Home />
    case 'tills':
      return <Tills params={params} />
    case 'till':
      return <Till id={route.id} />
    case 'shops':
      return <Shops params={params} />
    case 'shop':
      return <Shop id={route.id} params={params} />
    case 'alerts':
      return <Alerts params={params} />
    case 'problems':
      return <Problems params={params} />
    case 'problem':
      return <Problem fingerprint={route.id} />
    case 'updates':
      return <Updates />
    case 'update':
      return <Update id={route.id} />
    case 'fixes':
      return <Fixes params={params} />
    case 'history':
      return <History params={params} />
    case 'backups':
      return <Backups />
    case 'records':
      return <Records />
    case 'activity':
      return <Activity params={params} />
    case 'settings':
      return <Settings params={params} />
    case 'accounts':
      return <Accounts params={params} />
    case 'calendar':
      return <Calendar />
    default:
      return (
        <div className="card empty">
          <strong>Page not found</strong>
          <a href={href('/')}>Go home</a>
        </div>
      )
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card empty">
        <strong>This page hit a problem</strong>
        <p className="mono small" style={{ margin: '8px 0 12px' }}>
          {this.state.error.message}
        </p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
