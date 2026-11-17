import { useState } from 'react'
import * as api from '../api/endpoints.ts'
import { ActionError } from '../components/forms.tsx'
import { saveCsv } from '../lib/csv.ts'
import { Bars } from '../components/Bars.tsx'
import { Card, Empty, Live, Loadable, PageHeader, Segmented, When } from '../components/ui.tsx'
import { useApi, useCommandCatalogue, useShops } from '../data.ts'
import { ago, bytes, count, date, duration, money, pct, plural } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { shopHref, tillHref, useSetParams } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'
import { COMMAND_STATE_SHORT, outcomeLine } from '../lib/commands.ts'

/* ============================================================ remote fixes */

const CMD_STATES = ['all', 'awaiting_approval', 'pending', 'sent', 'done', 'failed', 'expired'] as const
const CMD_LABEL: Record<string, string> = COMMAND_STATE_SHORT

export function Fixes({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const catalogue = useCommandCatalogue()
  const shops = useShops()
  const state = (CMD_STATES as readonly string[]).includes(params.get('state') ?? '') ? params.get('state')! : 'all'
  const command = params.get('command') ?? ''
  const shopId = params.get('shop') ?? ''
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0)
  const PAGE = 50
  const history = useApi(
    `commands:history:${state}:${command}:${shopId}:${page}`,
    (c, s) =>
      api.commandHistory(
        c,
        { state: state === 'all' ? undefined : state, command: command || undefined, shopId: shopId || undefined, limit: PAGE, offset: page * PAGE },
        s,
      ),
    { every: 20_000 },
  )
  const label = (name: string) => catalogue.data?.find((s) => s.name === name)?.label ?? name
  const { client } = useSession()
  const exportFixes = useAction(async () => {
    const all = await api.allCommandHistory(client, {
      state: state === 'all' ? undefined : state,
      command: command || undefined,
      shopId: shopId || undefined,
    })
    saveCsv('remote-fixes', all, [
      { header: 'Fix', value: (c) => label(c.command) },
      { header: 'Device ID', value: (c) => c.deviceId },
      { header: 'Shop', value: (c) => c.shopName },
      { header: 'Outcome', value: (c) => CMD_LABEL[c.state] },
      { header: 'Detail', value: (c) => c.error ?? c.result },
      { header: 'Sent by', value: (c) => c.issuedByLabel },
      { header: 'Sent at', value: (c) => c.issuedAt },
    ])
  })

  return (
    <div className="stack">
      <PageHeader
        title="Remote fixes"
        sub="Every fix sent to a till, and what came of it."
        actions={
          <>
            <Live updatedAt={history.updatedAt} busy={history.refreshing} />
            <button
              className="btn sm"
              disabled={!history.data?.commands.length || exportFixes.pending}
              onClick={() => void exportFixes.run()}
            >
              Download CSV
            </button>
          </>
        }
      />
      <ActionError error={exportFixes.error} />
      <div className="row">
        <Segmented
          label="Fix state"
          value={state}
          onChange={(v) => setParams({ state: v === 'all' ? null : v, page: null })}
          options={CMD_STATES.map((s) => ({ value: s, label: s === 'all' ? 'All' : CMD_LABEL[s] }))}
        />
        <select className="select" aria-label="Fix" value={command} onChange={(e) => setParams({ command: e.target.value || null, page: null })}>
          <option value="">Any fix</option>
          {(catalogue.data ?? []).map((s) => (
            <option key={s.name} value={s.name}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Shop" value={shopId} onChange={(e) => setParams({ shop: e.target.value || null, page: null })}>
          <option value="">Any shop</option>
          {(shops.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <Card flush>
        <Loadable q={history} rows={8}>
          {(p) =>
            p.commands.length === 0 ? (
              <Empty title="No fixes match" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Fix</th>
                        <th>Till</th>
                        <th>Outcome</th>
                        <th>Sent by</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.commands.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 550 }}>{label(c.command)}</td>
                          <td>
                            <a href={tillHref(c.deviceId)} className="mono">
                              {c.deviceId.slice(0, 12)}
                            </a>
                            {c.shopId && (
                              <div className="small">
                                <a href={shopHref(c.shopId)} className="sub">
                                  {c.shopName ?? 'Shop'}
                                </a>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${c.state === 'done' ? 'healthy' : c.state === 'failed' ? 'offline' : c.state === 'expired' ? 'neutral' : 'attention'}`}>
                              {CMD_LABEL[c.state]}
                            </span>
                            {outcomeLine(c) && (
                              <div className="small muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>
                                {(outcomeLine(c) ?? '').slice(0, 240)}
                              </div>
                            )}
                            {c.state === 'awaiting_approval' && (
                              <div className="small">
                                <a href={tillHref(c.deviceId)}>Review and approve</a>
                              </div>
                            )}
                          </td>
                          <td className="sub">{c.issuedByLabel ?? '—'}</td>
                          <td className="sub">
                            <When iso={c.issuedAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager offset={p.offset} shown={p.commands.length} total={p.total} page={page} onPage={(n) => setParams({ page: n || null })} />
              </>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}

function Pager({ offset, shown, total, page, onPage }: { offset: number; shown: number; total: number; page: number; onPage: (n: number) => void }) {
  return (
    <div className="pager">
      <span className="num">
        {count(offset + 1)}–{count(offset + shown)} of {count(total)}
      </span>
      <span className="row">
        <button className="btn sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn sm" disabled={offset + shown >= total} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </span>
    </div>
  )
}

/* ================================================================ history */

const RANGES = ['7', '30', '90'] as const

function delta(now: number | null, before: number | null, fmt: (n: number) => string, higherIsBetter = true) {
  if (now == null || before == null) return null
  const d = now - before
  if (d === 0) return <span className="muted">same as before</span>
  const good = higherIsBetter ? d > 0 : d < 0
  return (
    <span style={{ color: good ? 'var(--ok)' : 'var(--bad)' }}>
      {d > 0 ? '+' : '−'}
      {fmt(Math.abs(d))} vs previous
    </span>
  )
}

export function History({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const { canAct } = useSession()
  const days = Number((RANGES as readonly string[]).includes(params.get('days') ?? '') ? params.get('days') : 30)
  const trends = useApi(`trends:${days}`, (c, s) => api.trends(c, days, s), { every: 300_000 })
  const slo = useApi(`slo:${days}`, (c, s) => api.slo(c, days, s), { every: 300_000 })
  const versions = useApi('versions', (c, s) => api.versionScores(c, s), { every: 300_000 })
  const worst = useApi(`worst:${days}`, (c, s) => api.worst(c, days, s), { every: 300_000 })
  const pressure = useApi('sync-pressure', (c, s) => api.syncPressure(c, s), { every: 60_000 })
  const digest = useApi('digest', (c, s) => api.digest(c, s))
  const { client } = useSession()
  const send = useAction(async () => {
    await api.sendDigest(client)
    invalidate('digest')
  })

  const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHeader
        title="History"
        sub="How the fleet has done over time."
        actions={
          <Segmented
            label="Range"
            value={String(days)}
            onChange={(v) => setParams({ days: v === '30' ? null : v })}
            options={RANGES.map((r) => ({ value: r, label: `${r} days` }))}
          />
        }
      />

      <Loadable q={trends} rows={3}>
        {(t) => (
          <>
            <div className="stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div className="card stat">
                <div className="stat-label">Time connected</div>
                <div className="stat-value">{pct(t.summary.uptimeBps)}</div>
                <div className="stat-note">{delta(t.summary.uptimeBps, t.summary.previousUptimeBps, (n) => pct(n))}</div>
              </div>
              <div className="card stat">
                <div className="stat-label">Sales recorded</div>
                <div className="stat-value" style={{ fontSize: 20 }}>
                  {money(t.summary.salesPesewas)}
                </div>
                <div className="stat-note">{delta(t.summary.salesPesewas, t.summary.previousSalesPesewas, (n) => money(n))}</div>
              </div>
              <div className="card stat">
                <div className="stat-label">Alerts raised</div>
                <div className="stat-value">{count(t.summary.alertsOpened)}</div>
                <div className="stat-note">{delta(t.summary.alertsOpened, t.summary.previousAlertsOpened, (n) => count(n), false)}</div>
              </div>
            </div>
            <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Card title="Time connected, by day">
                <Bars
                  label="Daily connected time"
                  format={(n) => pct(n, 1)}
                  points={t.days.map((d) => ({ key: d.day, value: d.uptimeBps, label: short(d.day) }))}
                />
              </Card>
              <Card title="Sales, by day">
                <Bars
                  label="Daily sales"
                  format={(n) => money(n)}
                  points={t.days.map((d) => ({ key: d.day, value: d.salesPesewas, label: short(d.day) }))}
                />
              </Card>
              <Card title="Alerts raised, by day">
                <Bars
                  label="Daily alerts"
                  format={(n) => count(n)}
                  points={t.days.map((d) => ({ key: d.day, value: d.alertsOpened, label: short(d.day) }))}
                />
              </Card>
              <Card title="Tills backed up, by day">
                <Bars
                  label="Daily backed-up tills"
                  format={(n) => count(n)}
                  points={t.days.map((d) => ({ key: d.day, value: d.backedUp, label: short(d.day) }))}
                />
              </Card>
            </div>
          </>
        )}
      </Loadable>

      <Loadable q={trends} rows={2}>
        {(t) => <VersionAdoption rows={t.versions} short={short} />}
      </Loadable>

      <Card title="Shops against the uptime target" sub="Who is using up their allowance of downtime." flush>
        <Loadable q={slo} rows={4}>
          {(s) =>
            s.shops.length === 0 ? (
              <Empty title="No shops reporting" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th className="r">Tills</th>
                      <th className="r">Connected</th>
                      <th>Downtime allowance used</th>
                      <th>Worst day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.shops]
                      .sort((a, b) => b.budgetUsedPct - a.budgetUsedPct)
                      .map((r) => (
                        <tr key={r.shopId ?? 'none'}>
                          <td className="primary-cell">
                            {r.shopId ? <a href={shopHref(r.shopId)}>{r.shopName ?? 'Shop'}</a> : 'Not linked'}
                          </td>
                          <td className="r num">{count(r.devices)}</td>
                          <td className="r num">{pct(r.uptimeBps)}</td>
                          <td style={{ minWidth: 180 }}>
                            <div className={`meter${r.breaching ? ' bad' : r.budgetUsedPct > 75 ? ' warn' : ''}`}>
                              <span style={{ width: `${Math.min(100, r.budgetUsedPct)}%` }} />
                            </div>
                            <div className="small muted">
                              {Math.round(r.budgetUsedPct)}% used
                              {r.breaching ? ' · below target' : ` · ${duration(r.budgetMinutesLeft * 60_000)} left`}
                            </div>
                          </td>
                          <td className="sub">{r.worstDay ? `${short(r.worstDay.day)} · ${pct(r.worstDay.uptimeBps, 1)}` : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </Card>

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="Versions" sub="How clean each version is running." flush>
          <Loadable q={versions} rows={4}>
            {(list) =>
              list.length === 0 ? (
                <Empty title="No versions reported" />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th className="r">Tills</th>
                        <th className="r">Problem-free</th>
                        <th className="r">Problems</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((v) => (
                        <tr key={v.version}>
                          <td className="mono">{v.version}</td>
                          <td className="r num">{count(v.devices)}</td>
                          <td className="r num">{Math.round(v.cleanPct)}%</td>
                          <td className="r num">{count(v.faultGroups)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loadable>
        </Card>
        <Card title="Least connected tills" sub={`Over ${days} days`} flush>
          <Loadable q={worst} rows={4}>
            {(list) =>
              list.length === 0 ? (
                <Empty title="Nothing to show" />
              ) : (
                <ul className="list">
                  {list.map((w) => (
                    <li key={w.deviceId}>
                      <div className="spread">
                        <a href={tillHref(w.deviceId)} className="mono">
                          {w.deviceId.slice(0, 12)}
                        </a>
                        <span className="num">{pct(w.uptimeBps)}</span>
                      </div>
                      <div className="small muted">
                        {w.shopName ?? 'Not linked'} · down {Math.round(w.downtimeHours)}h
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loadable>
        </Card>
      </div>

      <Card title="Tills with sales waiting to send" sub="Biggest backlog first." flush>
        <Loadable q={pressure} rows={3}>
          {(list) =>
            list.length === 0 ? (
              <Empty title="No backlog anywhere" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Till</th>
                      <th className="r">Waiting</th>
                      <th className="r">Failed</th>
                      <th>Oldest</th>
                      <th>Last received</th>
                      <th>Last check-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((d) => (
                      <tr key={d.deviceId}>
                        <td className="primary-cell">
                          <a href={tillHref(d.deviceId)} className="mono">
                            {d.deviceId.slice(0, 12)}
                          </a>
                          <div className="small muted">{d.shopName ?? 'Not linked'}</div>
                        </td>
                        <td className="r num">{count(d.syncPending)}</td>
                        <td className="r num">{count(d.syncFailed)}</td>
                        <td className="sub">{d.oldestPendingAgeMs ? duration(d.oldestPendingAgeMs) : '—'}</td>
                        <td className="sub">{ago(d.lastPulledAt)}</td>
                        <td className="sub">{ago(d.lastReportAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </Card>

      <Card
        title="Daily summary"
        sub="The message sent to the team each morning."
        actions={
          canAct && (
            <button className="btn sm" disabled={send.pending} onClick={() => void send.run()}>
              {send.pending ? 'Sending…' : 'Send it now'}
            </button>
          )
        }
      >
        <Loadable q={digest} rows={3}>
          {(d) => (
            <div className="stack" style={{ gap: 8 }}>
              <div className="small muted">For {date(d.day)}</div>
              {d.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              <ActionError error={send.error} />
            </div>
          )}
        </Loadable>
      </Card>
    </div>
  )
}

/**
 * Which version the fleet ran each day, as a share of tills. Grey shades, not
 * hues — colour means state in this console, and a version isn't one.
 */
function VersionAdoption({ rows, short }: { rows: { day: string; version: string; devices: number }[]; short: (d: string) => string }) {
  if (rows.length === 0) return null
  const days = [...new Set(rows.map((r) => r.day))].sort()
  // Newest versions darkest; at most five named, the rest pooled as "older".
  const byVersion = new Map<string, number>()
  for (const r of rows) byVersion.set(r.version, (byVersion.get(r.version) ?? 0) + r.devices)
  const versions = [...byVersion.keys()].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const named = versions.slice(0, 5)
  const key = (v: string) => (named.includes(v) ? v : 'older')
  const legend = versions.length > 5 ? [...named, 'older'] : named
  const shade = (i: number) => `color-mix(in srgb, var(--ink) ${Math.max(15, 90 - i * 18)}%, var(--surface))`
  return (
    <Card title="Versions in use, by day" sub="Share of reporting tills on each version.">
      <div className="bars">
        <div className="bars-plot" style={{ height: 96 }} role="img" aria-label="Version share by day">
          {days.map((day) => {
            const today = rows.filter((r) => r.day === day)
            const total = today.reduce((s, r) => s + r.devices, 0) || 1
            const parts = legend.map((v) => ({ v, n: today.filter((r) => key(r.version) === v).reduce((s, r) => s + r.devices, 0) }))
            return (
              <span key={day} title={`${short(day)}: ${parts.filter((p) => p.n).map((p) => `${p.v} ${p.n}`).join(', ')}`}>
                <span className="stack-bar">
                  {parts.map((p, i) => (
                    <i key={p.v} style={{ height: `${(p.n / total) * 100}%`, background: shade(i) }} />
                  ))}
                </span>
              </span>
            )
          })}
        </div>
        <div className="strip-axis">
          <span>{short(days[0]!)}</span>
          <span>{short(days[days.length - 1]!)}</span>
        </div>
        <div className="row small" style={{ gap: 12, marginTop: 6 }}>
          {legend.map((v, i) => (
            <span key={v} className="row" style={{ gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: shade(i), display: 'inline-block' }} />
              <span className="mono">{v}</span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

/* ================================================================ backups */

export function Backups() {
  const list = useApi('backups', (c, s) => api.backups(c, s), { every: 120_000 })
  return (
    <div className="stack">
      <PageHeader
        title="Backups"
        sub="Each till keeps its own copy of its data. Oldest backup first."
        actions={
          <>
            <Live updatedAt={list.updatedAt} busy={list.refreshing} />
            <button
              className="btn sm"
              disabled={!list.data?.length}
              onClick={() =>
                saveCsv('backups', list.data ?? [], [
                  { header: 'Device ID', value: (b) => b.deviceId },
                  { header: 'Shop', value: (b) => b.shopName },
                  { header: 'Last backup', value: (b) => b.lastBackupAt ?? 'never' },
                  { header: 'Backup bytes', value: (b) => b.backupSizeBytes },
                  { header: 'Data bytes', value: (b) => b.dbSizeBytes },
                  { header: 'Backup error', value: (b) => b.backupError },
                  { header: 'Last check-in', value: (b) => b.lastReportAt },
                ])
              }
            >
              Download CSV
            </button>
          </>
        }
      />
      <Card flush>
        <Loadable q={list} rows={8}>
          {(rows) => {
            const sorted = [...rows].sort((a, b) => (a.lastBackupAt ?? '').localeCompare(b.lastBackupAt ?? ''))
            const never = rows.filter((r) => !r.lastBackupAt).length
            return rows.length === 0 ? (
              <Empty title="No tills reporting" />
            ) : (
              <>
                {never > 0 && (
                  <div style={{ padding: '12px 16px 0' }}>
                    <div className="notice warn">{plural(never, 'till')} have never made a backup.</div>
                  </div>
                )}
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Till</th>
                        <th>Last backup</th>
                        <th className="r">Backup size</th>
                        <th className="r">Data size</th>
                        <th>Last check-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((b) => (
                        <tr key={b.deviceId}>
                          <td className="primary-cell">
                            <a href={tillHref(b.deviceId)} className="mono">
                              {b.deviceId.slice(0, 12)}
                            </a>
                            <div className="small muted">{b.shopName ?? 'Not linked'}</div>
                          </td>
                          <td>
                            {b.lastBackupAt ? <When iso={b.lastBackupAt} /> : <span className="badge attention">Never</span>}
                            {b.backupError && <div className="small" style={{ color: 'var(--bad)' }}>{b.backupError}</div>}
                          </td>
                          <td className="r num">{bytes(b.backupSizeBytes)}</td>
                          <td className="r num">{bytes(b.dbSizeBytes)}</td>
                          <td className="sub">
                            <When iso={b.lastReportAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }}
        </Loadable>
      </Card>
    </div>
  )
}

/* ========================================================== records check */

export function Records() {
  const list = useApi('quality', (c, s) => api.quality(c, s), { every: 300_000 })
  return (
    <div className="stack">
      <PageHeader
        title="Records check"
        sub="Shops whose books need tidying — the kind of thing to raise on the next call."
        actions={
          <>
            <Live updatedAt={list.updatedAt} busy={list.refreshing} />
            <button
              className="btn sm"
              disabled={!list.data?.length}
              onClick={() =>
                saveCsv('records-check', list.data ?? [], [
                  { header: 'Shop', value: (r) => r.shopName },
                  { header: 'Sold more than stocked', value: (r) => r.oversold },
                  { header: 'Expired batches', value: (r) => r.expiredLots },
                  { header: 'Expired units', value: (r) => r.expiredUnits },
                  { header: 'Selling at a loss', value: (r) => r.losingMoney },
                  { header: 'Shifts left open', value: (r) => r.staleShifts },
                  { header: 'Oldest open shift (hours)', value: (r) => r.oldestShiftHours },
                ])
              }
            >
              Download CSV
            </button>
          </>
        }
      />
      <Card flush>
        <Loadable q={list} rows={8}>
          {(rows) => {
            const flagged = rows.filter((r) => r.issues > 0).sort((a, b) => b.issues - a.issues)
            return flagged.length === 0 ? (
              <Empty title="Every shop's records look tidy" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th className="r" title="Products sold below zero on the shelf">
                        Sold more than stocked
                      </th>
                      <th className="r">Expired still on shelf</th>
                      <th className="r" title="Products selling below cost">
                        Selling at a loss
                      </th>
                      <th className="r">Shifts left open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map((r) => (
                      <tr key={r.shopId}>
                        <td className="primary-cell">
                          <a href={shopHref(r.shopId)}>{r.shopName}</a>
                        </td>
                        <td className="r num">{r.oversold || <span className="muted">0</span>}</td>
                        <td className="r num">
                          {r.expiredLots ? (
                            <>
                              {count(r.expiredUnits)} units
                              <div className="small muted">{plural(r.expiredLots, 'batch', 'batches')}</div>
                            </>
                          ) : (
                            <span className="muted">0</span>
                          )}
                        </td>
                        <td className="r num">{r.losingMoney || <span className="muted">0</span>}</td>
                        <td className="r num">
                          {r.staleShifts ? (
                            <>
                              {r.staleShifts}
                              {r.oldestShiftHours != null && <div className="small muted">oldest {Math.round(r.oldestShiftHours)}h</div>}
                            </>
                          ) : (
                            <span className="muted">0</span>
                          )}
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
    </div>
  )
}

/* =========================================================== activity log */

const AUDIT_LIMITS = ['100', '500', '2000'] as const

export function Activity({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const limit = Number((AUDIT_LIMITS as readonly string[]).includes(params.get('n') ?? '') ? params.get('n') : 100)
  const [q, setQ] = useState('')
  const log = useApi(`audit:${limit}`, (c, s) => api.audit(c, limit, s), { every: 60_000 })
  return (
    <div className="stack">
      <PageHeader
        title="Activity log"
        sub="Who did what in this console. Every change is recorded."
        actions={
          <>
            <Live updatedAt={log.updatedAt} busy={log.refreshing} />
            <button
              className="btn sm"
              disabled={!log.data?.length}
              onClick={() =>
                saveCsv('activity-log', log.data ?? [], [
                  { header: 'When', value: (r) => r.createdAt },
                  { header: 'Who', value: (r) => r.actorLabel ?? 'system' },
                  { header: 'Action', value: (r) => r.action },
                  { header: 'Target type', value: (r) => r.targetType },
                  { header: 'Target', value: (r) => r.targetId },
                  { header: 'Details', value: (r) => (r.detail == null ? '' : JSON.stringify(r.detail)) },
                  { header: 'IP', value: (r) => r.ip },
                ])
              }
            >
              Download CSV
            </button>
          </>
        }
      />
      <div className="spread">
        <Segmented
          label="How many"
          value={String(limit)}
          onChange={(v) => setParams({ n: v === '100' ? null : v })}
          options={AUDIT_LIMITS.map((n) => ({ value: n, label: `Last ${n}` }))}
        />
        <label className="search">
          <span className="sr-only">Filter</span>
          <input className="input" style={{ paddingLeft: 10, width: '100%' }} placeholder="Filter by person or action" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <Card flush>
        <Loadable q={log} rows={10}>
          {(rows) => {
            const n = q.trim().toLowerCase()
            const list = n
              ? rows.filter((r) => [r.actorLabel, r.action, r.targetId, r.targetType].some((v) => v?.toLowerCase().includes(n)))
              : rows
            return list.length === 0 ? (
              <Empty title="Nothing recorded" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Action</th>
                      <th>On</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="sub">
                          <When iso={r.createdAt} />
                        </td>
                        <td>{r.actorLabel ?? <span className="muted">system</span>}</td>
                        <td className="mono">{r.action}</td>
                        <td className="small">
                          {r.targetType === 'device' && r.targetId ? (
                            <a href={tillHref(r.targetId)}>till</a>
                          ) : r.targetType === 'shop' && r.targetId ? (
                            <a href={shopHref(r.targetId)}>shop</a>
                          ) : (
                            <span className="muted">{r.targetType ?? '—'}</span>
                          )}
                        </td>
                        <td className="mono small muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>
                          {r.detail == null ? '' : JSON.stringify(r.detail)}
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
    </div>
  )
}
