import { useState, type FormEvent } from 'react'
import * as api from '../api/endpoints.ts'
import type { FleetState, Rollout, RolloutState, RolloutTargetState } from '../api/types.ts'
import { ActionError, ConfirmButton, Dialog, Field } from '../components/forms.tsx'
import { Card, Empty, Live, Loadable, PageHeader, When } from '../components/ui.tsx'
import { useApi, useOverview, useShops } from '../data.ts'
import { count, date, plural } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { href, tillHref, updateHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const STATE: Record<RolloutState, { label: string; tone: string }> = {
  canary: { label: 'Trying on a few', tone: 'attention' },
  rolling: { label: 'Rolling out', tone: 'attention' },
  complete: { label: 'Finished', tone: 'healthy' },
  halted: { label: 'Stopped', tone: 'offline' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const TARGET: Record<RolloutTargetState, string> = {
  pending: 'Waiting',
  issued: 'Sent',
  updated: 'Updated',
  failed: 'Failed',
  skipped: 'Skipped',
  reverted: 'Rolled back',
}

/**
 * Updates go out in stages: a small "canary" share of tills first, watched
 * for new faults, then everyone else. The server runs the waves; this page
 * starts one, shows where it is, and holds the brakes.
 */
export function Updates() {
  const { canAct } = useSession()
  const list = useApi('rollouts', (c, s) => api.rollouts(c, s), { every: 30_000 })
  const overview = useOverview()
  const [starting, setStarting] = useState(false)
  const release = overview.data?.release

  return (
    <div className="stack">
      <PageHeader
        title="Updates"
        sub="Send a new SmartSort version to tills, a few at a time."
        actions={
          <>
            <Live updatedAt={list.updatedAt} busy={list.refreshing} />
            {canAct && (
              <button className="btn primary sm" disabled={!!list.data?.active} onClick={() => setStarting(true)}>
                Start an update
              </button>
            )}
          </>
        }
      />
      {release && (
        <Card>
          <div className="spread">
            <div>
              <div className="small sub">Latest published</div>
              <div style={{ fontWeight: 600, fontSize: 18 }} className="mono">
                {release.latestVersion ?? 'None'}
              </div>
              {release.releasedAt && <div className="small muted">Released {date(release.releasedAt)}</div>}
            </div>
            <div className="row" style={{ gap: 16 }}>
              {(overview.data?.versions ?? []).slice(0, 5).map((v) => (
                <div key={v.version}>
                  <div className="mono small">{v.version}</div>
                  <div className="small muted">{plural(v.count, 'till')}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
      <Card flush>
        <Loadable q={list} rows={5}>
          {(data) =>
            data.rollouts.length === 0 ? (
              <Empty title="No updates sent yet" />
            ) : (
              <ul className="list">
                {data.rollouts.map((r) => (
                  <li key={r.id}>
                    <a className="item" href={updateHref(r.id)}>
                      <RolloutSummary r={r} />
                    </a>
                  </li>
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>
      {canAct && (
        <StartUpdate
          open={starting}
          onClose={() => setStarting(false)}
          versions={release?.rollableVersions ?? []}
          latest={release?.latestVersion ?? null}
        />
      )}
    </div>
  )
}

function RolloutSummary({ r }: { r: Rollout }) {
  const p = r.progress
  const done = p.updated + p.failed + p.skipped + p.reverted
  return (
    <>
      <div className="spread">
        <span className="row" style={{ gap: 8 }}>
          <span className="mono" style={{ fontWeight: 600 }}>
            {r.version}
          </span>
          <span className={`badge ${STATE[r.state].tone}`}>{STATE[r.state].label}</span>
        </span>
        <span className="small muted">
          <When iso={r.createdAt} /> {r.createdByLabel && `· ${r.createdByLabel}`}
        </span>
      </div>
      <div className="meter" style={{ margin: '8px 0 4px' }}>
        <span style={{ width: `${p.total ? (done / p.total) * 100 : 0}%` }} />
      </div>
      <div className="small sub">
        {count(p.updated)} of {count(p.total)} updated
        {p.failed > 0 && ` · ${count(p.failed)} failed`}
        {p.reverted > 0 && ` · ${count(p.reverted)} rolled back`}
        {r.targetLabel && ` · ${r.targetLabel}`}
      </div>
      {r.haltReason && <div className="small" style={{ color: 'var(--bad)' }}>Stopped: {r.haltReason}</div>}
    </>
  )
}

const VERSION = /^\d+\.\d+\.\d+$/

function StartUpdate({
  open,
  onClose,
  versions,
  latest,
}: {
  open: boolean
  onClose: () => void
  versions: string[]
  latest: string | null
}) {
  const { client } = useSession()
  const shops = useShops()
  const [picked, setVersion] = useState('')
  // The list loads after this mounts; until someone picks, follow it.
  const version = versions.includes(picked) ? picked : latest && versions.includes(latest) ? latest : (versions[0] ?? '')
  const [shopId, setShopId] = useState('')
  const [state, setState] = useState<FleetState | 'all'>('all')
  const [canary, setCanary] = useState(10)
  const [halt, setHalt] = useState(2)
  const [observe, setObserve] = useState(30)
  const [note, setNote] = useState('')
  const [made, setMade] = useState<string | null>(null)

  const start = useAction(async () => {
    if (!versions.includes(version) || !VERSION.test(version)) throw new Error('Pick one of the published versions.')
    const all = await api.allDevices(client, { shopId: shopId || undefined, state })
    // Tills on the shared enrollment key never take commands.
    const eligible = all.filter((d) => d.keyVerified && d.appVersion !== version)
    if (eligible.length === 0) throw new Error('No tills in that selection can take this update.')
    const shopName = shops.data?.find((s) => s.id === shopId)?.name
    const r = await api.createRollout(client, {
      version: version.trim(),
      deviceIds: eligible.map((d) => d.deviceId),
      targetLabel: shopName ? shopName : state === 'all' ? 'Every till' : `${state} tills`,
      note: note.trim() || null,
      canaryPercent: canary,
      haltErrorDevices: halt,
      observeMinutes: observe,
    })
    invalidate('rollouts')
    setMade(r.id)
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void start.run()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Start an update">
      {made ? (
        <div className="stack">
          <p>The first tills will get it the next time they check in.</p>
          <div className="form-actions">
            <a className="btn primary" href={updateHref(made)} onClick={onClose}>
              Watch it
            </a>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="Version" id="rv" hint="Only versions with a signed update package can be sent.">
            {/* Never free text: the server takes any string, and a typo becomes
                a command every till silently refuses. */}
            <select id="rv" className="select" value={version} disabled={!versions.length} onChange={(e) => setVersion(e.target.value)}>
              {!versions.length && <option value="">No signed versions published</option>}
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {v === latest ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          </Field>
          {!versions.length && (
            <div className="notice warn">
              The update feed has no signed package, so there is nothing a till could install. Publish a release first.
            </div>
          )}
          <div className="form-grid">
            <Field label="Which tills" id="rs">
              <select id="rs" className="select" value={shopId} onChange={(e) => setShopId(e.target.value)}>
                <option value="">Every shop</option>
                {(shops.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status" id="rst">
              <select id="rst" className="select" value={state} onChange={(e) => setState(e.target.value as FleetState | 'all')}>
                <option value="all">Any</option>
                <option value="healthy">Working only</option>
                <option value="attention">Needing a look only</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Try first on (%)" id="rc">
              <input id="rc" className="input" type="number" min={1} max={100} value={canary} onChange={(e) => setCanary(Number(e.target.value))} />
            </Field>
            <Field label="Stop if this many get new faults" id="rh">
              <input id="rh" className="input" type="number" min={1} value={halt} onChange={(e) => setHalt(Number(e.target.value))} />
            </Field>
            <Field label="Watch for (minutes)" id="ro">
              <input id="ro" className="input" type="number" min={5} value={observe} onChange={(e) => setObserve(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Note (optional)" id="rn">
            <input id="rn" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's in it" />
          </Field>
          <div className="notice info">
            {canary}% of the selected tills get it first. If {plural(halt, 'till')} report new problems within {observe} minutes, the
            update stops itself. Otherwise you promote it to the rest.
          </div>
          <ActionError error={start.error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={start.pending || !versions.length}>
              {start.pending ? 'Starting…' : 'Start'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

export function Update({ id }: { id: string }) {
  const { client, canAct } = useSession()
  const r = useApi(`rollouts:${id}`, (c, s) => api.rollout(c, id, s), { every: 15_000 })
  const act = useAction(async (what: 'promote' | 'halt' | 'rollback') => {
    if (what === 'promote') await api.promoteRollout(client, id)
    if (what === 'halt') await api.haltRollout(client, id)
    if (what === 'rollback') await api.rollbackRollout(client, id)
    invalidate('rollouts')
  })

  return (
    <div className="stack">
      <PageHeader title="Update" back={{ href: href('/updates'), label: 'Updates' }} />
      <Loadable q={r} rows={6}>
        {(d) => {
          const live = d.state === 'canary' || d.state === 'rolling'
          return (
            <>
              <Card
                actions={
                  canAct && (
                    <>
                      {d.state === 'canary' && (
                        <button className="btn sm primary" disabled={act.pending} onClick={() => void act.run('promote')}>
                          Send to the rest
                        </button>
                      )}
                      {live && (
                        <ConfirmButton danger disabled={act.pending} confirm="Stop it" onConfirm={() => void act.run('halt')}>
                          Stop
                        </ConfirmButton>
                      )}
                      {(d.state === 'halted' || d.state === 'complete') && d.progress.updated > 0 && (
                        <ConfirmButton
                          danger
                          disabled={act.pending}
                          confirm={`Roll back ${d.progress.updated}`}
                          onConfirm={() => void act.run('rollback')}
                        >
                          Roll back
                        </ConfirmButton>
                      )}
                    </>
                  )
                }
                title={
                  <span className="row" style={{ gap: 8 }}>
                    <span className="mono">{d.version}</span>
                    <span className={`badge ${STATE[d.state].tone}`}>{STATE[d.state].label}</span>
                  </span>
                }
              >
                <div className="stack" style={{ gap: 10 }}>
                  <RolloutSummary r={d} />
                  {d.note && <div className="sub">{d.note}</div>}
                  <div className="small muted">
                    First {d.canaryPercent}% ({count(d.progress.canaryUpdated)} of {count(d.progress.canaryTotal)} updated) · stops
                    if {plural(d.haltErrorDevices, 'till')} get new faults · watched {d.observeMinutes} min
                  </div>
                  <ActionError error={act.error} />
                </div>
              </Card>
              <Card title="Tills" flush>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Till</th>
                        <th>Shop</th>
                        <th>Wave</th>
                        <th>From</th>
                        <th>State</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.targets.map((t) => (
                        <tr key={t.id}>
                          <td className="primary-cell">
                            <a href={tillHref(t.deviceId)} className="mono">
                              {t.deviceId.slice(0, 12)}
                            </a>
                          </td>
                          <td className="sub">{t.shopName ?? '—'}</td>
                          <td>{t.wave === 0 ? 'First' : 'Rest'}</td>
                          <td className="mono">{t.fromVersion ?? '—'}</td>
                          <td>
                            <span
                              className={`badge ${t.state === 'updated' ? 'healthy' : t.state === 'failed' ? 'offline' : t.state === 'pending' ? 'neutral' : 'attention'}`}
                            >
                              {TARGET[t.state]}
                            </span>
                            {t.note && <div className="small muted">{t.note}</div>}
                          </td>
                          <td className="sub">
                            <When iso={t.confirmedAt ?? t.issuedAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )
        }}
      </Loadable>
    </div>
  )
}
