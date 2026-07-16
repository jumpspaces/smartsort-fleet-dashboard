import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getDevices,
  getErrors,
  login,
  Unauthorized,
  type DeviceRow,
  type ErrorRow,
} from './api.ts'

const LS_API = 'fleet_api'
const LS_TOKEN = 'fleet_token'
const REFRESH_MS = 30_000

/** Default API base: build-time VITE_FLEET_API, else empty (typed at login). */
const DEFAULT_API = (import.meta.env.VITE_FLEET_API as string | undefined) ?? ''

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

/* -------------------------------------------------------------------- login */

function Login({
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
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <span className="dot" /> SmartSort Fleet
        </div>
        <p className="muted">JumpSpaces internal — deployment monitoring</p>
        <label>
          Server URL
          <input
            type="url"
            placeholder="https://cloud.smartsort…"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            required
          />
        </label>
        <label>
          Admin password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
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
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [errors, setErrors] = useState<ErrorRow[]>([])
  const [selected, setSelected] = useState<DeviceRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([
        getDevices(apiBase, token),
        getErrors(apiBase, token),
      ])
      setDevices(d.devices)
      setErrors(e.errors)
      setUpdatedAt(new Date())
      setLoadError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onLogout()
      setLoadError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [apiBase, token, onLogout])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  const stats = useMemo(() => {
    const online = devices.filter((d) => d.online).length
    const erroring = new Set(errors.map((e) => e.deviceId)).size
    const backedUp = devices.filter((d) => (d.syncPending ?? 0) > 0 || (d.syncFailed ?? 0) > 0).length
    return { total: devices.length, online, offline: devices.length - online, erroring, backedUp }
  }, [devices, errors])

  const errorsByDevice = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of errors) m.set(e.deviceId, (m.get(e.deviceId) ?? 0) + e.count)
    return m
  }, [errors])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> SmartSort Fleet
        </div>
        <div className="topbar-right">
          <span className="muted">{apiBase}</span>
          {updatedAt && <span className="muted">· updated {timeAgo(updatedAt.toISOString())}</span>}
          <button className="ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      {loadError && <div className="error-banner page-error">{loadError}</div>}

      <section className="tiles">
        <Tile label="Terminals" value={stats.total} />
        <Tile label="Online" value={stats.online} tone="good" />
        <Tile label="Offline" value={stats.offline} tone={stats.offline ? 'bad' : 'muted'} />
        <Tile label="Sync backlog" value={stats.backedUp} tone={stats.backedUp ? 'warn' : 'muted'} />
        <Tile label="With errors" value={stats.erroring} tone={stats.erroring ? 'warn' : 'muted'} />
      </section>

      <section className="card">
        <div className="card-head">Terminals</div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Shop</th>
                <th>Version</th>
                <th>Platform</th>
                <th>Sync</th>
                <th>Sales today</th>
                <th>Errors</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted center">
                    No terminals have reported yet.
                  </td>
                </tr>
              )}
              {devices.map((d) => {
                const errCount = errorsByDevice.get(d.deviceId) ?? 0
                return (
                  <tr key={d.deviceId} onClick={() => setSelected(d)} className="row-click">
                    <td>
                      <span className={`badge ${d.online ? 'badge-good' : 'badge-bad'}`}>
                        {d.online ? 'online' : 'offline'}
                      </span>
                    </td>
                    <td>
                      <div className="shop-name">{d.shopName ?? '—'}</div>
                      <div className="muted mono tiny">{d.deviceId.slice(0, 8)}</div>
                    </td>
                    <td className="mono">{d.appVersion ?? '—'}</td>
                    <td className="muted">{d.platform ?? '—'}</td>
                    <td>{syncCell(d)}</td>
                    <td>{salesCell(d)}</td>
                    <td>
                      {errCount > 0 ? (
                        <span className="badge badge-warn">{errCount}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="muted">{timeAgo(d.lastReportAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <DeviceDrawer
          apiBase={apiBase}
          token={token}
          device={selected}
          onClose={() => setSelected(null)}
          onUnauthorized={onLogout}
        />
      )}
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`tile tile-${tone ?? 'default'}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  )
}

/* ------------------------------------------------------------- device drawer */

function DeviceDrawer({
  apiBase,
  token,
  device,
  onClose,
  onUnauthorized,
}: {
  apiBase: string
  token: string
  device: DeviceRow
  onClose: () => void
  onUnauthorized: () => void
}) {
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    getErrors(apiBase, token, device.deviceId)
      .then((r) => setErrors(r.errors))
      .catch((e) => {
        if (e instanceof Unauthorized) return onUnauthorized()
        setErr(e instanceof Error ? e.message : 'Failed to load errors')
      })
  }, [apiBase, token, device.deviceId, onUnauthorized])

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="shop-name lg">{device.shopName ?? 'Unknown shop'}</div>
            <div className="muted mono tiny">{device.deviceId}</div>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="kv-grid">
          <KV k="Status" v={device.online ? 'Online' : 'Offline'} />
          <KV k="Version" v={device.appVersion ?? '—'} />
          <KV k="Platform" v={`${device.platform ?? '—'} ${device.osVersion ?? ''}`.trim()} />
          <KV k="Mode" v={device.mode ?? '—'} />
          <KV k="Server" v={device.serverHealthy == null ? '—' : device.serverHealthy ? 'healthy' : 'down'} />
          <KV k="Uptime" v={device.appUptimeSec != null ? formatDuration(device.appUptimeSec * 1000) : '—'} />
          <KV k="Sync pending" v={String(device.syncPending ?? '—')} />
          <KV k="Sync failed" v={String(device.syncFailed ?? '—')} />
          <KV k="Oldest pending" v={device.oldestPendingAgeMs != null ? formatDuration(device.oldestPendingAgeMs) : '—'} />
          <KV k="Last sync" v={device.lastSyncAt ? timeAgo(device.lastSyncAt) : '—'} />
          <KV k="Sales today" v={salesText(device)} />
          <KV k="First seen" v={timeAgo(device.firstReportAt)} />
          <KV k="Last seen" v={timeAgo(device.lastReportAt)} />
        </div>

        <div className="card-head">Errors</div>
        {err && <div className="error-banner">{err}</div>}
        {errors == null && !err && <div className="muted">Loading…</div>}
        {errors && errors.length === 0 && <div className="muted">No errors reported. 🎉</div>}
        {errors?.map((e) => (
          <div key={e.id} className="err">
            <div className="err-head">
              <span className="badge badge-warn">×{e.count}</span>
              <span className="err-msg">{e.message}</span>
            </div>
            <div className="muted tiny">
              {e.source ?? 'unknown'} · v{e.appVersion ?? '?'} · last {timeAgo(e.lastSeen)}
            </div>
            {e.stack && <pre className="stack">{e.stack}</pre>}
          </div>
        ))}
      </aside>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <div className="muted tiny">{k}</div>
      <div>{v}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ helpers */

function syncCell(d: DeviceRow) {
  const pending = d.syncPending ?? 0
  const failed = d.syncFailed ?? 0
  if (d.syncPending == null && d.syncFailed == null) return <span className="muted">—</span>
  if (failed > 0) return <span className="badge badge-bad">{failed} failed</span>
  if (pending > 0) return <span className="badge badge-warn">{pending} queued</span>
  return <span className="badge badge-good">clear</span>
}

function salesCell(d: DeviceRow) {
  if (d.salesTodayCount == null) return <span className="muted">—</span>
  return (
    <span>
      {d.salesTodayCount} · <span className="muted">{cedis(d.salesTodayPesewas ?? 0)}</span>
    </span>
  )
}

function salesText(d: DeviceRow): string {
  if (d.salesTodayCount == null) return '—'
  return `${d.salesTodayCount} sales · ${cedis(d.salesTodayPesewas ?? 0)}`
}

/** Pesewas (integer) → GHS display. */
function cedis(pesewas: number): string {
  return `GHS ${(pesewas / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  return `${formatDuration(diff)} ago`
}
