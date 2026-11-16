import { useState } from 'react'
import type { LimitMetric, LimitPeriod, LimitRule } from '../api/types.ts'

export const METRIC_LABEL: Record<LimitMetric, string> = { requests: 'Requests', spend: 'Spend (US$)', tokens: 'Tokens' }
export const PERIOD_LABEL: Record<LimitPeriod, string> = { hour: 'per hour', day: 'per day', week: 'per week', month: 'per month' }

/** Same keys as the server's assistant features. */
export const FEATURE_LABEL: Record<string, string> = {
  chat: 'Questions',
  briefing: 'Briefings',
  invoice: 'Invoices',
  insights: 'Insight summaries',
  compare: 'Period comparisons',
  reports: 'Report write-ups',
  digests: 'Scheduled briefings',
  watch: 'Unusual activity',
  product_photo: 'Products from photos',
  catalogue: 'Catalogue tidy-up',
  cash_helper: 'Cash variance helper',
  staff: 'Staff reviews',
  till_search: 'Till product search',
  till_returns: 'Finding sales for returns',
  till_handover: 'Handover notes',
  till_help: 'Cashier help',
  till_summary: 'Cashier shift summaries',
  training: 'Cashier practice',
}

/** "20 requests per day", "$5.00 per month · invoices only", "No spend limit per week". */
export function describeRule(r: LimitRule): string {
  const scope = r.feature ? ` · ${(FEATURE_LABEL[r.feature] ?? r.feature).toLowerCase()} only` : ''
  if (r.value == null) return `No ${r.metric} limit ${PERIOD_LABEL[r.period]}${scope}`
  const amount =
    r.metric === 'spend' ? `$${r.value.toFixed(2)}` : `${r.value.toLocaleString('en-US')} ${r.metric === 'tokens' ? 'tokens' : 'requests'}`
  return `${amount} ${PERIOD_LABEL[r.period]}${scope}`
}

interface Row {
  id: number
  metric: LimitMetric
  period: LimitPeriod
  feature: string
  value: string
  none: boolean
}

let nextId = 1
const toRow = (r: LimitRule): Row => ({
  id: nextId++,
  metric: r.metric,
  period: r.period,
  feature: r.feature ?? '',
  value: r.value == null ? '' : String(r.value),
  none: r.value == null,
})

/**
 * A list of limit rules, saved as a whole. The fleet's list applies to every
 * shop; a shop's own list overrides the fleet's rule for the same thing and
 * can lift it with "No limit".
 */
export function LimitsEditor({
  rules,
  scope,
  busy,
  onSave,
}: {
  rules: LimitRule[]
  scope: 'fleet' | 'shop'
  busy: boolean
  onSave: (rules: LimitRule[]) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => rules.map(toRow))
  const [error, setError] = useState<string | null>(null)
  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))

  function save() {
    const out: LimitRule[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      const key = `${r.metric}:${r.period}:${r.feature || '*'}`
      if (seen.has(key)) return setError('Two rules count the same thing over the same period. Remove one.')
      seen.add(key)
      if (r.none) {
        out.push({ metric: r.metric, period: r.period, feature: r.feature || null, value: null })
        continue
      }
      const v = Number(r.value)
      if (!r.value.trim() || !Number.isFinite(v) || v < 0) return setError('Every limit needs a number of zero or more.')
      out.push({ metric: r.metric, period: r.period, feature: r.feature || null, value: v })
    }
    setError(null)
    onSave(out)
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.length === 0 && (
        <div className="small muted">{scope === 'fleet' ? 'No limits — only the server’s own hourly ceiling applies.' : 'Follows the fleet’s limits.'}</div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="row" style={{ gap: 6 }}>
          <input
            className="input"
            style={{ width: 110 }}
            type="number"
            min={0}
            step={r.metric === 'spend' ? 0.01 : 1}
            aria-label="Limit"
            disabled={r.none}
            placeholder={r.none ? 'No limit' : 'Amount'}
            value={r.none ? '' : r.value}
            onChange={(e) => patch(r.id, { value: e.target.value })}
          />
          <select className="select" aria-label="What's counted" value={r.metric} onChange={(e) => patch(r.id, { metric: e.target.value as LimitMetric })}>
            {Object.entries(METRIC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Period" value={r.period} onChange={(e) => patch(r.id, { period: e.target.value as LimitPeriod })}>
            {Object.entries(PERIOD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Feature" value={r.feature} onChange={(e) => patch(r.id, { feature: e.target.value })}>
            <option value="">All features</option>
            {Object.entries(FEATURE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {scope === 'shop' && (
            <label className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={r.none} onChange={(e) => patch(r.id, { none: e.target.checked })} /> No limit
            </label>
          )}
          <button type="button" className="btn sm ghost" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
            Remove
          </button>
        </div>
      ))}
      {error && <div className="notice">{error}</div>}
      <div className="row">
        <button
          type="button"
          className="btn sm"
          onClick={() => setRows((rs) => [...rs, toRow({ metric: 'requests', period: 'day', feature: null, value: 50 })])}
        >
          Add a limit
        </button>
        <button type="button" className="btn sm primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save limits'}
        </button>
      </div>
    </div>
  )
}
