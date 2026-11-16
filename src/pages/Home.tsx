import type { Device } from '../api/types.ts'
import { Card, Empty, Live, Loadable, PageHeader, StateBadge, When } from '../components/ui.tsx'
import { useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { AssistantBrief } from '../api/types.ts'
import { ActionError } from '../components/forms.tsx'
import { useAlerts, useAssistantOn, useDevices, useOverview } from '../data.ts'
import { useAction } from '../lib/query.ts'
import { useSession } from '../lib/session.tsx'
import { BriefView } from './shop/ShopAssistant.tsx'
import { count, pct, plural } from '../lib/format.ts'
import { reasonPlain, rulePlain, tillName } from '../lib/plain.ts'
import { href, shopHref, tillHref } from '../lib/router.ts'

/**
 * The front page answers one question: is anything wrong, and where. Counts on
 * top, then every till that isn't fine grouped by shop — a shop is who you
 * call — then the alerts still waiting on someone.
 */
export function Home() {
  const overview = useOverview()
  const problems = useDevices({ sort: 'state', dir: 'asc', limit: 200 })
  const alerts = useAlerts('open')

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHeader
        title="Home"
        sub="What needs attention across every shop."
        actions={<Live updatedAt={problems.updatedAt} busy={problems.refreshing} />}
      />

      <Loadable q={overview} rows={2}>
        {(o) => {
          const online = o.counts.all - o.counts.offline
          const latest = o.release.latestVersion
          const onLatest = latest ? (o.versions.find((v) => v.version === latest)?.count ?? 0) : null
          return (
            <div className="stats">
              <a className="card stat" href={href('/tills')}>
                <div className="stat-label">Tills connected</div>
                <div className="stat-value">
                  {count(online)}
                  <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}>
                    {' '}
                    / {count(o.counts.all)}
                  </span>
                </div>
                <div className="stat-note">
                  {o.uptimeBps30d == null ? 'No 30-day record yet' : `${pct(o.uptimeBps30d)} up over 30 days`}
                </div>
              </a>
              <a className="card stat" href={href('/tills', { state: 'attention' })}>
                <div className="stat-label">
                  <span className="dot attention" /> Need a look
                </div>
                <div className="stat-value">{count(o.counts.attention)}</div>
                <div className="stat-note">Connected, but something is off</div>
              </a>
              <a className="card stat" href={href('/tills', { state: 'offline' })}>
                <div className="stat-label">
                  <span className="dot offline" /> Offline
                </div>
                <div className="stat-value">{count(o.counts.offline)}</div>
                <div className="stat-note">Not heard from recently</div>
              </a>
              <a className="card stat" href={href('/alerts')}>
                <div className="stat-label">Open alerts</div>
                <div className="stat-value">{count(o.openAlerts)}</div>
                <div className="stat-note">
                  {latest && onLatest != null
                    ? `${plural(onLatest, 'till')} on latest ${latest}`
                    : 'No release published'}
                </div>
              </a>
            </div>
          )
        }}
      </Loadable>

      <HealthBrief />

      <div className="grid-2">
        <Card title="Needs attention" sub="Grouped by shop — that's who you'd call." flush>
          <Loadable q={problems} rows={5}>
            {(page) => {
              const list = page.devices.filter((d) => d.state !== 'healthy')
              // Sorted worst-first, so a full page of problems means there are more.
              const more = list.length === page.devices.length && page.total > page.devices.length
              return (
                <>
                  <ProblemList devices={list} />
                  {more && (
                    <div className="pager">
                      <span>Showing the first {count(list.length)}.</span>
                      <a className="btn sm" href={href('/tills', { state: 'attention' })}>
                        See every till
                      </a>
                    </div>
                  )}
                </>
              )
            }}
          </Loadable>
        </Card>

        <Card
          title="Open alerts"
          flush
          actions={
            <a className="btn sm ghost" href={href('/alerts')}>
              See all
            </a>
          }
        >
          <Loadable q={alerts} rows={4}>
            {(list) =>
              list.length === 0 ? (
                <Empty title="No open alerts">Nothing is waiting on anyone.</Empty>
              ) : (
                <ul className="list">
                  {list.slice(0, 6).map((a) => {
                    const p = rulePlain(a.ruleKey, a.title)
                    const target = a.deviceId ? tillHref(a.deviceId) : a.shopId ? shopHref(a.shopId) : href('/alerts')
                    return (
                      <li key={a.id}>
                        <a className="item" href={target}>
                          <div className="spread">
                            <span className="issue-title">
                              <span className={`dot ${a.severity === 'critical' ? 'offline' : 'attention'}`} /> {p.title}
                            </span>
                            <span className="small muted">
                              <When iso={a.openedAt} />
                            </span>
                          </div>
                          <div className="small sub">{a.shopName ?? 'Fleet-wide'}</div>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )
            }
          </Loadable>
        </Card>
      </div>
    </div>
  )
}

function ProblemList({ devices }: { devices: Device[] }) {
  if (devices.length === 0) {
    return <Empty title="Every till is working">Nothing needs a look right now.</Empty>
  }
  const byShop = new Map<string, { name: string; shopId: string | null; tills: Device[] }>()
  for (const d of devices) {
    const k = d.shopId ?? '—'
    const g = byShop.get(k) ?? { name: d.shopName ?? 'Not linked to a shop', shopId: d.shopId, tills: [] }
    g.tills.push(d)
    byShop.set(k, g)
  }
  // Shops with something offline first, then by how many tills are affected.
  const groups = [...byShop.values()].sort(
    (a, b) =>
      Number(b.tills.some((t) => t.state === 'offline')) - Number(a.tills.some((t) => t.state === 'offline')) ||
      b.tills.length - a.tills.length ||
      a.name.localeCompare(b.name),
  )

  return (
    <ul className="list">
      {groups.map((g) => (
        <li key={g.shopId ?? 'none'}>
          <div className="spread" style={{ marginBottom: 8 }}>
            {g.shopId ? (
              <a href={shopHref(g.shopId)} style={{ fontWeight: 600, textDecoration: 'none' }}>
                {g.name}
              </a>
            ) : (
              <span style={{ fontWeight: 600 }}>{g.name}</span>
            )}
            <span className="small muted">{plural(g.tills.length, 'till')}</span>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {byProblem(g.tills).map((p) => (
              <div key={p.key}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 8 }}>
                    <StateBadge state={p.state} />
                    <span className="issue-title">{p.plain.title}</span>
                  </span>
                  <span className="small muted">
                    {p.tills.length > 1 ? 'since ' : ''}
                    <When iso={p.since} />
                  </span>
                </div>
                <div className="issue-hint" style={{ marginTop: 2 }}>
                  {p.plain.hint}
                </div>
                <div className="row small" style={{ gap: 4, marginTop: 4 }}>
                  {p.tills.map((d, i) => (
                    <span key={d.deviceId}>
                      <a href={tillHref(d.deviceId)} className="sub">
                        {tillName(d)}
                      </a>
                      {d.mute && <span className="muted"> (muted)</span>}
                      {i < p.tills.length - 1 && <span className="muted">,</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The assistant's read of the fleet. Hidden entirely when AI is off. */
function HealthBrief() {
  const on = useAssistantOn()
  const { client } = useSession()
  const [brief, setBrief] = useState<AssistantBrief | null>(null)
  const get = useAction(async (fresh: boolean) => setBrief(await api.healthBrief(client, fresh)))
  if (!on) return null
  return (
    <Card
      title="Assistant’s read"
      sub="A written summary of what needs doing first."
      actions={
        <>
          <button className="btn sm" disabled={get.pending} onClick={() => void get.run(false)}>
            {get.pending ? 'Writing…' : brief ? 'Show saved' : 'Summarise the fleet'}
          </button>
          {brief && (
            <button className="btn sm ghost" disabled={get.pending} onClick={() => void get.run(true)}>
              Fresh one
            </button>
          )}
        </>
      }
    >
      <ActionError error={get.error} />
      {brief ? <BriefView brief={brief} /> : <div className="small muted">Ask for a summary when you start a shift.</div>}
    </Card>
  )
}

/**
 * One line per problem per shop, not per till: four tills offline in the same
 * shop is one phone call, and reads as one.
 */
export function byProblem(tills: Device[]) {
  const groups = new Map<string, { key: string; state: Device['state']; plain: ReturnType<typeof reasonPlain>; tills: Device[]; since: string }>()
  for (const d of tills) {
    const code = d.reasons[0]?.code ?? d.state
    const g = groups.get(code)
    if (g) {
      g.tills.push(d)
      // The oldest last check-in is how long the problem has been going on.
      if (d.lastReportAt < g.since) g.since = d.lastReportAt
    } else {
      groups.set(code, { key: code, state: d.state, plain: reasonPlain(d.reasons[0]?.code), tills: [d], since: d.lastReportAt })
    }
  }
  return [...groups.values()].sort((a, b) => Number(b.state === 'offline') - Number(a.state === 'offline'))
}
