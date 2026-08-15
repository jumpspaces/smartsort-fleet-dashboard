/**
 * The fleet over time — the only page here that is not a snapshot.
 *
 * Every other view answers "what is true now". None of them can answer the
 * question that decides where next month's work goes: is this getting better or
 * worse? The daily rollups were already being written and never read across
 * devices, so this page is mostly a matter of finally looking at them.
 *
 * On colour, which this design system is strict about: chroma means STATE here,
 * never series identity. So availability and takings are drawn in ink (they are
 * measurements, not verdicts), alerts are drawn in the status palette (they
 * genuinely are warnings and criticals), and the version mix — where several
 * series must be told apart — uses a light-to-dark neutral ramp rather than
 * inventing four hues that would each read as a fleet state. Versions are
 * ordered, so a sequential ramp is also the honest encoding: newest is darkest.
 */
import { useEffect, useState } from 'react'
import type { Api, FleetTrends, ShopSlo, TrendDay } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Button, Card, Chip, Empty, Notice, TableSkeleton } from '../components/ui.tsx'
import { bps, cedis, duration } from '../lib/format.ts'

/**
 * Sequential neutral steps, newest version darkest. Validated for adjacent
 * separation (worst pair ΔE 17.6 normal / 17.5 protan) — comfortably above the
 * floor, which matters because these segments touch each other.
 */
const VERSION_STEPS = ['#2b3129', '#5b6357', '#8f9789', '#c8cdc4']

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

