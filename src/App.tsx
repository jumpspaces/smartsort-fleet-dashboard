import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getDevices,
  getErrors,
  getShops,
  login,
  provisionShop,
  reissueClaimCode,
  revokeStoreKey,
  Unauthorized,
  type DeviceRow,
  type ErrorRow,
  type ProvisionResult,
  type ShopRow,
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
  const [view, setView] = useState<'terminals' | 'shops'>('terminals')
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
        <nav className="tabs">
          <button
            onClick={() => setView('terminals')}
            aria-current={view === 'terminals' ? 'page' : undefined}
          >
            Terminals
          </button>
          <button
            onClick={() => setView('shops')}
            aria-current={view === 'shops' ? 'page' : undefined}
          >
            Shops
          </button>
        </nav>
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

      {view === 'shops' ? (
        <Shops apiBase={apiBase} token={token} onUnauthorized={onLogout} />
      ) : (
        <Terminals
          devices={devices}
          stats={stats}
          errorsByDevice={errorsByDevice}
          onSelect={setSelected}
        />
      )}

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

/* --------------------------------------------------------------- terminals */

function Terminals({
  devices,
  stats,
  errorsByDevice,
  onSelect,
}: {
  devices: DeviceRow[]
  stats: { total: number; online: number; offline: number; erroring: number; backedUp: number }
  errorsByDevice: Map<string, number>
  onSelect: (d: DeviceRow) => void
}) {
  return (
    <>
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
                  <tr key={d.deviceId} onClick={() => onSelect(d)} className="row-click">
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
    </>
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

/* ------------------------------------------------------------------- shops */

/**
 * Shop onboarding (WS3). Provisioning mints a one-time claim code that the shop
 * redeems on its desktop; the owner sets their own password there, so nothing
 * here ever knows a live shop credential.
 */
function Shops({
  apiBase,
  token,
  onUnauthorized,
}: {
  apiBase: string
  token: string
  onUnauthorized: () => void
}) {
  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [result, setResult] = useState<(ProvisionResult & { shopName: string }) | null>(null)
  const [selected, setSelected] = useState<ShopRow | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { shops } = await getShops(apiBase, token)
      setShops(shops)
      setError(null)
      // Keep an open drawer in sync with what the server now says.
      setSelected((cur) => (cur ? (shops.find((s) => s.id === cur.id) ?? null) : null))
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Failed to load shops')
    }
  }, [apiBase, token, onUnauthorized])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onProvisioned = useCallback(
    (r: ProvisionResult & { shopName: string }) => {
      setResult(r)
      setFormOpen(false)
      void refresh()
    },
    [refresh],
  )

  return (
    <>
      <section className="card">
        <div className="card-head-row">
          <span>Shops</span>
          <button onClick={() => setFormOpen((v) => !v)} aria-expanded={formOpen}>
            {formOpen ? 'Cancel' : 'Onboard a shop'}
          </button>
        </div>

        {formOpen && (
          <OnboardForm apiBase={apiBase} token={token} onDone={onProvisioned} onUnauthorized={onUnauthorized} />
        )}

        {result && <ClaimCodePanel result={result} onDismiss={() => setResult(null)} />}

        {error && <div className="error-banner page-error">{error}</div>}

        {shops == null ? (
          <ShopsSkeleton />
        ) : shops.length === 0 ? (
          <div className="empty">
            <div className="empty-title">No shops yet</div>
            Onboard one to mint its claim code — the shop enters that code on its
            desktop to connect the machine and set the owner's password.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Shop</th>
                  <th>Shop code</th>
                  <th>Owner</th>
                  <th>Machines</th>
                  <th>Claim code</th>
                  <th>Onboarded</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.id} className="row-click" onClick={() => setSelected(s)}>
                    <td>
                      <span className={`badge ${s.activated ? 'badge-good' : 'badge-warn'}`}>
                        {s.activated ? 'active' : 'pending'}
                      </span>
                    </td>
                    <td>
                      <div className="shop-name">{s.name}</div>
                      <div className="muted tiny">{s.location ?? '—'}</div>
                    </td>
                    <td className="mono">{s.code ?? '—'}</td>
                    <td>
                      <div>{s.owner?.name ?? '—'}</div>
                      <div className="muted mono tiny">{s.owner?.staffId ?? ''}</div>
                    </td>
                    <td>
                      <div className="stack-cell">
                        {s.machines.length === 0 && <span className="muted">none</span>}
                        {s.machines.map((m) => (
                          <span
                            key={m.keyId}
                            className={`term-chip${m.revokedAt ? ' revoked' : ''}`}
                            title={m.machineName ?? m.machineId}
                          >
                            {m.terminalCode}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{claimCell(s)}</td>
                    <td className="muted">{timeAgo(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <ShopDrawer
          apiBase={apiBase}
          token={token}
          shop={selected}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onUnauthorized={onUnauthorized}
          onReissued={(r) =>
            setResult({
              ...r,
              shopId: selected.id,
              shopCode: selected.code ?? '',
              ownerId: '',
              shopName: selected.name,
            })
          }
        />
      )}
    </>
  )
}

function claimCell(s: ShopRow) {
  // An active shop needs no code — later machines connect with the owner's sign-in.
  if (s.activated) return <span className="muted">—</span>
  if (s.hasLiveClaimCode && s.claimCodeExpiresAt) {
    return <span className="muted">expires {timeUntil(s.claimCodeExpiresAt)}</span>
  }
  return <span className="badge badge-bad">expired</span>
}

function ShopsSkeleton() {
  return (
    <div style={{ padding: '16px' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton" style={{ marginBottom: 14, width: `${88 - i * 12}%` }} />
      ))}
    </div>
  )
}

function OnboardForm({
  apiBase,
  token,
  onDone,
  onUnauthorized,
}: {
  apiBase: string
  token: string
  onDone: (r: ProvisionResult & { shopName: string }) => void
  onUnauthorized: () => void
}) {
  const [shopName, setShopName] = useState('')
  const [location, setLocation] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [staffId, setStaffId] = useState('owner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await provisionShop(apiBase, token, {
        shopName: shopName.trim(),
        location: location.trim() || undefined,
        phone: phone.trim() || undefined,
        ownerName: ownerName.trim(),
        staffId: staffId.trim(),
      })
      onDone({ ...r, shopName: shopName.trim() })
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not onboard this shop')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="onboard-form" onSubmit={submit}>
      <label>
        Shop name
        <input value={shopName} onChange={(e) => setShopName(e.target.value)} required autoFocus />
      </label>
      <label>
        Location
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Kumasi" />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024…" />
      </label>
      <label>
        Owner's name
        <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
      </label>
      <label>
        Owner's login ID
        <input value={staffId} onChange={(e) => setStaffId(e.target.value)} required />
        <span className="field-hint">What the owner types to sign in, here and in the mobile app.</span>
      </label>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Onboarding…' : 'Onboard shop'}
        </button>
        <span className="field-hint">
          No password is set here — the owner chooses their own when they connect the machine.
        </span>
      </div>
    </form>
  )
}

