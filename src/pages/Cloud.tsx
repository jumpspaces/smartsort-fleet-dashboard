import { useState, type ReactNode } from 'react'
import * as api from '../api/endpoints.ts'
import type { CloudBootKind, CloudCrashes, CloudDependency, CloudHealth, CloudRoute, CloudSpace, SettingLevel, SettingState } from '../api/types.ts'
import { Bars } from '../components/Bars.tsx'
import { StepUpDialog } from '../components/StepUpDialog.tsx'
import { Card, Empty, ErrorNote, Live, Loadable, PageHeader, Segmented, When } from '../components/ui.tsx'
import { useApi } from '../data.ts'
import { bytes, count, date, duration, exact } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { href, problemHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const LEVEL_TONE = { ok: 'healthy', warning: 'attention', critical: 'offline' } as const
const LEVEL_WORD = { ok: 'Fine', warning: 'Needs a look', critical: 'Act now' } as const
/** Figures two-up inside a card, rather than one tall column. */
const KV = { margin: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' } as const
const GRID = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } as const

const TABS = ['overview', 'requests', 'database', 'deploys', 'cleanup', 'settings'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  requests: 'Requests',
  database: 'Database',
  deploys: 'Deploys',
  cleanup: 'Clean up',
  settings: 'Settings',
}
/** Warnings the Clean up tab can do something about. */
const WARNING_FIX: Record<string, string> = {
  'cloud.restarts': 'Clear',
  'cloud.errors_spike': 'Clear',
  'cloud.disk_low': 'Free space',
  'cloud.disk_runway': 'Free space',
}

/**
 * The cloud server itself — the one machine every till depends on and nothing
 * else on this console watches: its disk, memory, database and backups, the
 * requests it answers and fails, its deploys, its settings and the services it
 * calls.
 */
export function Cloud({ params }: { params: URLSearchParams }) {
  const raw = params.get('tab')
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview'
  return (
    <div className="stack">
      <PageHeader
        title="Cloud"
        sub="The server every till syncs to. What would stop the fleet — the disk or memory running out, failing requests, a crash loop, a wrong setting, a stuck database, a backup that doesn't restore — also raises an alert."
      />
      <nav className="tabs" aria-label="Cloud sections">
        {TABS.map((t) => (
          <a key={t} href={href('/cloud', { tab: t === 'overview' ? null : t })} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABEL[t]}
          </a>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'requests' && <Requests />}
      {tab === 'database' && <Database />}
      {tab === 'deploys' && <Deploys />}
      {tab === 'cleanup' && <CleanUp />}
      {tab === 'settings' && <Settings />}
    </div>
  )
}

/* -------------------------------------------------------------- overview -- */

function Overview() {
  const q = useApi('cloud', (c, s) => api.cloudHealth(c, s), { every: 120_000 })
  return (
    <Loadable q={q} rows={10}>
      {(h) => (
        <>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Live updatedAt={q.updatedAt} busy={q.refreshing} />
          </div>
          <Warnings h={h} />
          <div style={GRID}>
            <Disk h={h} />
            {h.machine && <Machine h={h} />}
            <Backups h={h} />
            <Server h={h} />
            {h.requests && <RequestsToday h={h} />}
            {h.dependencies && <DependsOn deps={h.dependencies} compact />}
          </div>
          <Growth h={h} />
        </>
      )}
    </Loadable>
  )
}

function Warnings({ h }: { h: CloudHealth }) {
  if (h.warnings.length === 0) {
    return (
      <Card>
        <div className="row">
          <span className="badge healthy">All clear</span>
          <span className="small muted">
            Checked <When iso={h.checkedAt} />
          </span>
        </div>
      </Card>
    )
  }
  return (
    <Card title="Needs attention" flush>
      <ul className="list">
        {h.warnings.map((w) => (
          <li key={w.key} className="row" style={{ padding: '10px 16px', gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <span className={`badge ${LEVEL_TONE[w.level]}`} style={{ flex: 'none' }}>
              {LEVEL_WORD[w.level]}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <strong>{w.title}</strong>
              <div className="small muted">{w.detail}</div>
            </span>
            {WARNING_FIX[w.key] && (
              <a className="btn sm ghost" style={{ flex: 'none' }} href={href('/cloud', { tab: 'cleanup' })}>
                {WARNING_FIX[w.key]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${label}: ${pct}% used`}
      style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ink)' }} />
    </div>
  )
}

function Disk({ h }: { h: CloudHealth }) {
  const d = h.disk
  return (
    <Card
      title="Disk"
      actions={
        <>
          <span className={`badge ${LEVEL_TONE[h.diskLevel]}`}>{LEVEL_WORD[h.diskLevel]}</span>
          <a className="btn sm ghost" href={href('/cloud', { tab: 'cleanup' })}>
            Free space
          </a>
        </>
      }
    >
      {!d ? (
        <Empty title="Couldn’t read the disk" />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <Meter used={d.totalBytes - d.freeBytes} total={d.totalBytes} label="Disk" />
          <dl className="kv" style={KV}>
            <div>
              <dt>Free</dt>
              <dd className="num">
                {bytes(d.freeBytes)} of {bytes(d.totalBytes)}
              </dd>
            </div>
            <div>
              <dt>Filling at</dt>
              <dd className="num">
                {h.runway.bytesPerDay == null ? 'Not enough days yet' : h.runway.bytesPerDay <= 0 ? 'Not filling' : `${bytes(h.runway.bytesPerDay)} a day`}
              </dd>
            </div>
            <div>
              <dt>Full in</dt>
              <dd className="num">{h.runway.fullInDays == null ? '—' : `about ${count(h.runway.fullInDays)} days`}</dd>
            </div>
            {h.machine?.folders.map((f) => (
              <div key={f.path}>
                <dt>{f.label}</dt>
                <dd className="num">
                  {f.truncated ? 'over ' : ''}
                  {bytes(f.bytes)}
                  <div className="small muted">{count(f.files)} files</div>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Card>
  )
}

function Machine({ h }: { h: CloudHealth }) {
  const m = h.machine!
  const mem = m.memory
  const limited = mem.containerLimitBytes != null && mem.containerUsedBytes != null
  const used = limited ? mem.containerUsedBytes! : mem.totalBytes - mem.availableBytes
  const total = limited ? mem.containerLimitBytes! : mem.totalBytes
  const busy = m.load[0]! > m.cpus
  return (
    <Card title="Machine" sub={`${m.cpus} CPU${m.cpus === 1 ? '' : 's'} · up ${duration(m.uptimeSec * 1000)}`}>
      <div className="stack" style={{ gap: 10 }}>
        {(mem.measured || limited) && <Meter used={used} total={total} label="Memory" />}
        <dl className="kv" style={KV}>
          <div>
            <dt>{limited ? 'Container memory' : 'Memory available'}</dt>
            <dd className="num">
              {limited ? `${bytes(used)} of ${bytes(total)}` : `${bytes(mem.availableBytes)} of ${bytes(mem.totalBytes)}`}
              {!mem.measured && <div className="small muted">Not Linux’s own figure</div>}
            </dd>
          </div>
          <div>
            <dt>Swap</dt>
            <dd className="num">
              {mem.swapTotalBytes == null ? '—' : mem.swapTotalBytes === 0 ? 'None' : `${bytes(mem.swapTotalBytes - (mem.swapFreeBytes ?? 0))} used of ${bytes(mem.swapTotalBytes)}`}
            </dd>
          </div>
          <div>
            <dt>Load (1, 5, 15 min)</dt>
            <dd className={busy ? 'num warn' : 'num'}>
              {m.load.join(' · ')}
              {busy && <div className="small muted">More work than CPUs</div>}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}

function Backups({ h }: { h: CloudHealth }) {
  const b = h.backups
  const v = b.verified
  return (
    <Card title="Database backups" sub={b.dir ? <span className="mono">{b.dir}</span> : 'Folder not mounted'}>
      {!b.visible ? (
        <Empty title="The server can’t see its backups">Mount the dump folder read-only and set CLOUD_BACKUP_DIR (server/DEPLOY.md §8).</Empty>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <dl className="kv" style={KV}>
            <div>
              <dt>Newest dump</dt>
              <dd>{b.newestAt ? <When iso={b.newestAt} /> : 'None'}</dd>
            </div>
            <div>
              <dt>Restores?</dt>
              <dd className={v?.ok ? undefined : 'warn'}>
                {!v ? (
                  'Never checked'
                ) : v.ok ? (
                  <>
                    Yes, <When iso={v.at} />
                    <div className="small muted">
                      {v.tables ?? '?'} tables, {count(v.sales ?? 0)} sales
                    </div>
                  </>
                ) : (
                  <>
                    Failed <When iso={v.at} />
                    {v.error && <div className="small muted">{v.error}</div>}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Copied off the server</dt>
              <dd className={b.offsiteAt ? undefined : 'warn'}>{b.offsiteAt ? <When iso={b.offsiteAt} /> : 'Never marked'}</dd>
            </div>
            <div>
              <dt>Dumps kept</dt>
              <dd className="num">{b.files.length}</dd>
            </div>
          </dl>
          {b.files.length > 0 && (
            <details>
              <summary className="small">Every dump</summary>
              <table className="table">
                <tbody>
                  {b.files.map((f) => (
                    <tr key={f.name}>
                      <td className="mono small">{f.name}</td>
                      <td className="r num small">{bytes(f.bytes)}</td>
                      <td className="small sub" title={exact(f.modifiedAt)}>
                        {date(f.modifiedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </Card>
  )
}

function Server({ h }: { h: CloudHealth }) {
  const s = h.server
  const passAge = s.lastAlertPassAt ? Date.now() - Date.parse(s.lastAlertPassAt) : null
  return (
    <Card
      title="Server"
      actions={
        h.settings ? (
          <a className={`badge ${h.settings.problems ? 'attention' : 'healthy'}`} href={href('/cloud', { tab: 'settings' })}>
            {h.settings.problems ? `${h.settings.problems} setting${h.settings.problems === 1 ? '' : 's'} to fix` : 'Settings fine'}
          </a>
        ) : undefined
      }
    >
      <dl className="kv" style={KV}>
        <div>
          <dt>Image</dt>
          <dd className="mono">{s.imageTag ? <ImageLink tag={s.imageTag} /> : 'not set'}</dd>
        </div>
        <div>
          <dt>Up since</dt>
          <dd title={exact(s.startedAt)}>
            {date(s.startedAt)}
            {h.boots && h.boots.lastHour > 1 && <div className="small warn">{h.boots.lastHour} starts this hour</div>}
          </dd>
        </div>
        <div>
          <dt>Its memory</dt>
          <dd className="num">{bytes(s.rssBytes)}</dd>
        </div>
        <div>
          <dt>Alert checks</dt>
          <dd className={passAge == null || passAge > 5 * 60_000 ? 'warn' : undefined}>
            {passAge == null ? 'Not run since start' : `last ${duration(passAge)} ago`}
          </dd>
        </div>
        <div>
          <dt>Node</dt>
          <dd className="mono">{s.node}</dd>
        </div>
        <div>
          <dt>Certificate</dt>
          <dd>
            {!h.cert ? (
              <span className="muted">Not checked here</span>
            ) : h.cert.validTo ? (
              <span title={exact(h.cert.validTo)}>Valid until {date(h.cert.validTo)}</span>
            ) : (
              <span className="warn">Couldn’t check: {h.cert.error}</span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  )
}

function RequestsToday({ h }: { h: CloudHealth }) {
  const r = h.requests!
  const failedPct = r.day.requests ? (r.day.serverErrors / r.day.requests) * 100 : 0
  return (
    <Card
      title="Requests, last 24 hours"
      actions={
        <a className="btn sm ghost" href={href('/cloud', { tab: 'requests' })}>
          By route
        </a>
      }
    >
      <dl className="kv" style={KV}>
        <div>
          <dt>Answered</dt>
          <dd className="num">{count(r.day.requests)}</dd>
        </div>
        <div>
          <dt>Server errors</dt>
          <dd className={r.day.serverErrors ? 'num warn' : 'num'}>
            {count(r.day.serverErrors)}
            {r.day.serverErrors > 0 && <div className="small muted">{failedPct < 0.1 ? 'under 0.1' : failedPct.toFixed(1)}% of requests</div>}
          </dd>
        </div>
        <div>
          <dt>Last 15 minutes</dt>
          <dd className="num">
            {count(r.last15m.requests)}
            {r.last15m.serverErrors > 0 && <div className="small warn">{r.last15m.serverErrors} failed</div>}
          </dd>
        </div>
        <div>
          <dt>Refused (4xx)</dt>
          <dd className="num">{count(r.day.clientErrors)}</dd>
        </div>
      </dl>
    </Card>
  )
}

const DEP_TONE: Record<CloudDependency['health'], string> = { ok: 'healthy', failing: 'offline', unused: 'neutral', off: 'neutral' }
const DEP_WORD: Record<CloudDependency['health'], string> = { ok: 'Working', failing: 'Failing', unused: 'Not used yet', off: 'Not set up' }

function DependsOn({ deps, compact }: { deps: CloudDependency[]; compact?: boolean }) {
  return (
    <Card
      title="What it depends on"
      sub={compact ? 'The outside services it calls.' : 'The outside services the cloud calls, with the last time each worked and didn’t. Push and the heartbeat count from when the server started.'}
      actions={
        compact ? (
          <a className="btn sm ghost" href={href('/cloud', { tab: 'settings' })}>
            Details
          </a>
        ) : undefined
      }
      flush
    >
      {deps.length === 0 ? (
        <Empty title="Nothing to show" />
      ) : (
        <ul className="list">
          {deps.map((d) => (
            <li key={d.name} className="row" style={{ padding: '8px 16px', gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <span className={`badge ${DEP_TONE[d.health]}`} style={{ flex: 'none' }}>
                {DEP_WORD[d.health]}
              </span>
              <span style={{ minWidth: 0 }}>
                {d.name}
                {compact ? (
                  d.health === 'failing' && d.lastError && <div className="small muted">{d.lastError}</div>
                ) : (
                  <div className="small muted">
                    {d.what}
                    {d.lastOkAt && (
                      <>
                        {' '}
                        · worked <When iso={d.lastOkAt} />
                      </>
                    )}
                    {d.lastFailAt && (
                      <>
                        {' '}
                        · failed <When iso={d.lastFailAt} />
                      </>
                    )}
                    {d.lastError && <div>{d.lastError}</div>}
                  </div>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Growth({ h }: { h: CloudHealth }) {
  const days = [...h.history].reverse()
  if (days.length < 2) return null
  return (
    <div style={GRID}>
      <Card title="Database size, by day">
        <Bars label="Database size by day" points={days.map((d) => ({ key: d.day, value: d.dbBytes, label: d.day }))} format={(n) => bytes(n)} />
      </Card>
      <Card title="Free disk, by day">
        <Bars label="Free disk by day" points={days.map((d) => ({ key: d.day, value: d.diskFreeBytes, label: d.day }))} format={(n) => bytes(n)} />
      </Card>
    </div>
  )
}

/** "sha-1dd4d0b" links to its commit; anything else is just the tag. */
function ImageLink({ tag }: { tag: string }) {
  const sha = /^sha-([0-9a-f]{7,40})$/.exec(tag)?.[1]
  if (!sha) return <>{tag}</>
  return (
    <a href={`https://github.com/jumpspaces/PROJECT-POS/commit/${sha}`} target="_blank" rel="noreferrer">
      {tag}
    </a>
  )
}

/* -------------------------------------------------------------- requests -- */

type RouteSort = 'busiest' | 'failing' | 'slowest'

function Requests() {
  const [days, setDays] = useState<'1' | '7' | '30'>('7')
  const [sort, setSort] = useState<RouteSort>('busiest')
  const q = useApi(`cloud:requests:${days}`, (c, s) => api.cloudRequests(c, Number(days), s), { every: 60_000 })
  return (
    <Loadable q={q} rows={8}>
      {(r) => {
        const routes = [...r.routes].sort((a, b) =>
          sort === 'failing'
            ? b.serverErrors - a.serverErrors || b.clientErrors - a.clientErrors
            : sort === 'slowest'
              ? (b.p95Ms ?? 0) - (a.p95Ms ?? 0)
              : b.requests - a.requests,
        )
        const label = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit' })
        return (
          <>
            <div className="spread">
              <Segmented
                label="How far back"
                value={days}
                onChange={setDays}
                options={[
                  { value: '1', label: 'Day' },
                  { value: '7', label: 'Week' },
                  { value: '30', label: 'Month' },
                ]}
              />
              <Live updatedAt={q.updatedAt} busy={q.refreshing} />
            </div>
            <div style={GRID}>
              <Card title="Requests, by hour">
                <Bars label="Requests by hour" points={r.hours.map((h) => ({ key: h.hour, value: h.requests, label: label(h.hour) }))} format={(n) => count(n)} />
              </Card>
              <Card title="Server errors, by hour" sub={<a href={href('/problems')}>The errors themselves are in App problems, as the cloud</a>}>
                <Bars label="Server errors by hour" points={r.hours.map((h) => ({ key: h.hour, value: h.serverErrors, label: label(h.hour) }))} format={(n) => count(n)} />
              </Card>
            </div>
            <Card
              title="By route, last 24 hours"
              sub={
                <>
                  Counted since the server started <When iso={r.since} />. A route is its pattern, never a shop’s ids.
                </>
              }
              actions={
                <Segmented
                  label="Sort routes"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'busiest', label: 'Busiest' },
                    { value: 'failing', label: 'Failing' },
                    { value: 'slowest', label: 'Slowest' },
                  ]}
                />
              }
              flush
            >
              {routes.length === 0 ? <Empty title="No requests yet" /> : <RouteTable routes={routes.slice(0, 60)} />}
            </Card>
          </>
        )
      }}
    </Loadable>
  )
}

function RouteTable({ routes }: { routes: CloudRoute[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Route</th>
            <th className="r">Requests</th>
            <th className="r">Server errors</th>
            <th className="r">Refused</th>
            <th className="r">Typical</th>
            <th className="r">95% under</th>
            <th className="r">Slowest</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.route}>
              <td className="mono small" style={{ overflowWrap: 'anywhere' }}>
                {r.route}
              </td>
              <td className="r num">{count(r.requests)}</td>
              <td className={r.serverErrors ? 'r num warn' : 'r num'}>{count(r.serverErrors)}</td>
              <td className="r num">{count(r.clientErrors)}</td>
              <td className="r num">{ms(r.avgMs)}</td>
              <td className="r num">{r.p95Ms == null ? '—' : ms(r.p95Ms)}</td>
              <td className="r num">{ms(r.slowestMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`)

/* -------------------------------------------------------------- database -- */

function Database() {
  const q = useApi('cloud:database', (c, s) => api.cloudDatabase(c, s), { every: 30_000 })
  return (
    <Loadable q={q} rows={8}>
      {(d) => {
        const used = d.connections.reduce((s, c) => s + c.count, 0)
        const pending = d.migrations.shipped != null ? d.migrations.shipped - d.migrations.applied : 0
        return (
          <>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Live updatedAt={q.updatedAt} busy={q.refreshing} />
            </div>
            <div style={GRID}>
              <Card title="Database" sub={d.version ? `PostgreSQL ${d.version}` : undefined}>
                <dl className="kv" style={KV}>
                  <div>
                    <dt>Size</dt>
                    <dd className="num">{bytes(d.bytes)}</dd>
                  </div>
                  <div>
                    <dt>Reads from memory</dt>
                    <dd className={d.cacheHitPct != null && d.cacheHitPct < 95 ? 'num warn' : 'num'}>{d.cacheHitPct == null ? '—' : `${d.cacheHitPct}%`}</dd>
                  </div>
                  <div>
                    <dt>Migrations</dt>
                    <dd className={pending > 0 ? 'warn' : undefined}>
                      {d.migrations.applied} applied{pending > 0 ? `, ${pending} waiting` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Deadlocks</dt>
                    <dd className={d.deadlocks ? 'num warn' : 'num'}>{count(d.deadlocks)}</dd>
                  </div>
                  <div>
                    <dt>Commits / rollbacks</dt>
                    <dd className="num">
                      {count(d.commits)} / {count(d.rollbacks)}
                    </dd>
                  </div>
                </dl>
              </Card>
              <Card title="Connections" sub={`${used} of ${d.maxConnections} in use`}>
                <div className="stack" style={{ gap: 10 }}>
                  <Meter used={used} total={d.maxConnections} label="Connections" />
                  <dl className="kv" style={KV}>
                    {d.connections.map((c) => (
                      <div key={c.state}>
                        <dt>{c.state}</dt>
                        <dd className={c.state === 'idle in transaction' ? 'num warn' : 'num'}>{c.count}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Card>
            </div>
            <Card
              title="Transactions open over 30 seconds"
              sub="One left open holds back every writer to the same rows — sync included. Over 10 minutes raises an alert."
              flush
            >
              {d.openTransactions.length === 0 ? (
                <Empty title="None" />
              ) : (
                <SqlTable
                  head={['Open for', 'State', 'Waiting on', 'From', 'Query']}
                  rows={d.openTransactions.map((t) => [
                    duration(t.ageMs),
                    t.state ?? '—',
                    t.waiting ?? '—',
                    t.application ?? '—',
                    <code key="q" className="small">
                      {t.query}
                    </code>,
                  ])}
                />
              )}
            </Card>
            {d.blocked.length > 0 && (
              <Card title="Waiting on a lock" flush>
                <SqlTable
                  head={['Waiting', 'Blocked by', 'Query']}
                  rows={d.blocked.map((b) => [
                    duration(b.ageMs),
                    b.blockers.map((p) => `#${p}`).join(', '),
                    <code key="q" className="small">
                      {b.query}
                    </code>,
                  ])}
                />
              </Card>
            )}
            <div style={GRID}>
              <Card title="Dead rows" sub="Updated or deleted rows autovacuum hasn’t cleared yet." flush>
                {d.deadRows.length === 0 ? (
                  <Empty title="None waiting" />
                ) : (
                  <SqlTable
                    head={['Table', 'Dead', 'Live', 'Vacuumed']}
                    rows={d.deadRows.map((t) => [
                      <span key="t" className="mono small">
                        {t.table}
                      </span>,
                      count(t.dead),
                      count(t.live),
                      t.vacuumedAt ? <When key="v" iso={t.vacuumedAt} /> : 'never',
                    ])}
                  />
                )}
              </Card>
              <Card title="Largest tables" flush>
                <SqlTable
                  head={['Table', 'Rows (about)', 'Size']}
                  rows={d.largest.map((t) => [
                    <span key="t" className="mono small">
                      {t.name}
                    </span>,
                    count(t.rows),
                    bytes(t.bytes),
                  ])}
                />
              </Card>
            </div>
          </>
        )
      }}
    </Loadable>
  )
}

function SqlTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ overflowWrap: 'anywhere' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --------------------------------------------------------------- deploys -- */

const KIND: Record<CloudBootKind, { label: string; tone: string }> = {
  first: { label: 'First start', tone: 'neutral' },
  deploy: { label: 'Deploy', tone: 'healthy' },
  restart: { label: 'Restart', tone: 'neutral' },
  rollback: { label: 'Rollback', tone: 'attention' },
}

function Deploys() {
  const q = useApi('cloud:deploys', (c, s) => api.cloudDeploys(c, s), { every: 120_000 })
  return (
    <Card
      title="Every start of the server"
      sub="A new image is a deploy, the same one a restart, an earlier one a rollback — the deploy workflow rolls back by itself when a new image won’t come up. Three starts in an hour raises an alert."
      flush
    >
      <Loadable q={q} rows={6}>
        {({ boots }) =>
          boots.length === 0 ? (
            <Empty title="No starts recorded yet">The server records each start from this version on.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>What</th>
                    <th>Image</th>
                    <th>Replaced</th>
                    <th className="r">Ran for</th>
                  </tr>
                </thead>
                <tbody>
                  {boots.map((b) => (
                    <tr key={b.id}>
                      <td className="nowrap" title={exact(b.startedAt)}>
                        {date(b.startedAt)}{' '}
                        <span className="small muted">{new Date(b.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      </td>
                      <td>
                        <span className={`badge ${KIND[b.kind].tone}`}>{KIND[b.kind].label}</span>
                        {b.kind === 'restart' && b.clearedAt && (
                          <span className="small muted" title={`Cleared ${exact(b.clearedAt)}`}>
                            {' '}
                            cleared
                          </span>
                        )}
                      </td>
                      <td className="mono small">{b.imageTag ? <ImageLink tag={b.imageTag} /> : '—'}</td>
                      <td className="mono small">{b.from ? <ImageLink tag={b.from} /> : '—'}</td>
                      <td className="r num">{b.ranForMs == null ? <span className="badge healthy">Running</span> : duration(b.ranForMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </Card>
  )
}

/* -------------------------------------------------------------- clean up -- */

function CleanUp() {
  const [fast, setFast] = useState(false)
  // Every few seconds while a request waits on the helper, which runs each minute.
  const q = useApi('cloud:cleanup', (c, s) => api.cloudCleanup(c, s), { every: fast ? 5_000 : 60_000 })
  const waiting = !!q.data?.space.waiting
  if (waiting !== fast) setFast(waiting)
  return (
    <Loadable q={q} rows={8}>
      {({ crashes, space }) => (
        <>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Live updatedAt={q.updatedAt} busy={q.refreshing} />
          </div>
          <Crashes c={crashes} />
          <Space s={space} />
        </>
      )}
    </Loadable>
  )
}

function Crashes({ c }: { c: CloudCrashes }) {
  const { client, canAct } = useSession()
  const [done, setDone] = useState<string | null>(null)
  const act = useAction(async () => {
    const r = await api.clearCloudCrashes(client)
    setDone(
      r.starts || r.errors
        ? `Cleared ${r.starts} start${r.starts === 1 ? '' : 's'} and ${r.errors} error${r.errors === 1 ? '' : 's'}. Alerts close at the next check, within a minute.`
        : 'Nothing was waiting to be cleared.',
    )
    invalidate('cloud')
  })
  const anything = c.restarts.count > 0 || c.startsLastHour > 0 || c.errors.open > 0 || !!c.spike
  return (
    <Card
      title="Crashes"
      sub="What says the server is falling over: restarts of the same image, and its own errors. Clearing marks them seen — the starts stay on Deploys and the errors in App problems, and any that happens again comes back."
      actions={
        canAct ? (
          <button className="btn sm primary" disabled={!anything || act.pending} onClick={() => void act.run()}>
            {act.pending ? 'Clearing…' : 'Clear crashes'}
          </button>
        ) : undefined
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <dl className="kv" style={KV}>
          <div>
            <dt>Restarts, last 7 days</dt>
            <dd className={c.restarts.count ? 'num warn' : 'num'}>
              {count(c.restarts.count)}
              {c.restarts.lastAt && (
                <div className="small muted">
                  last <When iso={c.restarts.lastAt} />
                </div>
              )}
            </dd>
          </div>
          <div>
            <dt>Starts this hour</dt>
            <dd className={c.startsLastHour >= 3 ? 'num warn' : 'num'}>
              {count(c.startsLastHour)}
              {c.startsLastHour >= 3 && <div className="small muted">A crash loop</div>}
            </dd>
          </div>
          <div>
            <dt>Its errors, open</dt>
            <dd className={c.errors.open ? 'num warn' : 'num'}>
              {count(c.errors.open)}
              {c.errors.open > 0 && <div className="small muted">{count(c.errors.occurrences)} times</div>}
            </dd>
          </div>
          <div>
            <dt>Last 15 minutes</dt>
            <dd className={c.spike ? 'num warn' : 'num'}>{c.spike ? `${count(c.spike.serverErrors)} of ${count(c.spike.requests)} failed` : 'No burst'}</dd>
          </div>
          <div>
            <dt>Last cleared</dt>
            <dd>
              {c.lastCleared ? (
                <>
                  <When iso={c.lastCleared.at} />
                  {c.lastCleared.by && <div className="small muted">by {c.lastCleared.by}</div>}
                </>
              ) : (
                'Never'
              )}
            </dd>
          </div>
        </dl>
        {c.errors.groups.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Error</th>
                  <th className="r">Times</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {c.errors.groups.map((g) => (
                  <tr key={g.fingerprint}>
                    <td className="small" style={{ overflowWrap: 'anywhere' }}>
                      <a href={problemHref(g.fingerprint)}>{g.message}</a>
                      {g.cameBack && (
                        <>
                          {' '}
                          <span className="badge attention">Came back</span>
                        </>
                      )}
                    </td>
                    <td className="r num">{count(g.count)}</td>
                    <td className="small nowrap">
                      <When iso={g.lastSeenAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {act.error && <ErrorNote error={act.error} />}
        {done && <div className="notice info">{done}</div>}
        <div className="small muted">The crash output itself is in the server’s log on the droplet — empty it with Container logs below.</div>
      </div>
    </Card>
  )
}

const HELPER_NOTE: Record<Exclude<CloudSpace['helper']['state'], 'ok'>, string> = {
  off: 'CLOUD_HOUSEKEEPING_DIR isn’t set on this server, so it can’t ask the droplet to free anything. See server/DEPLOY.md §10.',
  missing: 'The clean-up helper has never reported from the droplet. Install its cron: server/DEPLOY.md §10.',
  stale: 'The clean-up helper has stopped reporting. Check its cron on the droplet (server/DEPLOY.md §10).',
}
/** Backups are the one kind not ticked to start with. */
const UNTICKED = new Set(['predeploy'])

function Space({ s }: { s: CloudSpace }) {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [asking, setAsking] = useState(false)
  const ready = s.helper.state === 'ok'
  const chosen = picked ?? new Set(s.items.filter((i) => (i.bytes ?? 0) > 0 && !UNTICKED.has(i.key)).map((i) => i.key))
  const chosenBytes = s.items.filter((i) => chosen.has(i.key)).reduce((n, i) => n + (i.bytes ?? 0), 0)
  const label = (key: string) => s.items.find((i) => i.key === key)?.label ?? key
  const toggle = (key: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(key)
    else next.delete(key)
    setPicked(next)
  }
  return (
    <Card
      title="Space you can free"
      sub={
        <>
          The droplet’s clean-up helper frees these, and decides what stays: the running image, the newest dumps and screen updates always do.
          {s.measuredAt && (
            <>
              {' '}
              Measured <When iso={s.measuredAt} />
              {s.diskFreeBytes != null && `, with ${bytes(s.diskFreeBytes)} free`}.
            </>
          )}
        </>
      }
      flush
    >
      {s.helper.state !== 'ok' && (
        // One span: .notice lays its children out side by side.
        <div className="notice warn" style={{ margin: 16 }}>
          <span>
            {HELPER_NOTE[s.helper.state]}
            {s.helper.state === 'stale' && s.helper.seenAt && (
              <>
                {' '}
                Last heard <When iso={s.helper.seenAt} />.
              </>
            )}
          </span>
        </div>
      )}
      {s.waiting && (
        <div className="notice info" style={{ margin: 16 }}>
          <span>
            {s.waiting.started ? 'The helper is freeing ' : 'Waiting for the helper, which runs every minute, to free '}
            {s.waiting.items.map(label).join(', ').toLowerCase()} — asked <When iso={s.waiting.requestedAt} />
            {s.waiting.by && ` by ${s.waiting.by}`}.
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 32 }} aria-label="Free" />
              <th>What</th>
              <th className="r">Holds</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.key}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Free ${i.label}`}
                    checked={chosen.has(i.key)}
                    disabled={!isAdmin || !ready || !!s.waiting}
                    onChange={(e) => toggle(i.key, e.target.checked)}
                  />
                </td>
                <td>
                  {i.label}
                  <div className="small muted">{i.what}</div>
                </td>
                <td className="r num nowrap">
                  {i.bytes == null ? (
                    '—'
                  ) : (
                    <>
                      {i.key === 'images' && i.bytes > 0 ? 'up to ' : ''}
                      {bytes(i.bytes)}
                      {i.bytes > 0 && i.count != null && (
                        <div className="small muted">
                          {count(i.count)} {i.key === 'images' ? `image${i.count === 1 ? '' : 's'}` : `file${i.count === 1 ? '' : 's'}`}
                        </div>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: 16, justifyContent: 'space-between' }}>
        {isAdmin ? (
          <button className="btn danger-solid" disabled={!ready || !!s.waiting || chosen.size === 0} onClick={() => setAsking(true)}>
            Free {chosenBytes > 0 ? bytes(chosenBytes) : 'space'}…
          </button>
        ) : (
          <span className="small muted">Only admins can free space.</span>
        )}
        <span className="small muted">Shared layers mean an image can free less than its size.</span>
      </div>
      {s.history.length > 0 && <CleanupHistory s={s} label={label} />}
      <StepUpDialog
        open={asking}
        title="Free space on the droplet"
        confirm="Free it"
        danger
        hint="Asked again because what goes can’t be brought back."
        onClose={() => setAsking(false)}
        onConfirm={async (password) => {
          await api.requestCloudCleanup(client, [...chosen], password)
          setPicked(null)
          invalidate('cloud:cleanup')
        }}
      >
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {[...chosen].map((k) => (
            <li key={k}>{label(k)}</li>
          ))}
        </ul>
        <p className="small" style={{ margin: 0 }}>
          The helper picks it up within a minute. Images and dumps go for good; the ones a rollback needs stay.
        </p>
      </StepUpDialog>
    </Card>
  )
}

function CleanupHistory({ s, label }: { s: CloudSpace; label: (key: string) => string }) {
  return (
    <details style={{ padding: '0 16px 16px' }}>
      <summary className="small">Earlier clean-ups</summary>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Asked</th>
              <th>What</th>
              <th className="r">Freed</th>
            </tr>
          </thead>
          <tbody>
            {s.history.map((h) => (
              <tr key={h.id}>
                <td className="nowrap small" title={exact(h.requestedAt)}>
                  {date(h.requestedAt)}
                  {h.by && <div className="muted">{h.by}</div>}
                </td>
                <td className="small">
                  {h.state === 'expired' ? (
                    <>
                      <span className="badge attention">Never picked up</span> {h.items.map(label).join(', ')}
                    </>
                  ) : (
                    h.items.map((k) => {
                      const r = h.results?.[k]
                      return (
                        <div key={k} style={{ marginBottom: 2 }}>
                          {label(k)}
                          {r && r.ok && `: ${bytes(r.freedBytes)}`}
                          {r && !r.ok && (
                            <>
                              {' '}
                              <span className="badge attention">Failed</span> <span className="muted">{r.error ?? ''}</span>
                            </>
                          )}
                          {!r && <span className="muted">: not done</span>}
                        </div>
                      )
                    })
                  )}
                </td>
                <td className="r num">{h.freedBytes == null ? '—' : bytes(h.freedBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/* -------------------------------------------------------------- settings -- */

const STATE: Record<SettingState, { label: string; tone: string }> = {
  ok: { label: 'Working', tone: 'healthy' },
  missing: { label: 'Not set', tone: 'attention' },
  broken: { label: 'Not working', tone: 'offline' },
  default: { label: 'Default', tone: 'neutral' },
}
const LEVEL: Record<SettingLevel, string> = { required: 'Required', recommended: 'Recommended', optional: 'Optional' }
const LEVEL_RANK: Record<SettingLevel, number> = { required: 0, recommended: 1, optional: 2 }
const STATE_RANK: Record<SettingState, number> = { broken: 0, missing: 1, default: 2, ok: 3 }

function Settings() {
  const q = useApi('cloud:settings', (c, s) => api.cloudSettings(c, s), { every: 120_000 })
  return (
    <Loadable q={q} rows={8}>
      {({ settings, dependencies }) => {
        // What's wrong first — the required before the recommended — then what's fine.
        const wrong = (x: (typeof settings)[number]) => (x.state === 'missing' || x.state === 'broken' ? 0 : 1)
        const sorted = [...settings].sort(
          (a, b) => wrong(a) - wrong(b) || LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || STATE_RANK[a.state] - STATE_RANK[b.state],
        )
        return (
          <>
            <Card
              title="Settings"
              sub="Whether each is set and, where it can be checked, working. Never a value. Docker passes only the variables docker-compose.yml lists — one added to .env alone never arrives."
              flush
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Needed</th>
                      <th>State</th>
                      <th>What it means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.key}>
                        <td>
                          {s.label}
                          <div className="mono small muted">{s.key}</div>
                        </td>
                        <td className="small">{LEVEL[s.level]}</td>
                        <td>
                          <span className={`badge ${STATE[s.state].tone}`}>{STATE[s.state].label}</span>
                        </td>
                        <td className="small" style={{ maxWidth: 520 }}>
                          {s.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <DependsOn deps={dependencies} />
          </>
        )
      }}
    </Loadable>
  )
}
