import { useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { Phone, PhoneVersion } from '../api/types.ts'
import { Dialog } from '../components/forms.tsx'
import { Card, Empty, Live, Loadable, PageHeader, Segmented, When } from '../components/ui.tsx'
import { useApi, useShopIndex } from '../data.ts'
import { count, date, exact } from '../lib/format.ts'
import { shopHref, useSetParams } from '../lib/router.ts'

const PLATFORM: Record<string, string> = { ios: 'iPhone', android: 'Android' }

/** "2.0.0" + the update it runs: the embedded bundle, or an update by its short id and date. */
function update(p: { updateId: string | null; updateCreatedAt: string | null; embedded?: boolean | null }) {
  if (!p.updateId || p.embedded) return 'Built-in'
  return `${p.updateId.slice(0, 8)}${p.updateCreatedAt ? ` · ${date(p.updateCreatedAt)}` : ''}`
}

/**
 * The owner's phone app, install by install: which build and which
 * over-the-air update each runs, who last used it, and the errors it caught.
 * Its errors are in App problems too, alongside the tills'.
 */
export function Phones({ params, shopId }: { params?: URLSearchParams; shopId?: string }) {
  const setParams = useSetParams()
  const daysRaw = params?.get('days') ?? '7'
  const days = (['7', '30'] as const).includes(daysRaw as '7') ? (daysRaw as '7' | '30') : '7'
  const shop = shopId ?? params?.get('shopId') ?? undefined
  const shops = useShopIndex()
  const q = useApi(`phones:${shop ?? ''}:${days}`, (c, s) => api.phones(c, { shopId: shop, days: Number(days) }, s), { every: 120_000 })
  const [open, setOpen] = useState<Phone | null>(null)
  const embedded = !!shopId

  const body = (
    <Loadable q={q} rows={6}>
      {({ phones, versions }) =>
        phones.length === 0 ? (
          <Card>
            <Empty title="No phone has checked in">
              {embedded ? 'Nobody at this shop has signed in on the phone app since it started reporting.' : 'Phones report once they run a build that checks in.'}
            </Empty>
          </Card>
        ) : (
          <>
            {!embedded && <Versions versions={versions} total={phones.length} />}
            <Card title={embedded ? 'Phones' : 'Every phone'} sub={`Errors over the last ${days} days.`} flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {!embedded && <th>Shop</th>}
                      <th>Who</th>
                      <th>Phone</th>
                      <th>App</th>
                      <th>Update</th>
                      <th>Last seen</th>
                      <th className="r">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phones.map((p) => (
                      <tr key={p.installId} className={p.errors ? 'link' : undefined} onClick={p.errors ? () => setOpen(p) : undefined}>
                        {!embedded && (
                          <td className="nowrap">
                            <a href={shopHref(p.shopId)} onClick={(e) => e.stopPropagation()}>
                              {p.shopName ?? shops.get(p.shopId)?.name ?? '—'}
                            </a>
                          </td>
                        )}
                        <td className="nowrap">
                          {p.userName ?? '—'}
                          <div className="small muted">{p.userRole === 'owner' ? 'Owner' : p.userRole === 'cashier' ? 'Cashier' : ''}</div>
                        </td>
                        <td className="nowrap">
                          {p.model ?? PLATFORM[p.platform ?? ''] ?? p.platform ?? '—'}
                          <div className="small muted">
                            {PLATFORM[p.platform ?? ''] ?? p.platform} {p.osVersion}
                          </div>
                        </td>
                        <td className="mono nowrap">{p.appVersion ?? '—'}</td>
                        <td className="mono nowrap small">{update(p)}</td>
                        <td className="sub nowrap">
                          <When iso={p.lastSeenAt} />
                        </td>
                        <td className="r num">
                          {p.errors ? (
                            <button className="btn sm ghost" onClick={() => setOpen(p)}>
                              {count(p.errors)}
                            </button>
                          ) : (
                            <span className="muted">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )
      }
    </Loadable>
  )

  return (
    <>
      {embedded ? (
        body
      ) : (
        <div className="stack">
          <PageHeader
            title="Phones"
            sub="The SmartSort phone app, install by install — the build and over-the-air update each runs, and the errors it caught."
            actions={
              <>
                <Live updatedAt={q.updatedAt} busy={q.refreshing} />
                <Segmented
                  label="Errors over"
                  value={days}
                  onChange={(v) => setParams({ days: v === '7' ? null : v })}
                  options={[
                    { value: '7', label: '7 days' },
                    { value: '30', label: '30 days' },
                  ]}
                />
              </>
            }
          />
          {shop && (
            <div className="row small">
              Only {shops.get(shop)?.name ?? 'one shop'}
              <button className="btn sm ghost" onClick={() => setParams({ shopId: null })}>
                Show every shop
              </button>
            </div>
          )}
          {body}
        </div>
      )}
      <PhoneErrors phone={open} onClose={() => setOpen(null)} />
    </>
  )
}

function Versions({ versions, total }: { versions: PhoneVersion[]; total: number }) {
  return (
    <Card title="What the phones are running" sub="Newest update first. A line with errors and few phones is usually the update to look at." flush>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>App</th>
              <th>Update</th>
              <th>Channel</th>
              <th className="r">Phones</th>
              <th className="r">Errors</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={`${v.appVersion}|${v.updateId}`}>
                <td className="mono">{v.appVersion ?? '—'}</td>
                <td className="mono small">{update(v)}</td>
                <td>{v.channel ?? '—'}</td>
                <td className="r num">
                  {v.count}
                  <span className="small muted"> of {total}</span>
                </td>
                <td className="r num">{v.errors ? count(v.errors) : <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PhoneErrors({ phone, onClose }: { phone: Phone | null; onClose: () => void }) {
  const q = useApi(`phones:errors:${phone?.installId ?? ''}`, (c, s) => api.phoneErrors(c, phone!.installId, s), { enabled: !!phone })
  return (
    <Dialog open={!!phone} onClose={onClose} title={`Errors on ${phone?.userName ?? 'this phone'}’s phone`} wide>
      <Loadable q={q} rows={4}>
        {({ errors }) =>
          errors.length === 0 ? (
            <Empty title="No errors kept for this phone" />
          ) : (
            <ul className="list">
              {errors.map((e) => (
                <li key={e.id} style={{ padding: '10px 0' }}>
                  <div style={{ overflowWrap: 'anywhere' }}>{e.message}</div>
                  <div className="small muted">
                    {count(e.count)}× · v{e.appVersion ?? '?'} · last <span title={exact(e.lastSeen)}>{date(e.lastSeen)}</span>
                  </div>
                  {e.stack && (
                    <details>
                      <summary className="small">Stack</summary>
                      <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                        {e.stack}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </Dialog>
  )
}