/** Shown once, right after provisioning or re-issue. */
function ClaimCodePanel({
  result,
  onDismiss,
}: {
  result: ProvisionResult & { shopName: string }
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.claimCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="claim-result">
      <div className="muted">
        Claim code for <strong style={{ color: 'var(--text)' }}>{result.shopName}</strong>
      </div>
      <div className="claim-row">
        <span className="claim-code">{result.claimCode}</span>
        <button className="ghost" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="ghost" onClick={onDismiss}>
          Done
        </button>
      </div>
      <div className="field-hint">
        Give this to the shop — they enter it on the desktop app to connect the
        machine and set the owner's password. It works once, and expires{' '}
        {timeUntil(result.expiresAt)}. You won't be able to see it again.
      </div>
      {result.shopCode && (
        <div className="field-hint" style={{ marginTop: 10 }}>
          Their <strong style={{ color: 'var(--text)' }}>shop code</strong> is{' '}
          <span className="mono" style={{ color: 'var(--text)' }}>
            {result.shopCode}
          </span>{' '}
          — the owner types this with their staff ID to sign in to the mobile app.
          It doesn't expire, and it stays visible in this list.
        </div>
      )}
    </div>
  )
}

function ShopDrawer({
  apiBase,
  token,
  shop,
  onClose,
  onChanged,
  onUnauthorized,
  onReissued,
}: {
  apiBase: string
  token: string
  shop: ShopRow
  onClose: () => void
  onChanged: () => void
  onUnauthorized: () => void
  onReissued: (r: { claimCode: string; expiresAt: string }) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'That action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="shop-name lg">{shop.name}</div>
            <div className="muted tiny">{shop.location ?? 'No location set'}</div>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="error-banner page-error">{error}</div>}

        <div className="kv-grid">
          <KV k="Status" v={shop.activated ? 'Active' : 'Pending first connection'} />
          <KV k="Shop code" v={shop.code ?? '—'} />
          <KV k="Owner" v={shop.owner?.name ?? '—'} />
          <KV k="Owner login" v={shop.owner?.staffId ?? '—'} />
          <KV k="Currency" v={shop.currency} />
          <KV k="Phone" v={shop.phone ?? '—'} />
          <KV k="Onboarded" v={timeAgo(shop.createdAt)} />
        </div>

        {!shop.activated && (
          <div style={{ marginBottom: 22 }}>
            <button
              disabled={busy === 'code'}
              onClick={() =>
                void run('code', async () => {
                  const r = await reissueClaimCode(apiBase, token, shop.id)
                  onReissued(r)
                  onClose()
                })
              }
            >
              {busy === 'code' ? 'Issuing…' : 'Issue a new claim code'}
            </button>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Use this when the shop lost the code or it expired. The previous code
              stops working.
            </div>
          </div>
        )}

        <div className="card-head" style={{ padding: '0 0 10px', borderBottom: 'none' }}>
          Machines
        </div>
        {shop.machines.length === 0 && (
          <div className="muted">
            No machine has connected yet. The shop connects one by entering its claim code.
          </div>
        )}
        {shop.machines.map((m) => (
          <div key={m.keyId} className="machine">
            <div>
              <div>
                <span className={`term-chip${m.revokedAt ? ' revoked' : ''}`}>{m.terminalCode}</span>{' '}
                <strong>{m.machineName ?? 'Unnamed machine'}</strong>
              </div>
              <div className="muted mono tiny">{m.keyPrefix}…</div>
              <div className="muted tiny">
                {m.revokedAt
                  ? `Revoked ${timeAgo(m.revokedAt)}`
                  : m.lastSeenAt
                    ? `Last synced ${timeAgo(m.lastSeenAt)}`
                    : 'Never synced'}
              </div>
            </div>
            {!m.revokedAt &&
              (confirming === m.keyId ? (
                <div className="stack-cell">
                  <button
                    className="danger"
                    disabled={busy === m.keyId}
                    onClick={() =>
                      void run(m.keyId, async () => {
                        await revokeStoreKey(apiBase, token, m.keyId)
                        setConfirming(null)
                      })
                    }
                  >
                    {busy === m.keyId ? 'Revoking…' : 'Confirm revoke'}
                  </button>
                  <button className="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <button className="danger" onClick={() => setConfirming(m.keyId)}>
                  Revoke
                </button>
              ))}
          </div>
        ))}
        <div className="field-hint" style={{ marginTop: 12 }}>
          Revoking stops a machine syncing. It keeps selling offline, and its data
          is kept — reconnect it by claiming again with the owner's sign-in.
        </div>
      </aside>
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

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'now'
  return `in ${formatDuration(diff)}`
}
