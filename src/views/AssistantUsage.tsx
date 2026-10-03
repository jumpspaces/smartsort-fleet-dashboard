import { useCallback, useEffect, useState } from 'react'
import { Unauthorized, type Api, type FleetAssistantUsage, type ReportPeriod } from '../api.ts'
import { Button, Notice } from '../components/ui.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { downloadCsv, toCsv } from '../lib/csv.ts'
import { compactCount, exact, timeAgo, usd } from '../lib/format.ts'
import { buildHash } from '../lib/route.ts'
import { describeRule } from './LimitsEditor.tsx'

const MODEL_LABEL: Record<string, string> = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-haiku-4-5': 'Haiku 4.5',
}

export const PERIOD_OPTIONS: { id: ReportPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '30d', label: 'Last 30 days' },
]

/**
 * Settings → Assistant usage: AI spend and tokens, fleet-wide and shop by shop,
 * over a chosen period, with each shop's nearest limit. Estimates from list
 * prices — good for spotting a heavy user or billing a shop, but Anthropic's
 * invoice is the total actually owed. The CSV is the period as shown.
 */
export function AssistantUsage({ api, onUnauthorized }: { api: Api; onUnauthorized: () => void }) {
  const [period, setPeriod] = useState<ReportPeriod>('month')
  const [data, setData] = useState<FleetAssistantUsage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.assistantUsage(period))
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not load assistant usage')
    }
  }, [api, onUnauthorized, period])

  useEffect(() => {
    void load()
  }, [load])

  if (!data) {
    return error ? (
      <section className="panel" style={{ padding: 16, marginTop: 24 }}>
        <Notice>{error}</Notice>
      </section>
    ) : null
  }

  function exportCsv() {
    if (!data) return
    downloadCsv(
      `assistant-usage-${data.period}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(data.shops, [
        { header: 'Shop', value: (s) => s.shopName },
        { header: 'Model', value: (s) => MODEL_LABEL[s.model] ?? s.model },
        { header: 'Requests', value: (s) => s.requests },
        { header: 'Failed', value: (s) => s.errors },
        { header: 'Input tokens', value: (s) => s.inputTokens },
        { header: 'Cache read tokens', value: (s) => s.cacheReadTokens },
        { header: 'Cache write tokens', value: (s) => s.cacheWriteTokens },
        { header: 'Output tokens', value: (s) => s.outputTokens },
        { header: 'Total tokens', value: (s) => s.totalTokens },
        { header: 'Estimated cost (USD)', value: (s) => (s.costMicros / 1_000_000).toFixed(4) },
        { header: 'Period from', value: () => data.range.from },
        { header: 'Period to', value: () => data.range.to ?? new Date().toISOString() },
        { header: 'Last used', value: (s) => s.lastUsedAt },
      ]),
    )
  }

  return (
    <section className="panel" style={{ padding: 16, marginTop: 24 }}>
      <div className="cmd-head" style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span className="strong">Assistant usage</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="input" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} style={{ width: 'auto' }}>
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Refresh
          </Button>
          <Button size="sm" disabled={data.shops.length === 0} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        Estimated from Anthropic’s list prices. Use it to spot heavy users and to bill shops; Anthropic’s invoice is the
        exact total.
      </p>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <Stat label="Estimated spend" value={usd(data.totals.costMicros)} />
        <Stat label="Requests" value={`${compactCount(data.totals.requests)}${data.totals.errors ? ` (${data.totals.errors} failed)` : ''}`} />
        <Stat label="Total tokens" value={compactCount(data.totals.totalTokens)} />
        <Stat
          label="In · cached · out"
          value={`${compactCount(data.totals.inputTokens)} · ${compactCount(data.totals.cacheReadTokens + data.totals.cacheWriteTokens)} · ${compactCount(data.totals.outputTokens)}`}
        />
        {data.byDay.length > 1 && (
          <div>
            <div className="hint" style={{ marginBottom: 4 }}>Daily spend</div>
            <Sparkline values={data.byDay.map((d) => d.costMicros)} label="Assistant spend per day over the period" />
          </div>
        )}
      </div>

      {data.shops.length === 0 ? (
        <p className="hint">No shop used the assistant in this period.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><span className="th-label">Shop</span></th>
                <th><span className="th-label">Model</span></th>
                <th style={{ textAlign: 'right' }}><span className="th-label">Requests</span></th>
                <th style={{ textAlign: 'right' }}><span className="th-label">Tokens</span></th>
                <th style={{ textAlign: 'right' }}><span className="th-label">Est. spend</span></th>
                <th><span className="th-label">Nearest limit</span></th>
                <th><span className="th-label">Last used</span></th>
              </tr>
            </thead>
            <tbody>
              {data.shops.map((s) => {
                const near = s.nearestLimit
                return (
                  <tr key={s.shopId}>
                    <td>
                      <a href={buildHash({ view: 'shop', params: { id: s.shopId } })}>{s.shopName}</a>
                    </td>
                    <td>{MODEL_LABEL[s.model] ?? s.model}</td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      {s.requests}
                      {s.errors > 0 && <span className="muted"> · {s.errors} failed</span>}
                    </td>
                    <td
                      className="num"
                      style={{ textAlign: 'right' }}
                      title={`In ${s.inputTokens.toLocaleString()} · cache read ${s.cacheReadTokens.toLocaleString()} · cache write ${s.cacheWriteTokens.toLocaleString()} · out ${s.outputTokens.toLocaleString()}`}
                    >
                      {compactCount(s.totalTokens)}
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>{usd(s.costMicros)}</td>
                    <td>
                      {near == null ? (
                        <span className="muted">No limits</span>
                      ) : (
                        <span className={near.share >= 1 ? 'strong' : undefined}>
                          {Math.round(near.share * 100)}% of{' '}
                          {describeRule({ ...near, value: near.metric === 'spend' ? near.value / 1_000_000 : near.value })}
                          {near.share >= 1 ? ' · paused' : ''}
                        </span>
                      )}
                    </td>
                    <td title={exact(s.lastUsedAt)}>{timeAgo(s.lastUsedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hint">{label}</div>
      <div className="strong" style={{ fontSize: 20 }}>
        {value}
      </div>
    </div>
  )
}
