/**
 * The faults that are not outages.
 *
 * Everything else in this console watches whether a terminal is WORKING. None of
 * it can see the other kind of trouble: a shop whose books have quietly stopped
 * making sense. Stock counted into the negative, a shift left open for three
 * days so the drawer was never counted, a shelf of expired goods still on sale,
 * a price typed in below cost. Every terminal involved is perfectly healthy, and
 * every figure the shop relies on is wrong.
 *
 * Beside it, the sync tail: the overview strip reports a p95 lag, which is the
 * right number for "is the fleet healthy" and useless for "who do I ring".
 */
import { useEffect, useState } from 'react'
import type { Api, ShopQuality, SyncPressureRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Button, Card, Chip, Empty, Notice, TableSkeleton } from '../components/ui.tsx'
import { duration, exact, timeAgo } from '../lib/format.ts'

export function Quality({
  api,
  reloadKey,
  onNavigate,
}: {
  api: Api
  reloadKey: number
  onNavigate: Navigate
}) {
  const [shops, setShops] = useState<ShopQuality[] | null>(null)
  const [queues, setQueues] = useState<SyncPressureRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([api.quality(), api.syncPressure()])
      .then(([q, s]) => {
        setShops(q)
        setQueues(s)
        setError(null)
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not run the checks'),
      )
  }, [api, reloadKey])

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Books & queues</h1>
          <p className="view-sub">
            Shops whose figures have stopped adding up, and the terminals carrying the sync backlog.
            Neither shows as an unhealthy till.
          </p>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      <Card title={shops?.length ? `Shops with something wrong (${shops.length})` : 'Books'}>
        {shops == null ? (
          <TableSkeleton rows={4} />
        ) : shops.length === 0 ? (
          <Empty icon="check" title="Every shop's figures add up">
            No negative stock, no expired lots on sale, no shift left open overnight, nothing priced
            below what it cost.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th className="col-num">Oversold</th>
                  <th className="col-num">Expired on sale</th>
                  <th className="col-num">Shifts left open</th>
                  <th className="col-num">Priced under cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr
                    key={s.shopId}
                    data-clickable="true"
                    onClick={() => onNavigate('shop', { id: s.shopId })}
                  >
                    <td>
                      <span className="strong">{s.shopName}</span>
                      <div className="row-sub">{s.issues} issue{s.issues === 1 ? '' : 's'}</div>
                    </td>
                    <td className="col-num">
                      {s.oversold > 0 ? (
                        <Chip tone="bad">{s.oversold}</Chip>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="col-num">
                      {s.expiredLots > 0 ? (
                        <>
                          <Chip tone="warn">{s.expiredLots}</Chip>
                          <div className="row-sub">{s.expiredUnits} units</div>
                        </>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="col-num">
                      {s.staleShifts > 0 ? (
                        <>
                          <Chip tone="warn">{s.staleShifts}</Chip>
                          {s.oldestShiftHours != null && (
                            <div className="row-sub">oldest {s.oldestShiftHours}h</div>
                          )}
                        </>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="col-num">
                      {s.losingMoney > 0 ? (
                        <Chip tone="warn">{s.losingMoney}</Chip>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td style={{ width: 1 }}>
                      <Button size="sm" variant="ghost" onClick={() => onNavigate('shop', { id: s.shopId })}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Read-only: this reports what is wrong so somebody can telephone. Nothing here changes a
          shop's own data.
        </p>
      </Card>

      <Card title={queues?.length ? `Terminals with a queue (${queues.length})` : 'Queues'}>
        {queues == null ? (
          <TableSkeleton rows={3} />
        ) : queues.length === 0 ? (
          <Empty icon="check" title="Nothing is queued anywhere">
            Every terminal has shipped what it owes and received what it was sent.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th className="col-num">Failed</th>
                  <th className="col-num">Queued</th>
                  <th className="col-num">Oldest</th>
                  <th className="col-num">Rejected inbound</th>
                  <th className="col-num">Last received</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr
                    key={q.deviceId}
                    data-clickable="true"
                    onClick={() => onNavigate('device', { id: q.deviceId })}
                  >
                    <td>
                      <span className="strong">{q.shopName ?? 'Unclaimed terminal'}</span>
                      <div className="row-sub mono">{q.deviceId.slice(0, 12)}</div>
                    </td>
                    <td className="col-num">
                      {(q.syncFailed ?? 0) > 0 ? (
                        <Chip tone="bad">{q.syncFailed}</Chip>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="col-num muted">{q.syncPending ?? 0}</td>
                    <td className="col-num muted">
                      {q.oldestPendingAgeMs != null ? duration(q.oldestPendingAgeMs) : '—'}
                    </td>
                    <td className="col-num">
                      {(q.pullQuarantined ?? 0) > 0 ? (
                        <Chip tone="warn">{q.pullQuarantined}</Chip>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td className="col-num muted" title={exact(q.lastPulledAt)}>
                      {q.lastPulledAt ? timeAgo(q.lastPulledAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Ordered by failures first, then by how long the oldest row has been waiting: a hundred
          rows written this minute is a busy till, three rows stuck since yesterday is a broken one.
        </p>
      </Card>
    </>
  )
}
