/**
 * Rollouts, as things with a life rather than as a button that was pressed.
 *
 * The old flow ended at "queued for 41 terminals" — after which the only way to
 * know what had happened was to stare at the Version column and count. A staged
 * rollout has a state worth a page: which wave is out, how many took it, what
 * the canary did, and the two buttons that matter when it goes wrong (halt, and
 * put everyone back).
 *
 * The page deliberately shows the halt policy in plain words. An operator
 * pressing "Roll out" is entitled to know exactly what the machine will do at
 * 2am without them.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Api, RolloutDetail, RolloutRow, RolloutState } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import { Button, Card, Chip, Empty, Notice, TableSkeleton, type Tone } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

const STATE_TONE: Record<RolloutState, Tone> = {
  canary: 'warn',
  rolling: 'warn',
  complete: 'ok',
  halted: 'bad',
  cancelled: 'idle',
}

const STATE_LABEL: Record<RolloutState, string> = {
  canary: 'Canary running',
  rolling: 'Rolling out',
  complete: 'Complete',
  halted: 'Halted',
  cancelled: 'Cancelled',
}

export function Rollouts({
  api,
  reloadKey,
  onNavigate,
}: {
  api: Api
  reloadKey: number
  onNavigate: Navigate
}) {
  const [rows, setRows] = useState<RolloutRow[] | null>(null)
  const [open, setOpen] = useState<RolloutDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const canAct = api.operator.role !== 'viewer'

  const load = useCallback(async () => {
    try {
      const { rollouts } = await api.rollouts()
      setRows(rollouts)
      setError(null)
      // Keep the expanded one fresh: this page is watched during a rollout, and
      // a stale target list is exactly what it must not show.
      setOpen((cur) => (cur ? cur : cur))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the fleet server')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!open) return
    void api
      .rollout(open.id)
      .then(setOpen)
      .catch(() => undefined)
    // Refreshed on the shell's poll, keyed by which rollout is expanded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, open?.id])

  async function act(id: string, what: 'promote' | 'halt' | 'rollback') {
    setBusy(`${id}:${what}`)
    setError(null)
    try {
      if (what === 'promote') await api.promoteRollout(id)
      else if (what === 'halt') await api.haltRollout(id)
      else await api.rollbackRollout(id)
      await load()
      if (open?.id === id) setOpen(await api.rollout(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Rollouts</h1>
          <p className="view-sub">
            A build goes to a few terminals first. If those stay quiet it goes to the rest; if they
            do not, it stops itself and says so.
          </p>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {rows == null ? (
        <section className="panel">
          <TableSkeleton rows={3} />
        </section>
      ) : rows.length === 0 ? (
        <section className="panel" style={{ padding: 16 }}>
          <Empty icon="rocket" title="No rollouts yet">
            Start one from the Terminals page: filter to the terminals you want, then “Roll out
            update”. Everything about it — waves, progress, the halt — appears here.
          </Empty>
        </section>
      ) : (
        rows.map((r) => (
          <Card
            key={r.id}
            title={
              <span className="cell-stack">
                <span className="mono">{r.version}</span>
                <Chip tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Chip>
              </span>
            }
          >
            <div className="cell-stack" style={{ marginBottom: 10 }}>
              <span className="muted small">
                {r.targetLabel ?? 'Selected terminals'} · started{' '}
                <span title={exact(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                {r.createdByLabel ? ` by ${r.createdByLabel}` : ''}
              </span>
            </div>

            {r.note && <p className="small">{r.note}</p>}

            <Progress row={r} />

            {r.state === 'halted' && r.haltReason && (
              <Notice>
                Halted {timeAgo(r.haltedAt)} — {r.haltReason}
              </Notice>
            )}

            {/* The policy, in words, on the row it governs. Nobody should have
                to remember what "2 / 30m" meant when they set it up. */}
            <p className="hint" style={{ marginTop: 8 }}>
              Canary {r.canaryPercent}% · stops itself if <b>{r.haltErrorDevices}</b> updated
              terminals report new faults or go silent · watches for {r.observeMinutes} minutes
              before the rest.
            </p>

            <div className="toolbar" style={{ gap: 8, marginTop: 10 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  open?.id === r.id ? setOpen(null) : void api.rollout(r.id).then(setOpen)
                }
              >
                {open?.id === r.id ? 'Hide terminals' : `Show ${r.progress.total} terminals`}
              </Button>
              {canAct && r.state === 'canary' && (
                <Button size="sm" busy={busy === `${r.id}:promote`} onClick={() => void act(r.id, 'promote')}>
                  Promote to the rest
                </Button>
              )}
              {canAct && (r.state === 'canary' || r.state === 'rolling') && (
                <Button
                  size="sm"
                  variant="ghost"
                  busy={busy === `${r.id}:halt`}
                  onClick={() => void act(r.id, 'halt')}
                >
                  Halt
                </Button>
              )}
              {canAct && r.progress.updated > 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  busy={busy === `${r.id}:rollback`}
                  onClick={() => void act(r.id, 'rollback')}
                >
                  Put {r.progress.updated} back
                </Button>
              )}
            </div>

            {open?.id === r.id && (
              <div className="rollout-grid" style={{ marginTop: 12 }}>
                {open.targets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="rollout-target"
                    onClick={() => onNavigate('device', { id: t.deviceId })}
                  >
                    <div className="cell-stack">
                      {t.wave === 0 && <Chip tone="idle">canary</Chip>}
                      <span className="strong">{t.shopName ?? 'Unclaimed'}</span>
                    </div>
                    <div className="row-sub mono">{t.deviceId.slice(0, 12)}</div>
                    <div className="row-sub">
                      {t.state === 'updated' ? (
                        <span className="ok-text">
                          Took it {t.confirmedAt ? timeAgo(t.confirmedAt) : ''}
                        </span>
                      ) : t.state === 'failed' ? (
                        <span className="bad-text">{t.note ?? 'Failed'}</span>
                      ) : t.state === 'issued' ? (
                        'Waiting for its next check-in'
                      ) : t.state === 'reverted' ? (
                        'Put back'
                      ) : t.state === 'skipped' ? (
                        'Skipped'
                      ) : (
                        'Queued'
                      )}
                    </div>
                    {t.fromVersion && t.state === 'updated' && (
                      <div className="row-sub mono">was {t.fromVersion}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        ))
      )}
    </>
  )
}

