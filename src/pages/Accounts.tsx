import * as api from '../api/endpoints.ts'
import type { SubscriptionState } from '../api/types.ts'
import { Card, Empty, Loadable, PageHeader, When } from '../components/ui.tsx'
import { useApi } from '../data.ts'
import { ago, count, date, money } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { href, shopHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const TABS = [
  { id: 'quiet', label: 'Going quiet' },
  { id: 'setup', label: 'Setting up' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'follow-ups', label: 'Follow-ups' },
] as const
type Tab = (typeof TABS)[number]['id']

/**
 * The shops as our customers rather than as tills: who to call before they
 * leave, who's still getting going, who owes what, and what we promised.
 */
export function Accounts({ params }: { params: URLSearchParams }) {
  const raw = params.get('tab')
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : 'quiet'
  return (
    <div className="stack">
      <PageHeader title="Accounts" sub="The shops as customers: who to call, who's still setting up, who owes what." />
      <nav className="tabs" aria-label="Account sections">
        {TABS.map((t) => (
          <a key={t.id} href={href('/accounts', { tab: t.id === 'quiet' ? null : t.id })} aria-current={t.id === tab ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {tab === 'quiet' && <GoingQuiet />}
      {tab === 'setup' && <SettingUp />}
      {tab === 'subscriptions' && <Subscriptions />}
      {tab === 'follow-ups' && <FollowUps />}
    </div>
  )
}

function GoingQuiet() {
  const q = useApi('accounts:quiet', (c, s) => api.quietShops(c, s))
  return (
    <Card
      title="Going quiet"
      sub="Shops that stopped selling for 3 days, or sold under half their usual week. A call now is worth more than one after they've gone. Shops under two weeks old aren't judged yet."
      flush
    >
      <Loadable q={q} rows={4}>
        {(shops) =>
          shops.length === 0 ? (
            <Empty title="Every shop is trading as usual" />
          ) : (
            <div className="table-wrap">
              <table className="table cards">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>What changed</th>
                    <th>Last sale</th>
                    <th>Last week</th>
                    <th>Last contact</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((s) => (
                    <tr key={s.shopId}>
                      <td data-label="" className="primary-cell">
                        <a href={shopHref(s.shopId)}>{s.name}</a>
                        <div className="small muted">
                          {[s.owner, s.phone].filter(Boolean).join(' · ') || s.code || '—'}
                        </div>
                      </td>
                      <td data-label="What changed">
                        <span className={`badge ${s.reason === 'stopped' ? 'offline' : 'attention'}`}>{s.reason === 'stopped' ? 'Stopped' : 'Dropping'}</span>{' '}
                        <span className="small">{s.why}</span>
                      </td>
                      <td data-label="Last sale" className="sub">
                        <When iso={s.lastSaleAt} />
                      </td>
                      <td data-label="Last week" className="num">
                        {count(s.lastWeekSales)} · {money(s.lastWeekPesewas)}
                        <div className="small muted">usually {count(Math.round(s.usualWeekSales))}</div>
                      </td>
                      <td data-label="Last contact" className="sub">
                        {s.lastContactAt ? ago(s.lastContactAt) : <span className="warn">Never</span>}
                        <div>
                          <a className="small" href={href(`/shops/${encodeURIComponent(s.shopId)}`, { tab: 'contacts' })}>
                            Log a call
                          </a>
                        </div>
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
  )
}

function SettingUp() {
  const q = useApi('accounts:setup', (c, s) => api.setupProgress(c, s))
  return (
    <Card title="Setting up" sub="New shops, step by step from provisioned to trading — and any older shop still missing a step. Least far along first." flush>
      <Loadable q={q} rows={4}>
        {(shops) =>
          shops.length === 0 ? (
            <Empty title="No shop is part-way through setting up" />
          ) : (
            <div className="table-wrap">
              <table className="table cards">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>Progress</th>
                    <th>Next step</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((s) => {
                    const next = s.steps.find((x) => !x.done)
                    return (
                      <tr key={s.shopId}>
                        <td data-label="" className="primary-cell">
                          <a href={shopHref(s.shopId)}>{s.name}</a>
                          <div className="small muted">{s.owner ?? s.code ?? '—'}</div>
                        </td>
                        <td data-label="Progress">
                          <div className="row" style={{ gap: 4 }} aria-label={`${s.done} of ${s.steps.length} steps done`}>
                            {s.steps.map((x) => (
                              <span
                                key={x.key}
                                className={`dot ${x.done ? 'healthy' : 'muted'}`}
                                title={`${x.label}: ${x.detail}`}
                                style={x.done ? undefined : { background: 'var(--border)' }}
                              />
                            ))}
                            <span className="small sub" style={{ marginLeft: 6 }}>
                              {s.done} of {s.steps.length}
                            </span>
                          </div>
                        </td>
                        <td data-label="Next step">
                          {next ? (
                            <>
                              {next.label}
                              <div className="small muted">{next.detail}</div>
                            </>
                          ) : (
                            <span className="sub">All done</span>
                          )}
                        </td>
                        <td data-label="Joined" className="sub">
                          {s.daysIn === 0 ? 'Today' : `${s.daysIn} day${s.daysIn === 1 ? '' : 's'} ago`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </Card>
  )
}

export const SUBSCRIPTION_LABEL: Record<SubscriptionState, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  none: 'Not set up',
  paid: 'Paid',
}
export const SUBSCRIPTION_TONE: Record<SubscriptionState, string> = {
  overdue: 'offline',
  due_soon: 'attention',
  none: 'neutral',
  paid: 'healthy',
}

function Subscriptions() {
  const q = useApi('accounts:subs', (c, s) => api.subscriptionList(c, s))
  return (
    <Card title="Subscriptions" sub="What each shop pays and until when, most urgent first. Set one up, take a payment or send a reminder from the shop's Account tab." flush>
      <Loadable q={q} rows={5}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="No shops yet" />
          ) : (
            <div className="table-wrap">
              <table className="table cards">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>State</th>
                    <th>Plan</th>
                    <th>Paid until</th>
                    <th>Reminded</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.shopId}>
                      <td data-label="" className="primary-cell">
                        <a href={href(`/shops/${encodeURIComponent(r.shopId)}`, { tab: 'account' })}>{r.name}</a>
                        <div className="small muted">{r.code ?? '—'}</div>
                      </td>
                      <td data-label="State">
                        <span className={`badge ${SUBSCRIPTION_TONE[r.state]}`}>{SUBSCRIPTION_LABEL[r.state]}</span>
                      </td>
                      <td data-label="Plan">
                        {r.plan ? `${r.plan} · ${money(r.amountPesewas ?? 0)} a ${r.every}` : <span className="muted">—</span>}
                      </td>
                      <td data-label="Paid until" className="sub">
                        {r.paidUntil ? date(r.paidUntil) : '—'}
                      </td>
                      <td data-label="Reminded" className="sub">
                        {r.lastRemindedAt ? ago(r.lastRemindedAt) : '—'}
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
  )
}

function FollowUps() {
  const { client, canAct } = useSession()
  const q = useApi('accounts:followups', (c, s) => api.followUps(c, 30, s))
  const done = useAction(async (id: string) => {
    await api.completeFollowUp(client, id)
    invalidate('accounts')
    invalidate('contacts')
    invalidate('calendar')
  })
  return (
    <Card title="Follow-ups" sub="What we promised shops, due in the next 30 days or already late. Add one when you log a call on the shop's Contact log tab." flush>
      <Loadable q={q} rows={4}>
        {(list) =>
          list.length === 0 ? (
            <Empty title="Nothing promised" />
          ) : (
            <ul className="list">
              {list.map((f) => {
                const late = Date.parse(f.followUpAt) < Date.now()
                return (
                  <li key={f.id} className="spread" style={{ padding: '10px 16px', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <a href={href(`/shops/${encodeURIComponent(f.shopId)}`, { tab: 'contacts' })} style={{ fontWeight: 550 }}>
                        {f.shopName}
                      </a>
                      <div className="small">{f.summary}</div>
                      <div className={`small ${late ? 'warn' : 'muted'}`}>
                        {late ? 'Was due' : 'Due'} {date(f.followUpAt)}
                      </div>
                    </div>
                    {canAct && (
                      <button className="btn sm" disabled={done.pending} onClick={() => void done.run(f.id)}>
                        Done
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        }
      </Loadable>
    </Card>
  )
}