export function Trends({
  api,
  reloadKey,
  onNavigate,
}: {
  api: Api
  reloadKey: number
  onNavigate: Navigate
}) {
  const [days, setDays] = useState(30)
  const [trends, setTrends] = useState<FleetTrends | null>(null)
  const [slo, setSlo] = useState<{ targetBps: number; shops: ShopSlo[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([api.trends(days), api.slo(days)])
      .then(([t, s]) => {
        if (!live) return
        setTrends(t)
        setSlo(s)
        setError(null)
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load the history'),
      )
    return () => {
      live = false
    }
  }, [api, days, reloadKey])

  const rows = trends?.days ?? []

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Trends</h1>
          <p className="view-sub">
            What the fleet has done, day by day, and whether that clears the promise we make about
            it.
          </p>
        </div>
        <div className="filters" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className="key"
              aria-pressed={days === r.days}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {trends == null ? (
        <section className="panel">
          <TableSkeleton rows={4} />
        </section>
      ) : rows.length === 0 ? (
        <section className="panel" style={{ padding: 16 }}>
          <Empty icon="trend" title="No history yet">
            Daily figures are rolled up from the terminals' own check-ins. The first full day
            appears here tomorrow.
          </Empty>
        </section>
      ) : (
        <>
          <div className="kpis">
            <Stat
              label={`Availability · ${days}d`}
              value={bps(trends.summary.uptimeBps, 2)}
              previous={trends.summary.previousUptimeBps}
              current={trends.summary.uptimeBps}
              note={slo ? `Target ${bps(slo.targetBps, 2)}` : undefined}
            />
            <Stat
              label={`Takings · ${days}d`}
              value={cedis(trends.summary.salesPesewas)}
              previous={trends.summary.previousSalesPesewas}
              current={trends.summary.salesPesewas}
            />
            <Stat
              label={`Alerts raised · ${days}d`}
              value={String(trends.summary.alertsOpened)}
              previous={trends.summary.previousAlertsOpened}
              current={trends.summary.alertsOpened}
              // Fewer alerts is the good direction, unlike everything beside it.
              lowerIsBetter
            />
          </div>

          <Card title="Availability">
            <DayLine
              rows={rows}
              value={(d) => (d.uptimeBps == null ? null : d.uptimeBps / 100)}
              format={(v) => `${v.toFixed(1)}%`}
              threshold={slo ? slo.targetBps / 100 : null}
              thresholdLabel="target"
            />
            <p className="hint">
              Mean across every terminal reporting that day. A day below the line is a day somebody
              could not sell.
            </p>
          </Card>

          <Card title="Alerts raised">
            <DayBars rows={rows} />
          </Card>

          <Card title="Version mix">
            <VersionMix trends={trends} />
          </Card>

          <Card
            title="Availability by shop"
            actions={
              slo ? <Chip tone="idle">Target {bps(slo.targetBps, 2)}</Chip> : undefined
            }
          >
            {slo == null ? (
              <TableSkeleton rows={3} />
            ) : slo.shops.length === 0 ? (
              <p className="muted small">No shop has enough history yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th className="col-num">Availability</th>
                      <th>Error budget</th>
                      <th className="col-num">Left</th>
                      <th className="col-num">Worst day</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {slo.shops.map((s) => (
                      <tr key={s.shopId ?? 'unclaimed'}>
                        <td>
                          <span className="strong">{s.shopName ?? 'Unclaimed terminals'}</span>
                          <div className="row-sub">
                            {s.devices} terminal{s.devices === 1 ? '' : 's'} · {s.days} days
                          </div>
                        </td>
                        <td className="col-num">
                          {s.breaching ? (
                            <Chip tone="bad">{bps(s.uptimeBps)}</Chip>
                          ) : (
                            <span>{bps(s.uptimeBps)}</span>
                          )}
                        </td>
                        <td>
                          {/* The budget, not the percentage: "99.2%" starts an
                              argument about whether that is good. "No minutes
                              left" does not. */}
                          <div
                            className="budget"
                            data-over={s.budgetUsedPct > 100 || undefined}
                            data-near={
                              (s.budgetUsedPct > 75 && s.budgetUsedPct <= 100) || undefined
                            }
                            role="img"
                            aria-label={`${s.budgetUsedPct}% of the allowed downtime used`}
                          >
                            <span style={{ width: `${Math.min(100, s.budgetUsedPct)}%` }} />
                          </div>
                          <div className="row-sub">{s.budgetUsedPct}% spent</div>
                        </td>
                        <td className="col-num">
                          {s.budgetMinutesLeft > 0 ? (
                            duration(s.budgetMinutesLeft * 60_000)
                          ) : (
                            <span className="bad-text">none</span>
                          )}
                        </td>
                        <td className="col-num muted">
                          {s.worstDay ? `${bps(s.worstDay.uptimeBps, 0)}` : '—'}
                          {s.worstDay && <div className="row-sub">{s.worstDay.day.slice(5)}</div>}
                        </td>
                        <td style={{ width: 1 }}>
                          {s.shopId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onNavigate('shop', { id: s.shopId! })}
                            >
                              Open
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------------- tiles */

function Stat({
  label,
  value,
  current,
  previous,
  note,
  lowerIsBetter,
}: {
  label: string
  value: string
  current: number | null
  previous: number | null
  note?: string
  lowerIsBetter?: boolean
}) {
  // A number with nothing to compare it against is a shape, not a direction.
  const delta =
    current == null || previous == null || previous === 0
      ? null
      : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
  const better = delta == null ? null : lowerIsBetter ? delta < 0 : delta > 0

  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {delta != null && (
        <span className="delta" data-dir={better ? 'up' : delta === 0 ? undefined : 'down'}>
          {delta > 0 ? '+' : ''}
          {delta}% vs the period before
        </span>
      )}
      {note && <span className="kpi-note">{note}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ charts */

const W = 720
const H = 150
const PAD = { top: 10, right: 8, bottom: 20, left: 38 }

/**
 * One measure over days, with an optional threshold line.
 *
 * Hover is not decoration on a chart like this: the shape says "something
 * happened around the 12th" and the only useful next question is what the
 * number was, so every chart here carries a readout.
 */
function DayLine({
  rows,
  value,
  format,
  threshold,
  thresholdLabel,
}: {
  rows: TrendDay[]
  value: (d: TrendDay) => number | null
  format: (v: number) => string
  threshold?: number | null
  thresholdLabel?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const points = rows.map(value)
  const live = points.filter((p): p is number => p != null)
  if (live.length < 2) return <p className="muted small">Not enough days yet.</p>

  const max = Math.max(...live, threshold ?? -Infinity)
  const min = Math.min(...live, threshold ?? Infinity)
  const span = max - min || 1
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / Math.max(1, rows.length - 1)) * plotW
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH

  const d = points
    .map((v, i) => (v == null ? null : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ')
    .replace(/L/, 'M')

  const at = hover != null ? rows[hover] : null
  const atValue = hover != null ? points[hover] : null

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily readings from ${rows[0]?.day} to ${rows.at(-1)?.day}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Two gridlines only: the extremes. A chart of this height cannot
            carry more without the grid competing with the data. */}
        {[max, min].map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text x={4} y={y(v) + 4} fontSize="10" fill="var(--ink-faint)">
              {format(v)}
            </text>
          </g>
        ))}

        {threshold != null && threshold >= min && threshold <= max && (
          <>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(threshold)}
              y2={y(threshold)}
              stroke="var(--bad-mark)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <text x={W - PAD.right} y={y(threshold) - 4} fontSize="10" textAnchor="end" fill="var(--bad)">
              {thresholdLabel}
            </text>
          </>
        )}

        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />

        {/* Only the days that broke the promise get a mark. A dot on every
            point would be a chart shouting every value at once. */}
        {points.map((v, i) =>
          v != null && threshold != null && v < threshold ? (
            <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--bad-mark)" />
          ) : null,
        )}

        {hover != null && atValue != null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--line-strong)"
              strokeWidth="1"
            />
            <circle cx={x(hover)} cy={y(atValue)} r="4" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
          </>
        )}

        {/* Invisible hit areas, wider than the marks they select. */}
        {rows.map((_, i) => (
          <rect
            key={i}
            x={x(i) - plotW / rows.length / 2}
            y={PAD.top}
            width={plotW / rows.length}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        <text x={PAD.left} y={H - 4} fontSize="10" fill="var(--ink-faint)">
          {rows[0]?.day.slice(5)}
        </text>
        <text x={W - PAD.right} y={H - 4} fontSize="10" textAnchor="end" fill="var(--ink-faint)">
          {rows.at(-1)?.day.slice(5)}
        </text>
      </svg>

      <div className="chart-legend">
        {at ? (
          <span>
            <b>{at.day}</b> · {atValue != null ? format(atValue) : 'no reading'} ·{' '}
            {at.devices} terminal{at.devices === 1 ? '' : 's'} reporting
          </span>
        ) : (
          <span className="muted">Hover a day for its numbers.</span>
        )}
      </div>
    </div>
  )
}

/** Alerts per day, split by severity — genuinely a status encoding. */
function DayBars({ rows }: { rows: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...rows.map((r) => r.alertsOpened))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / rows.length
  const barW = Math.max(2, Math.min(18, slot - 3))

  if (rows.every((r) => r.alertsOpened === 0)) {
    return <p className="muted small">No alerts were raised in this period.</p>
  }

  const at = hover != null ? rows[hover] : null

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Alerts raised per day, warnings and criticals"
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="var(--line)"
        />
        <text x={4} y={PAD.top + 8} fontSize="10" fill="var(--ink-faint)">
          {max}
        </text>

        {rows.map((r, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2
          const critH = (r.criticalOpened / max) * plotH
          const warnH = ((r.alertsOpened - r.criticalOpened) / max) * plotH
          return (
            <g key={r.day} onMouseEnter={() => setHover(i)}>
              {/* Criticals sit on the baseline; the 2px gap keeps the two
                  segments from reading as one block. */}
              <rect
                x={x}
                y={H - PAD.bottom - critH}
                width={barW}
                height={Math.max(0, critH)}
                rx="2"
                fill="var(--bad-mark)"
              />
              <rect
                x={x}
                y={H - PAD.bottom - critH - warnH - (critH > 0 && warnH > 0 ? 2 : 0)}
                width={barW}
                height={Math.max(0, warnH)}
                rx="2"
                fill="var(--warn-mark)"
              />
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
              />
            </g>
          )
        })}

        <text x={PAD.left} y={H - 4} fontSize="10" fill="var(--ink-faint)">
          {rows[0]?.day.slice(5)}
        </text>
        <text x={W - PAD.right} y={H - 4} fontSize="10" textAnchor="end" fill="var(--ink-faint)">
          {rows.at(-1)?.day.slice(5)}
        </text>
      </svg>

      <div className="chart-legend">
        <span className="chart-key">
          <i style={{ background: 'var(--bad-mark)' }} /> Critical
        </span>
        <span className="chart-key">
          <i style={{ background: 'var(--warn-mark)' }} /> Warning
        </span>
        {at && (
          <span>
            <b>{at.day}</b> · {at.alertsOpened} raised ({at.criticalOpened} critical)
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Which builds the fleet was actually running, day by day — a rollout's spread
 * as it happened, rather than the one number the overview strip can show.
 */
function VersionMix({ trends }: { trends: FleetTrends }) {
  const byDay = new Map<string, { version: string; devices: number }[]>()
  for (const v of trends.versions) {
    const list = byDay.get(v.day)
    if (list) list.push(v)
    else byDay.set(v.day, [v])
  }
  const days = [...byDay.keys()].sort()
  if (days.length === 0) return <p className="muted small">No version history yet.</p>

  // The versions worth their own step, newest first; everything else folds into
  // one band rather than becoming a fifth, sixth, seventh shade nobody can tell
  // apart.
  const totals = new Map<string, number>()
  for (const v of trends.versions) totals.set(v.version, (totals.get(v.version) ?? 0) + v.devices)
  const top = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VERSION_STEPS.length - 1)
    .map(([version]) => version)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

  const colourOf = (version: string) => {
    const i = top.indexOf(version)
    return i === -1 ? VERSION_STEPS.at(-1)! : VERSION_STEPS[i]!
  }

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / days.length
  const barW = Math.max(2, Math.min(18, slot - 3))

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Share of terminals on each version, by day"
      >
        {days.map((day, i) => {
          const entries = (byDay.get(day) ?? []).slice().sort((a, b) =>
            b.version.localeCompare(a.version, undefined, { numeric: true }),
          )
          const total = entries.reduce((s, e) => s + e.devices, 0) || 1
          let cursor = H - PAD.bottom
          return (
            <g key={day}>
              {entries.map((e) => {
                const h = (e.devices / total) * plotH
                cursor -= h
                return (
                  <rect
                    key={e.version}
                    x={PAD.left + i * slot + (slot - barW) / 2}
                    y={cursor}
                    width={barW}
                    height={Math.max(0, h - 2)}
                    rx="2"
                    fill={colourOf(e.version)}
                  >
                    <title>{`${day} — ${e.version}: ${e.devices} terminal(s)`}</title>
                  </rect>
                )
              })}
            </g>
          )
        })}
        <text x={PAD.left} y={H - 4} fontSize="10" fill="var(--ink-faint)">
          {days[0]?.slice(5)}
        </text>
        <text x={W - PAD.right} y={H - 4} fontSize="10" textAnchor="end" fill="var(--ink-faint)">
          {days.at(-1)?.slice(5)}
        </text>
      </svg>

      {/* Contrast on the pale steps is deliberately below 3:1, so identity never
          rests on the fill alone — the legend names every band. */}
      <div className="chart-legend">
        {top.map((v) => (
          <span key={v} className="chart-key">
            <i style={{ background: colourOf(v) }} />
            <span className="mono">{v}</span>
          </span>
        ))}
        <span className="chart-key">
          <i style={{ background: VERSION_STEPS.at(-1) }} /> Other
        </span>
      </div>
    </div>
  )
}
