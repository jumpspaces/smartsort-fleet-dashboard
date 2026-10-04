import { useState } from 'react'
import type { LimitFeature, LimitMetric, LimitPeriod, LimitRule } from '../api.ts'
import { Button } from '../components/ui.tsx'

export const METRIC_LABEL: Record<LimitMetric, string> = {
  requests: 'Requests',
  spend: 'Spend (US$)',
  tokens: 'Tokens',
}
export const PERIOD_LABEL: Record<LimitPeriod, string> = {
  hour: 'per hour',
  day: 'per day',
  week: 'per week',
  month: 'per month',
}
export const FEATURE_LABEL: Record<LimitFeature, string> = {
  chat: 'Questions',
  briefing: 'Briefings',
  invoice: 'Invoices',
  insights: 'Insight summaries',
  compare: 'Period comparisons',
  reports: 'Report write-ups',
  digests: 'Scheduled briefings',
  watch: 'Unusual activity',
  whatsapp: 'WhatsApp',
  product_photo: 'Products from photos',
  catalogue: 'Catalogue tidy-up',
  cash_helper: 'Cash variance helper',
}

/** "20 requests per day", "$5.00 per month on invoices", "No limit on tokens per week". */
export function describeRule(r: LimitRule): string {
  const scope = r.feature ? ` · ${FEATURE_LABEL[r.feature].toLowerCase()} only` : ''
  if (r.value == null) return `No ${r.metric} limit ${PERIOD_LABEL[r.period]}${scope}`
  const amount =
    r.metric === 'spend'
      ? `$${r.value.toFixed(2)}`
      : `${r.value.toLocaleString('en-US')} ${r.metric === 'tokens' ? 'tokens' : 'requests'}`
  return `${amount} ${PERIOD_LABEL[r.period]}${scope}`
}

const keyOf = (r: LimitRule) => `${r.metric}:${r.period}:${r.feature ?? '*'}`

interface Row {
  id: number
  metric: LimitMetric
  period: LimitPeriod
  feature: LimitFeature | ''
  value: string
  /** Shop only: this row lifts the fleet's rule instead of setting one. */
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
 * Edit a list of limit rules: what's counted, per what period, for which
 * feature, and how much. The fleet's list sets limits for every shop; a shop's
 * list overrides the fleet's rule for the same thing, and (shop only) can lift
 * it with "No limit". Saved as a whole.
 */
export function LimitsEditor({
  rules,
  scope,
  inherited = [],
  busy,
  onSave,
}: {
  rules: LimitRule[]
  scope: 'fleet' | 'shop'
  /** The fleet's rules, shown on a shop so it's clear what it follows. */
  inherited?: LimitRule[]
  busy: boolean
  onSave: (rules: LimitRule[]) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => rules.map(toRow))
  const [baseline, setBaseline] = useState(rules)
  // A save elsewhere (or a reload) hands us new rules: start again from them.
  if (baseline !== rules) {
    setBaseline(rules)
    setRows(rules.map(toRow))
  }

  const parsed: LimitRule[] = rows.map((r) => ({
    metric: r.metric,
    period: r.period,
    feature: r.feature || null,
    value: r.none ? null : r.value.trim() === '' ? NaN : Number(r.value),
  }))
  const invalid = parsed.some((r) => r.value != null && (!Number.isFinite(r.value) || r.value < 0))
  const duplicate = new Set(parsed.map(keyOf)).size !== parsed.length
  const dirty = JSON.stringify(parsed) !== JSON.stringify(rules.map((r) => ({ ...r })))
  const overridden = new Set(parsed.map(keyOf))

  const update = (id: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const add = (from?: LimitRule) =>
    setRows((all) => [...all, from ? toRow(from) : toRow({ metric: 'requests', period: 'day', feature: null, value: null })])

  return (
    <div>
      {scope === 'shop' && inherited.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="hint" style={{ marginBottom: 4 }}>Fleet limits this shop follows:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {inherited.map((r) => (
              <li key={keyOf(r)} className="small">
                <span className={overridden.has(keyOf(r)) ? 'muted' : undefined} style={overridden.has(keyOf(r)) ? { textDecoration: 'line-through' } : undefined}>
                  {describeRule(r)}
                </span>
                {!overridden.has(keyOf(r)) && (
                  <Button size="sm" variant="ghost" style={{ marginLeft: 6 }} onClick={() => add(r)}>
                    Change for this shop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="hint" style={{ marginBottom: 8 }}>
          {scope === 'fleet' ? 'No fleet limits: shops are held only by the server’s hourly ceiling.' : 'No limits of its own.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" aria-label="What to count" value={r.metric} onChange={(e) => update(r.id, { metric: e.target.value as LimitMetric })} style={{ width: 'auto' }}>
                {(Object.keys(METRIC_LABEL) as LimitMetric[]).map((m) => (
                  <option key={m} value={m}>{METRIC_LABEL[m]}</option>
                ))}
              </select>
              <select className="input" aria-label="Per" value={r.period} onChange={(e) => update(r.id, { period: e.target.value as LimitPeriod })} style={{ width: 'auto' }}>
                {(Object.keys(PERIOD_LABEL) as LimitPeriod[]).map((p) => (
                  <option key={p} value={p}>{PERIOD_LABEL[p]}</option>
                ))}
              </select>
              <select className="input" aria-label="For" value={r.feature} onChange={(e) => update(r.id, { feature: e.target.value as LimitFeature | '' })} style={{ width: 'auto' }}>
                <option value="">All features</option>
                {(Object.keys(FEATURE_LABEL) as LimitFeature[]).map((f) => (
                  <option key={f} value={f}>{FEATURE_LABEL[f]} only</option>
                ))}
              </select>
              {!r.none && (
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={r.metric === 'spend' ? 0.5 : 1}
                  inputMode={r.metric === 'spend' ? 'decimal' : 'numeric'}
                  aria-label="Limit"
                  placeholder={r.metric === 'spend' ? 'US$' : 'How many'}
                  value={r.value}
                  onChange={(e) => update(r.id, { value: e.target.value })}
                  style={{ width: 110 }}
                />
              )}
              {scope === 'shop' && (
                <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" checked={r.none} onChange={(e) => update(r.id, { none: e.target.checked })} />
                  No limit
                </label>
              )}
              <Button size="sm" variant="ghost" onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))} aria-label="Remove this limit">
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {duplicate && <p className="hint" style={{ color: 'var(--bad)' }}>Two limits count the same thing over the same period — keep one.</p>}
      <div className="form-actions">
        <Button size="sm" onClick={() => add()}>Add a limit</Button>
        <Button size="sm" variant="primary" busy={busy} busyLabel="Saving…" disabled={!dirty || invalid || duplicate} onClick={() => onSave(parsed)}>
          Save limits
        </Button>
      </div>
    </div>
  )
}