/**
 * One bar for the whole rollout: taken, in flight, failed. The canary's own
 * count sits beside it, because during the first wave that is the only number
 * anybody is actually watching.
 */
function Progress({ row }: { row: RolloutRow }) {
  const p = row.progress
  const pct = (n: number) => (p.total > 0 ? (n / p.total) * 100 : 0)

  return (
    <>
      <div className="wave-bar" role="img" aria-label={`${p.updated} of ${p.total} terminals updated`}>
        <span className="wave-seg" data-kind="updated" style={{ width: `${pct(p.updated)}%` }} />
        <span className="wave-seg" data-kind="issued" style={{ width: `${pct(p.issued + p.pending)}%` }} />
        <span className="wave-seg" data-kind="failed" style={{ width: `${pct(p.failed)}%` }} />
      </div>
      <div className="chart-legend">
        <span>
          <b>{p.updated}</b> of {p.total} on {row.version}
        </span>
        {p.issued + p.pending > 0 && <span>{p.issued + p.pending} still to collect it</span>}
        {p.failed > 0 && <span className="bad-text">{p.failed} failed</span>}
        {p.skipped > 0 && <span>{p.skipped} skipped</span>}
        {p.reverted > 0 && <span>{p.reverted} put back</span>}
        {row.state === 'canary' && (
          <span>
            <Icon name="rocket" size={12} /> canary {p.canaryUpdated}/{p.canaryTotal}
          </span>
        )}
      </div>
    </>
  )
}
