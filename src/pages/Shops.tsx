import { useState, type FormEvent } from 'react'
import * as api from '../api/endpoints.ts'
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES, type BusinessType, type ProvisionResult, type Shop } from '../api/types.ts'
import { ActionError, CodeReveal, Dialog, Field } from '../components/forms.tsx'
import { invalidate, useAction } from '../lib/query.ts'
import { useSession } from '../lib/session.tsx'
import { until } from '../lib/format.ts'
import { saveCsv } from '../lib/csv.ts'
import { Card, Empty, Live, Loadable, PageHeader, Search, Segmented, When } from '../components/ui.tsx'
import { useApi, useShops } from '../data.ts'
import { count } from '../lib/format.ts'
import { shopHref, useSetParams } from '../lib/router.ts'

type Filter = 'all' | 'problems' | 'setup' | 'closed'

function worst(s: Shop): 0 | 1 | 2 | 3 {
  if (s.health.offline) return 0
  if (s.health.attention) return 1
  if (!s.activated) return 2
  return 3
}

export function Shops({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const shops = useShops()
  const { canAct } = useSession()
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const f = params.get('show')
  const filter: Filter = f === 'problems' || f === 'setup' || f === 'closed' ? f : 'all'

  return (
    <div className="stack">
      <PageHeader
        title="Shops"
        sub="Every shop on SmartSort and how its tills are doing."
        actions={
          <>
            <Live updatedAt={shops.updatedAt} busy={shops.refreshing} />
            <button
              className="btn sm"
              disabled={!shops.data?.length}
              onClick={() =>
                saveCsv('shops', shops.data ?? [], [
                  { header: 'Shop', value: (s) => s.name },
                  { header: 'Code', value: (s) => s.code },
                  { header: 'Location', value: (s) => s.location },
                  { header: 'Phone', value: (s) => s.phone },
                  { header: 'Owner', value: (s) => s.owner?.name },
                  { header: 'Owner staff ID', value: (s) => s.owner?.staffId },
                  { header: 'Currency', value: (s) => s.currency },
                  { header: 'Set up', value: (s) => (s.activated ? 'yes' : 'no') },
                  { header: 'Tills working', value: (s) => s.health.healthy },
                  { header: 'Tills needing a look', value: (s) => s.health.attention },
                  { header: 'Tills offline', value: (s) => s.health.offline },
                  { header: 'Joined', value: (s) => s.createdAt },
                ])
              }
            >
              Download CSV
            </button>
            {canAct && (
              <button className="btn sm primary" onClick={() => setCreating(true)}>
                New shop
              </button>
            )}
          </>
        }
      />
      {canAct && <NewShop open={creating} onClose={() => setCreating(false)} />}
      <Loadable q={shops} rows={8}>
        {(all) => {
          const needle = q.trim().toLowerCase()
          // A closed shop is out of every list but its own: its tills are cut
          // off on purpose, and it isn't waiting to be set up.
          const open = all.filter((s) => !s.closure)
          const closed = all.filter((s) => s.closure)
          const problems = open.filter((s) => s.health.offline || s.health.attention)
          const setup = open.filter((s) => !s.activated)
          const base = filter === 'problems' ? problems : filter === 'setup' ? setup : filter === 'closed' ? closed : open
          const list = base
            .filter(
              (s) =>
                !needle ||
                [s.name, s.code, s.location, s.owner?.name, s.phone].some((v) => v?.toLowerCase().includes(needle)),
            )
            .sort((a, b) => worst(a) - worst(b) || a.name.localeCompare(b.name))

          return (
            <>
              <div className="spread">
                <Segmented
                  label="Filter shops"
                  value={filter}
                  onChange={(v) => setParams({ show: v === 'all' ? null : v })}
                  options={[
                    { value: 'all', label: 'All', n: open.length },
                    { value: 'problems', label: 'With problems', n: problems.length },
                    { value: 'setup', label: 'Not set up yet', n: setup.length },
                    ...(closed.length || filter === 'closed' ? [{ value: 'closed' as const, label: 'Closed', n: closed.length }] : []),
                  ]}
                />
                <Search value={q} onChange={setQ} placeholder="Search name, code, owner or place" />
              </div>
              <Card flush>
                {list.length === 0 ? (
                  <Empty title={filter === 'closed' ? 'No closed shops' : all.length ? 'No shops match' : 'No shops yet'} />
                ) : (
                  <div className="table-wrap">
                    <table className="table cards">
                      <thead>
                        <tr>
                          <th>Shop</th>
                          <th>Owner</th>
                          <th>Tills</th>
                          <th>Set up</th>
                          <th>Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((s) => (
                          <tr
                            key={s.id}
                            data-nav
                            className="link"
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest('a') || e.metaKey || e.ctrlKey) return
                              location.hash = shopHref(s.id)
                            }}
                          >
                            <td data-label="" className="primary-cell">
                              <a href={shopHref(s.id)}>{s.name}</a>
                              <div className="small muted">
                                {[s.code, s.location].filter(Boolean).join(' · ') || '—'}
                              </div>
                            </td>
                            <td data-label="Owner">
                              {s.owner?.name ?? <span className="muted">—</span>}
                              {s.phone && <div className="small muted">{s.phone}</div>}
                            </td>
                            <td data-label="Tills">
                              <TillHealth s={s} />
                            </td>
                            <td data-label="Set up">
                              {s.closure ? (
                                <span className="badge attention" title={`Closed ${until(s.closure.closedAt)}`}>
                                  {s.closure.purgeApprovedAt ? `Closed · deleted ${until(s.closure.purgeAfter)}` : 'Closed'}
                                </span>
                              ) : s.activated ? (
                                <span className="sub">Yes</span>
                              ) : s.hasLiveClaimCode ? (
                                <span className="badge neutral">Code sent</span>
                              ) : (
                                <span className="badge attention">Waiting</span>
                              )}
                            </td>
                            <td data-label="Joined" className="sub">
                              <When iso={s.createdAt} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              {filter === 'closed' && <DeletedShops />}
            </>
          )
        }}
      </Loadable>
    </div>
  )
}

/** Shops whose data is gone: the record of who closed them, who agreed and what went. */
function DeletedShops() {
  const q = useApi('closures', (c, s) => api.shopClosures(c, s))
  return (
    <Card title="Deleted" sub="Shops whose data was removed from the server. Backups that still hold it age out within 14 days." flush>
      <Loadable q={q} rows={2}>
        {({ closures }) => {
          const gone = closures.filter((c) => c.status === 'purged')
          return gone.length === 0 ? (
            <Empty title="None deleted" />
          ) : (
            <div className="table-wrap">
              <table className="table cards">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>Closed</th>
                    <th>Deleted</th>
                    <th>Records</th>
                  </tr>
                </thead>
                <tbody>
                  {gone.map((c) => (
                    <tr key={c.id}>
                      <td data-label="" className="primary-cell">
                        {c.shopName}
                        <div className="small muted">{c.shopCode ?? '—'}</div>
                      </td>
                      <td data-label="Closed">
                        <When iso={c.closedAt} />
                        {c.closedByLabel && <div className="small muted">{c.closedByLabel}</div>}
                      </td>
                      <td data-label="Deleted">
                        <When iso={c.purgedAt} />
                        {c.purgeApprovedByLabel && <div className="small muted">agreed by {c.purgeApprovedByLabel}</div>}
                      </td>
                      <td data-label="Records" className="num">
                        {count(Object.values(c.purgeCounts ?? {}).reduce((a, b) => a + b, 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }}
      </Loadable>
    </Card>
  )
}

export function TillHealth({ s }: { s: Shop }) {
  const { healthy, attention, offline } = s.health
  if (healthy + attention + offline === 0) return <span className="muted">None reporting</span>
  return (
    <span className="row num" style={{ gap: 10 }}>
      {healthy > 0 && (
        <span className="row" style={{ gap: 4 }} title="Working">
          <span className="dot healthy" /> {count(healthy)}
        </span>
      )}
      {attention > 0 && (
        <span className="row" style={{ gap: 4 }} title="Need a look">
          <span className="dot attention" /> {count(attention)}
        </span>
      )}
      {offline > 0 && (
        <span className="row" style={{ gap: 4 }} title="Offline">
          <span className="dot offline" /> {count(offline)}
        </span>
      )}
    </span>
  )
}

const CURRENCIES = ['GHS', 'USD', 'EUR', 'GBP', 'NGN'] as const

/**
 * Set up a shop on the owner's behalf. The result is a one-time setup code the
 * owner types on their first till; it also sets their password there.
 */
function NewShop({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client } = useSession()
  const blank = { shopName: '', location: '', phone: '', ownerName: '', staffId: '', currency: 'GHS', businessType: '' as BusinessType | '' }
  const [f, setF] = useState(blank)
  const [made, setMade] = useState<ProvisionResult | null>(null)
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }))
  const save = useAction(async () => {
    if (!f.businessType) throw new Error('Pick the kind of business — it decides which features the shop starts with.')
    const r = await api.provisionShop(client, {
      shopName: f.shopName.trim(),
      location: f.location.trim() || undefined,
      phone: f.phone.trim() || undefined,
      currency: f.currency,
      ownerName: f.ownerName.trim(),
      staffId: f.staffId.trim(),
      businessType: f.businessType,
    })
    invalidate('shops')
    setMade(r)
  })
  const close = () => {
    setF(blank)
    setMade(null)
    onClose()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  return (
    <Dialog open={open} onClose={close} title={made ? 'Shop created' : 'New shop'}>
      {made ? (
        <div className="stack">
          <CodeReveal
            label={`Setup code · expires ${until(made.expiresAt)}`}
            code={made.claimCode}
            note="Give this to the owner. They type it on their first till, with their staff ID, to set the shop up and choose a password."
          />
          <div className="small sub">
            Shop code <span className="mono">{made.shopCode}</span> — they’ll type this with their staff ID to sign in to the cloud.
          </div>
          <div className="form-actions">
            <a className="btn" href={shopHref(made.shopId)} onClick={close}>
              Open the shop
            </a>
            <button className="btn primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="Shop name" id="ns">
            <input id="ns" className="input" required value={f.shopName} onChange={set('shopName')} />
          </Field>
          <Field label="Kind of business" id="nt" hint="Decides the setup questions and starting features. The owner can’t change it.">
            <select id="nt" className="select" required value={f.businessType} onChange={set('businessType')}>
              <option value="">Choose…</option>
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BUSINESS_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Location" id="nl">
              <input id="nl" className="input" value={f.location} onChange={set('location')} placeholder="e.g. Kejetia, Kumasi" />
            </Field>
            <Field label="Phone" id="np">
              <input id="np" className="input" type="tel" value={f.phone} onChange={set('phone')} />
            </Field>
            <Field label="Owner's name" id="no">
              <input id="no" className="input" required value={f.ownerName} onChange={set('ownerName')} />
            </Field>
            <Field label="Owner's staff ID" id="ni" hint="What they sign in with.">
              <input id="ni" className="input" required value={f.staffId} onChange={set('staffId')} />
            </Field>
            <Field label="Currency" id="nc" hint="A label on amounts — nothing is converted.">
              <select id="nc" className="select" value={f.currency} onChange={set('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <ActionError error={save.error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={save.pending}>
              Create shop
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
