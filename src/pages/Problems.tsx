import { useEffect, useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { GroupStatus } from '../api/types.ts'
import { ActionError, ConfirmButton, Dialog } from '../components/forms.tsx'
import { SavedViews } from '../components/SavedViews.tsx'
import { saveCsv } from '../lib/csv.ts'
import { pool } from '../lib/pool.ts'
import type { ErrorGroup } from '../api/types.ts'
import { Card, Empty, Live, Loadable, PageHeader, Search, Segmented, When } from '../components/ui.tsx'
import { useApi, useShopIndex } from '../data.ts'
import { count, date, plural } from '../lib/format.ts'
import { invalidate, useAction, useDebounced } from '../lib/query.ts'
import { href, problemHref, shopHref, tillHref, useSetParams } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const PAGE = 50
const STATUSES = ['open', 'resolved', 'ignored', 'all'] as const
type Tab = (typeof STATUSES)[number]

const STATUS_LABEL: Record<GroupStatus, string> = { open: 'Open', resolved: 'Fixed', ignored: 'Ignored' }

/**
 * App problems: every distinct error the tills have reported, folded into one
 * row per kind (a fingerprint) with how many tills see it. Marking one fixed
 * clears it from every till it was holding amber.
 */
export function Problems({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const raw = params.get('status') ?? 'open'
  const status: Tab = (STATUSES as readonly string[]).includes(raw) ? (raw as Tab) : 'open'
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0)
  const [text, setText] = useState(params.get('q') ?? '')
  const q = useDebounced(text.trim())
  useEffect(() => {
    if (q !== (params.get('q') ?? '')) setParams({ q, page: null })
  }, [q, params, setParams])

  const groups = useApi(
    `errors:groups:${status}:${q}:${page}`,
    (c, s) => api.errorGroups(c, { status, q: q || undefined, limit: PAGE, offset: page * PAGE }, s),
    { every: 60_000 },
  )

  const { client } = useSession()
  const exportCsv = useAction(async () => {
    const all = await api.allErrorGroups(client, { status, q: q || undefined })
    saveCsv<ErrorGroup>('app-problems', all, [
      { header: 'Problem', value: (g) => g.message },
      { header: 'Source', value: (g) => g.source },
      { header: 'Status', value: (g) => STATUS_LABEL[g.status] },
      { header: 'Tills', value: (g) => g.deviceCount },
      { header: 'Times', value: (g) => g.totalCount },
      { header: 'First version', value: (g) => g.firstVersion },
      { header: 'Last version', value: (g) => g.lastVersion },
      { header: 'First seen', value: (g) => g.firstSeen },
      { header: 'Last seen', value: (g) => g.lastSeen },
      { header: 'Fingerprint', value: (g) => g.fingerprint },
    ])
  })

  return (
    <div className="stack">
      <PageHeader
        title="App problems"
        sub="Errors the tills have reported, one row per kind of problem."
        actions={
          <>
            <Live updatedAt={groups.updatedAt} busy={groups.refreshing} />
            <button className="btn sm" disabled={exportCsv.pending} onClick={() => void exportCsv.run()}>
              Download CSV
            </button>
            {status === 'open' && <BulkProblems q={q} total={groups.data?.total ?? 0} />}
          </>
        }
      />
      <ActionError error={exportCsv.error} />
      <div className="spread">
        <Segmented
          label="Problem status"
          value={status}
          onChange={(v) => setParams({ status: v === 'open' ? null : v, page: null })}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Fixed' },
            { value: 'ignored', label: 'Ignored' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Search value={text} onChange={setText} placeholder="Search the error message" />
      </div>
      <SavedViews page="/problems" />
      <Card flush>
        <Loadable q={groups} rows={8}>
          {(p) =>
            p.groups.length === 0 ? (
              <Empty title={status === 'open' && !q ? 'No open app problems' : 'Nothing matches'} />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Problem</th>
                        <th className="r">Tills</th>
                        <th className="r">Times</th>
                        <th>Versions</th>
                        <th>Last seen</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.groups.map((g) => (
                        <tr key={g.id} className="link" onClick={() => (location.hash = problemHref(g.fingerprint))}>
                          <td className="primary-cell" style={{ maxWidth: 520 }}>
                            <a href={problemHref(g.fingerprint)} style={{ overflowWrap: 'anywhere' }}>
                              {g.message}
                            </a>
                            <div className="small muted">
                              {g.source ?? 'unknown source'} · first seen {date(g.firstSeen)}
                              {g.regressedAt && <span style={{ color: 'var(--bad)' }}> · came back after a fix</span>}
                            </div>
                          </td>
                          <td className="r num">{count(g.deviceCount)}</td>
                          <td className="r num">{count(g.totalCount)}</td>
                          <td className="mono nowrap">
                            {g.firstVersion === g.lastVersion ? (g.lastVersion ?? '—') : `${g.firstVersion ?? '?'} → ${g.lastVersion ?? '?'}`}
                          </td>
                          <td className="sub">
                            <When iso={g.lastSeen} />
                          </td>
                          <td>
                            <span className={`badge ${g.status === 'open' ? 'attention' : 'neutral'}`}>{STATUS_LABEL[g.status]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pager">
                  <span className="num">
                    {count(p.offset + 1)}–{count(p.offset + p.groups.length)} of {count(p.total)}
                  </span>
                  <span className="row">
                    <button className="btn sm" disabled={page === 0} onClick={() => setParams({ page: page - 1 || null })}>
                      Previous
                    </button>
                    <button
                      className="btn sm"
                      disabled={p.offset + p.groups.length >= p.total}
                      onClick={() => setParams({ page: page + 1 })}
                    >
                      Next
                    </button>
                  </span>
                </div>
              </>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}

export function Problem({ fingerprint }: { fingerprint: string }) {
  const { client, canAct } = useSession()
  const shops = useShopIndex()
  const group = useApi(`errors:group:${fingerprint}`, (c, s) => api.errorGroup(c, fingerprint, s))
  const devices = useApi(`errors:devices:${fingerprint}`, (c, s) => api.groupDevices(c, fingerprint, s))
  const [version, setVersion] = useState('')
  const set = useAction(async (status: GroupStatus, inVersion?: string) => {
    await api.setGroupStatus(client, fingerprint, status, inVersion?.trim() || null)
    invalidate('errors')
    invalidate('device')
    invalidate('devices')
    invalidate('overview')
  })

  return (
    <div className="stack">
      <PageHeader title="App problem" back={{ href: href('/problems'), label: 'App problems' }} />
      <Loadable q={group} rows={4}>
        {(g) => (
          <>
            <Card
              title={<span style={{ overflowWrap: 'anywhere' }}>{g.message}</span>}
              sub={`${g.source ?? 'Unknown source'} · ${plural(g.totalCount, 'time')} on ${plural(g.deviceCount, 'till')}`}
              actions={<span className={`badge ${g.status === 'open' ? 'attention' : 'neutral'}`}>{STATUS_LABEL[g.status]}</span>}
            >
              <div className="stack" style={{ gap: 12 }}>
                <dl className="kv" style={{ margin: '-16px -16px 0' }}>
                  <div>
                    <dt>First seen</dt>
                    <dd>
                      <When iso={g.firstSeen} />
                      <div className="small muted mono">{g.firstVersion ?? '—'}</div>
                    </dd>
                  </div>
                  <div>
                    <dt>Last seen</dt>
                    <dd>
                      <When iso={g.lastSeen} />
                      <div className="small muted mono">{g.lastVersion ?? '—'}</div>
                    </dd>
                  </div>
                  {g.resolvedAt && (
                    <div>
                      <dt>Marked fixed</dt>
                      <dd>
                        <When iso={g.resolvedAt} />
                        <div className="small muted">
                          {g.resolvedByLabel ?? ''}
                          {g.resolvedInVersion && ` · in ${g.resolvedInVersion}`}
                        </div>
                      </dd>
                    </div>
                  )}
                  {g.regressedAt && (
                    <div>
                      <dt>Came back</dt>
                      <dd className="bad">
                        <When iso={g.regressedAt} />
                      </dd>
                    </div>
                  )}
                </dl>
                {g.stack && <pre className="stack">{g.stack}</pre>}
                {canAct && (
                  <div className="row">
                    {g.status !== 'resolved' && (
                      <>
                        <input
                          className="input"
                          style={{ width: 160 }}
                          placeholder="Fixed in version"
                          aria-label="Fixed in version (optional)"
                          value={version}
                          onChange={(e) => setVersion(e.target.value)}
                        />
                        <button className="btn sm primary" disabled={set.pending} onClick={() => void set.run('resolved', version)}>
                          Mark fixed
                        </button>
                      </>
                    )}
                    {g.status !== 'ignored' && (
                      <ConfirmButton disabled={set.pending} confirm="Ignore it" onConfirm={() => void set.run('ignored')}>
                        Ignore
                      </ConfirmButton>
                    )}
                    {g.status !== 'open' && (
                      <button className="btn sm" disabled={set.pending} onClick={() => void set.run('open')}>
                        Reopen
                      </button>
                    )}
                  </div>
                )}
                <ActionError error={set.error} />
              </div>
            </Card>
            <Card title="Tills that hit it" flush>
              <Loadable q={devices} rows={3}>
                {(list) =>
                  list.length === 0 ? (
                    <Empty title="No tills on record" />
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Till</th>
                            <th>Shop</th>
                            <th className="r">Times</th>
                            <th>Version</th>
                            <th>Last seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((d) => (
                            <tr key={d.deviceId}>
                              <td className="primary-cell">
                                <a href={tillHref(d.deviceId)} className="mono">
                                  {d.deviceId.slice(0, 12)}
                                </a>
                              </td>
                              <td>
                                {d.shopId ? (
                                  <a href={shopHref(d.shopId)} className="sub">
                                    {shops.get(d.shopId)?.name ?? 'Shop'}
                                  </a>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td className="r num">{count(d.count)}</td>
                              <td className="mono">{d.appVersion ?? '—'}</td>
                              <td className="sub">
                                <When iso={d.lastSeen} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                }
              </Loadable>
            </Card>
          </>
        )}
      </Loadable>
    </div>
  )
}

/** Mark every open problem matching the search fixed or ignored — all pages. */
function BulkProblems({ q, total }: { q: string; total: number }) {
  const { client, canAct } = useSession()
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const run = useAction(async (status: GroupStatus) => {
    const all = await api.allErrorGroups(client, { status: 'open', q: q || undefined })
    const r = await pool(
      all,
      5,
      (g) => api.setGroupStatus(client, g.fingerprint, status, status === 'resolved' ? version.trim() || null : null),
      (n) => setProgress(`${n} of ${all.length}`),
    )
    invalidate('errors')
    invalidate('device')
    invalidate('overview')
    setProgress(`Done for ${r.ok.length}.${r.failed.length ? ` ${r.failed.length} failed: ${r.failed[0]!.error}` : ''}`)
  })
  if (!canAct) return null
  return (
    <>
      <button className="btn sm" disabled={total === 0} onClick={() => setOpen(true)}>
        Act on {plural(total, 'problem')}
      </button>
      <Dialog
        open={open}
        onClose={() => {
          if (run.pending) return
          setOpen(false)
          setProgress(null)
        }}
        title={`All ${plural(total, 'open problem')}${q ? ` matching “${q}”` : ''}`}
      >
        <div className="form">
          <div className="small sub">Applies to every open problem the search matches, across all pages.</div>
          <input
            className="input"
            placeholder="Fixed in version (optional)"
            aria-label="Fixed in version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
          {progress && <div className="notice info">{progress}</div>}
          <ActionError error={run.error} />
          <div className="form-actions">
            <ConfirmButton small={false} disabled={run.pending} confirm={`Ignore all ${total}`} onConfirm={() => void run.run('ignored')}>
              Ignore all
            </ConfirmButton>
            <ConfirmButton small={false} disabled={run.pending} confirm={`Mark all ${total} fixed`} onConfirm={() => void run.run('resolved')}>
              Mark all fixed
            </ConfirmButton>
          </div>
        </div>
      </Dialog>
    </>
  )
}
