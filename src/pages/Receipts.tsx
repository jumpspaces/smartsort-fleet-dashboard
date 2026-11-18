import { useEffect, useRef, useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { FoundSale, FoundSaleLine, TillHint } from '../api/types.ts'
import { Card, Empty, Loadable, PageHeader, Search, When } from '../components/ui.tsx'
import { useApi, useShops } from '../data.ts'
import { date, exact, money } from '../lib/format.ts'
import { useDebounced } from '../lib/query.ts'
import { shopHref, tillHref, useSetParams } from '../lib/router.ts'

const WEIGHED: Record<string, string> = { kg: 'kg', l: 'l', m: 'm' }

/** Weighed lines are kept in thousandths: 1250 → "1.25 kg". */
function qty(l: FoundSaleLine): string {
  const unit = l.soldBy ? WEIGHED[l.soldBy] : undefined
  if (!unit) return String(l.qty)
  return `${(l.qty / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`
}

const PAID: Record<string, string> = { cash: 'Cash', momo: 'MoMo', split: 'Cash + MoMo', credit: 'On account' }

/**
 * Find a sale the way a support call describes it: a receipt number however
 * it's read out (TXN-T2-0451, T2 451, just 451), a MoMo reference, or a sale id.
 * Only what the tills have sent is here — when nothing matches, it says what
 * each of the shop's tills has sent and still holds.
 */
export function Receipts({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const shops = useShops()
  const shopId = params.get('shopId') ?? ''
  // The URL is the search: typing writes it (after a pause), and a link or ⌘K
  // that changes it while the page is open rewrites the box.
  const q = (params.get('q') ?? '').trim()
  const [text, setText] = useState(q)
  const shown = useRef(q)
  useEffect(() => {
    if (q !== shown.current) {
      shown.current = q
      setText(q)
    }
  }, [q])
  const typed = useDebounced(text.trim(), 400)
  useEffect(() => {
    if (typed !== shown.current) {
      shown.current = typed
      setParams({ q: typed })
    }
  }, [typed, setParams])

  const found = useApi(`receipts:${shopId}:${q}`, (c, s) => api.findReceipts(c, q, shopId || undefined, s), { enabled: q.length > 0 })

  return (
    <div className="stack">
      <PageHeader
        title="Find a sale"
        sub="By receipt number (TXN-T2-0451, T2 451, or just 451), MoMo reference or sale id. Each search is recorded in the activity log."
      />
      <div className="spread">
        <Search value={text} onChange={setText} placeholder="Receipt number or MoMo reference" />
        <select className="select" aria-label="Shop" value={shopId} onChange={(e) => setParams({ shopId: e.target.value || null })}>
          <option value="">Every shop</option>
          {(shops.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {!q ? (
        <Card>
          <Empty title="Type the number the customer read out">
            Choosing the shop narrows a bare number to that shop, and shows what its tills have sent when it isn’t here.
          </Empty>
        </Card>
      ) : (
        <Loadable q={found} rows={6}>
          {(r) =>
            r.sales.length > 0 ? (
              <>
                {r.sales.length > 1 && <div className="small muted">{r.sales.length} sales match — newest first.</div>}
                {r.sales.map((s) => (
                  <SaleCard key={s.id} s={s} />
                ))}
              </>
            ) : (
              <NotFound tills={r.tills} shopChosen={!!shopId} />
            )
          }
        </Loadable>
      )}
    </div>
  )
}

function SaleCard({ s }: { s: FoundSale }) {
  const m = (n: number) => money(n, s.currency)
  const refunded = s.returns.reduce((t, r) => t + r.refundTotal, 0)
  return (
    <Card
      title={
        <>
          <span className="mono">{s.receipt}</span> · <a href={shopHref(s.shopId)}>{s.shopName}</a>
        </>
      }
      sub={<span title={exact(s.createdAt)}>Rung {date(s.createdAt)} on the till’s clock</span>}
      actions={
        s.voided ? (
          <span className="badge offline">Voided</span>
        ) : s.returns.length ? (
          <span className="badge attention">Refunded {m(refunded)}</span>
        ) : (
          <span className="badge healthy">Stands</span>
        )
      }
    >
      <div className="stack">
        <dl className="kv" style={{ margin: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          <div>
            <dt>Total</dt>
            <dd className="num">{m(s.total)}</dd>
          </div>
          <div>
            <dt>Paid by</dt>
            <dd>
              {PAID[s.paymentType] ?? s.paymentType}
              <div className="small muted num">
                {[s.cashAmount && `cash handed over ${m(s.cashAmount)}`, s.momoAmount && `MoMo ${m(s.momoAmount)}`, s.creditAmount && `account ${m(s.creditAmount)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </dd>
          </div>
          {s.momoRef && (
            <div>
              <dt>MoMo reference</dt>
              <dd className="mono">
                {s.momoRef}
                {s.momoNetwork && <div className="small muted">{s.momoNetwork}</div>}
              </dd>
            </div>
          )}
          {s.discount > 0 && (
            <div>
              <dt>Discount</dt>
              <dd className="num">{m(s.discount)}</dd>
            </div>
          )}
          <div>
            <dt>Cashier</dt>
            <dd>{s.cashier ?? '—'}</dd>
          </div>
          <div>
            <dt>Drawer</dt>
            <dd>
              {s.drawer ? (
                <>
                  {s.drawer.closedAt ? `Closed ${date(s.drawer.closedAt)}` : 'Still open'}
                  <div className="small muted">
                    Opened {date(s.drawer.openedAt)}
                    {s.drawer.cashier ? ` by ${s.drawer.cashier}` : ''}
                  </div>
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Till</dt>
            <dd>
              {s.till ? <a href={tillHref(s.till.deviceId)}>{s.till.name ?? s.terminalCode}</a> : (s.terminalCode ?? '—')}
              {s.till?.syncPending ? <div className="small muted">{s.till.syncPending} still to send</div> : null}
            </dd>
          </div>
          <div>
            <dt>Reached the cloud</dt>
            <dd>{s.receivedAt ? <When iso={s.receivedAt} /> : <span className="muted">Rung here, not on a till</span>}</dd>
          </div>
        </dl>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">Qty</th>
                <th className="r">Price</th>
                <th className="r">Line</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.name}
                    {l.options && <div className="small muted">{l.options}</div>}
                  </td>
                  <td className="r num">{qty(l)}</td>
                  <td className="r num">{m(l.unitPrice)}</td>
                  <td className="r num">
                    {m(l.lineTotal)}
                    {l.discount > 0 && <div className="small muted">−{m(l.discount)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.voided && (
          <div className="notice" role="note">
            Voided <When iso={s.voided.at} />
            {s.voided.by ? ` by ${s.voided.by}` : ''}
            {s.voided.reason ? ` — “${s.voided.reason}”` : ''}
          </div>
        )}
        {s.returns.map((r, i) => (
          <div key={i} className="notice" role="note">
            Refunded {m(r.refundTotal)} ({PAID[r.method] ?? r.method}) <When iso={r.at} />
            {r.reason ? ` — “${r.reason}”` : ''}
          </div>
        ))}
      </div>
    </Card>
  )
}

function NotFound({ tills, shopChosen }: { tills: TillHint[] | null; shopChosen: boolean }) {
  if (!shopChosen) {
    return (
      <Card>
        <Empty title="No sale in the cloud matches">Choose the shop to see what each of its tills has sent — it may still be on the till.</Empty>
      </Card>
    )
  }
  return (
    <Card
      title="Not in the cloud yet"
      sub="The cloud only has what the tills have sent. If the receipt is newer than the last one here, it is most likely still on the till."
      flush
    >
      {!tills || tills.length === 0 ? (
        <Empty title="This shop has no tills connected" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Till</th>
                <th>Newest receipt here</th>
                <th className="r">Waiting to send</th>
                <th>Last sent</th>
                <th>Last check-in</th>
              </tr>
            </thead>
            <tbody>
              {tills.map((t) => (
                <tr key={t.deviceId}>
                  <td>
                    <a href={tillHref(t.deviceId)}>{t.name ?? t.terminalCode}</a> <span className="mono small muted">{t.terminalCode}</span>
                    {t.removed && <div className="small muted">Removed</div>}
                  </td>
                  <td className="mono">
                    {t.highestReceipt != null ? `#${String(t.highestReceipt).padStart(4, '0')}` : 'None yet'}
                    {t.highestReceiptAt && <div className="small muted">{date(t.highestReceiptAt)}</div>}
                  </td>
                  <td className="r num">
                    {t.syncPending ?? '—'}
                    {t.syncFailed ? <div className="small warn">{t.syncFailed} failed</div> : null}
                  </td>
                  <td className="sub">
                    <When iso={t.lastSyncAt} />
                  </td>
                  <td className="sub">
                    <When iso={t.lastReportAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
