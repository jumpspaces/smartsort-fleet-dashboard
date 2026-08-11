import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Unauthorized, type Api, type ShopRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import { compare, PlainHeader, SortHeader, type Sort } from '../components/SortHeader.tsx'
import { Button, Chip, Empty, Notice, Status, TableSkeleton } from '../components/ui.tsx'
import { exact, timeAgo, timeUntil } from '../lib/format.ts'
import { useHotkey } from '../lib/useHotkey.ts'
import { ClaimPanel, type ClaimResult } from './ClaimCode.tsx'

type SortKey = 'status' | 'name' | 'code' | 'machines' | 'created'

export function Shops({
  api,
  reloadKey,
  onNavigate,
}: {
  api: Api
  reloadKey: number
  onNavigate: Navigate
}) {
  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  // The code minted by onboarding, shown once. Codes re-issued for an existing
  // shop appear on that shop's own page, where the button for them lives.
  const [result, setResult] = useState<ClaimResult | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort<SortKey>>({ key: 'status', dir: 'asc' })
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  const refresh = useCallback(async () => {
    try {
      const shops = await api.shops()
      setShops(shops)
      setError(null)
    } catch (err) {
      // The API client already drops the session on an unrecoverable 401; this
      // just avoids painting a scary message over a sign-in screen.
      if (err instanceof Unauthorized) return
      setError(err instanceof Error ? err.message : 'Could not load shops')
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh, reloadKey])

  const onProvisioned = useCallback(
    (r: ClaimResult) => {
      setResult(r)
      setFormOpen(false)
      void refresh()
    },
    [refresh],
  )

  const visible = useMemo(() => {
    const list = shops ?? []
    const q = query.trim().toLowerCase()
    const matched = q
      ? list.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.code ?? '').toLowerCase().includes(q) ||
            (s.location ?? '').toLowerCase().includes(q) ||
            (s.owner?.name ?? '').toLowerCase().includes(q) ||
            (s.owner?.staffId ?? '').toLowerCase().includes(q),
        )
      : list

    const { key, dir } = sort
    return [...matched].sort((a, b) => {
      switch (key) {
        case 'status':
          // Pending shops first: they are the ones still waiting on someone.
          return compare(Number(a.activated), Number(b.activated), dir) || compare(a.name, b.name, 'asc')
        case 'name':
          return compare(a.name, b.name, dir)
        case 'code':
          return compare(a.code, b.code, dir)
        case 'machines':
          return compare(liveMachines(a), liveMachines(b), dir)
        case 'created':
          return compare(new Date(a.createdAt).getTime(), new Date(b.createdAt).getTime(), dir)
      }
    })
  }, [shops, query, sort])

  const pending = (shops ?? []).filter((s) => !s.activated).length

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Shops</h1>
          <p className="view-sub">
            Onboarding mints a one-time claim code. The shop redeems it on their desktop and the
            owner sets their own password there — no live credential is ever known here.
          </p>
        </div>
        <Button variant="primary" onClick={() => setFormOpen((v) => !v)} aria-expanded={formOpen}>
          {formOpen ? 'Cancel' : 'Onboard a shop'}
        </Button>
      </div>

      {error && <Notice>{error}</Notice>}

      <section className="panel">
        {formOpen && (
          <OnboardForm
            api={api}
            onDone={onProvisioned}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {result && (
          <ClaimPanel result={{ ...result, kind: 'claim' }} onDismiss={() => setResult(null)} />
        )}

        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              className="input"
              type="search"
              value={query}
              placeholder="Search shop, code, owner…"
              aria-label="Search shops"
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>
          <div className="toolbar-end">
            {pending > 0 && <Chip tone="warn">{pending} awaiting first connection</Chip>}
            {shops != null && query.trim() && (
              <span>
                {visible.length} of {shops.length}
              </span>
            )}
          </div>
        </div>

        {shops == null ? (
          <TableSkeleton rows={4} />
        ) : shops.length === 0 ? (
          <Empty
            icon="shops"
            title="No shops yet"
            action={
              <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                Onboard the first shop
              </Button>
            }
          >
            Onboarding a shop mints its claim code. The shop types that code into the desktop app
            to connect the machine and set the owner’s password.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty
            icon="search"
            title="No shop matches that search"
            action={
              <Button size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          >
            Searching {shops.length} {shops.length === 1 ? 'shop' : 'shops'} by name, shop code,
            location and owner.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={setSort} defaultDir="asc" />
                  <SortHeader label="Shop" sortKey="name" sort={sort} onSort={setSort} defaultDir="asc" />
                  <SortHeader label="Shop code" sortKey="code" sort={sort} onSort={setSort} defaultDir="asc" />
                  <PlainHeader label="Owner" />
                  <SortHeader label="Machines" sortKey="machines" sort={sort} onSort={setSort} numeric />
                  <PlainHeader label="Claim code" />
                  <SortHeader label="Onboarded" sortKey="created" sort={sort} onSort={setSort} numeric />
                  <PlainHeader label="Open detail" srOnly />
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr
                    key={s.id}
                    data-clickable="true"
                    onClick={() => onNavigate('shop', { id: s.id })}
                  >
                    <td>
                      <Status
                        tone={s.activated ? 'ok' : 'warn'}
                        label={s.activated ? 'Active' : 'Pending'}
                      />
                      {healthNote(s.health)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="row-open"
                        onClick={(e) => {
                          e.stopPropagation()
                          onNavigate('shop', { id: s.id })
                        }}
                      >
                        {s.name}
                      </button>
                      <div className="row-sub">{s.location ?? 'No location set'}</div>
                    </td>
                    <td className="mono">{s.code ?? '—'}</td>
                    <td>
                      <div>{s.owner?.name ?? '—'}</div>
                      <div className="row-sub mono">{s.owner?.staffId ?? ''}</div>
                    </td>
                    <td className="col-num">
                      <div className="cell-stack" style={{ justifyContent: 'flex-end' }}>
                        {s.machines.length === 0 ? (
                          <span className="muted">None</span>
                        ) : (
                          s.machines.map((m) => (
                            <span
                              key={m.keyId}
                              className="code-chip"
                              data-revoked={m.revokedAt ? 'true' : undefined}
                              title={
                                m.revokedAt
                                  ? `${m.machineName ?? m.machineId} — revoked`
                                  : (m.machineName ?? m.machineId)
                              }
                            >
                              {m.terminalCode}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>{claimCell(s)}</td>
                    <td className="col-num muted" title={exact(s.createdAt)}>
                      {timeAgo(s.createdAt)}
                    </td>
                    <td style={{ width: 1, paddingLeft: 0 }}>
                      <Icon name="chevron" size={14} className="chev" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function liveMachines(s: ShopRow): number {
  return s.machines.filter((m) => !m.revokedAt).length
}

/**
 * "3 of 4 healthy" under the onboarding status, so a shop with something
 * wrong is visible from the table — not just from opening its drawer.
 */
function healthNote(health: ShopRow['health']) {
  const total = health.healthy + health.attention + health.offline
  if (total === 0) return null
  const tone = health.offline > 0 ? 'bad' : health.attention > 0 ? 'warn' : 'ok'
  return (
    <div className="row-sub">
      <span className="dot" data-tone={tone} /> {health.healthy} of {total}{' '}
      {total === 1 ? 'terminal' : 'terminals'} healthy
    </div>
  )
}

function claimCell(s: ShopRow) {
  // An active shop needs no code — later machines connect with the owner's sign-in.
  if (s.activated) return <span className="muted">—</span>
  if (s.hasLiveClaimCode && s.claimCodeExpiresAt) {
    return (
      <span className="muted" title={exact(s.claimCodeExpiresAt)}>
        Expires {timeUntil(s.claimCodeExpiresAt)}
      </span>
    )
  }
  return <Chip tone="bad">Expired</Chip>
}

/* -------------------------------------------------------------- onboarding */

function OnboardForm({
  api,
  onDone,
  onCancel,
}: {
  api: Api
  onDone: (r: ClaimResult) => void
  onCancel: () => void
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
      const r = await api.provisionShop({
        shopName: shopName.trim(),
        location: location.trim() || undefined,
        phone: phone.trim() || undefined,
        ownerName: ownerName.trim(),
        staffId: staffId.trim(),
      })
      onDone({ ...r, shopName: shopName.trim() })
    } catch (err) {
      if (err instanceof Unauthorized) return
      setError(err instanceof Error ? err.message : 'Could not onboard this shop')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field">
        <span>Shop name</span>
        <input
          className="input"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span>Location</span>
        <input
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Kumasi"
        />
      </label>
      <label className="field">
        <span>Phone</span>
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="024…"
        />
      </label>
      <label className="field">
        <span>Owner’s name</span>
        <input
          className="input"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Owner’s login ID</span>
        <input
          className="input"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          required
        />
        <span className="hint">What the owner types to sign in, here and in the mobile app.</span>
      </label>

      {error && (
        <div className="full">
          <Notice>{error}</Notice>
        </div>
      )}

      <div className="form-actions">
        <Button type="submit" variant="primary" busy={busy} busyLabel="Onboarding…">
          Onboard shop
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="hint">
          No password is set here — the owner chooses their own when they connect the machine.
        </span>
      </div>
    </form>
  )
}
