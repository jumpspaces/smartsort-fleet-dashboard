import { useCallback, useEffect, useState } from 'react'
import {
  Forbidden,
  Unauthorized,
  type Api,
  type AssistantModel,
  type AssistantModelId,
  type LimitRule,
  type LimitStanding,
  type ReportPeriod,
  type ShopAssistantDetail,
} from '../api.ts'
import { Card, KV, Notice } from '../components/ui.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { compactCount, exact, timeAgo, timeUntil, usd } from '../lib/format.ts'
import { PERIOD_OPTIONS } from './AssistantUsage.tsx'
import { describeRule, LimitsEditor } from './LimitsEditor.tsx'

const KIND_LABEL: Record<string, string> = {
  chat: 'Questions',
  briefing: 'Briefings',
  invoice: 'Invoices read',
  setup: 'Setup',
}

const MODEL_LABEL: Record<string, string> = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-haiku-4-5': 'Haiku 4.5',
}

/** One limit as a labelled meter: how much of it this period has used. */
function LimitMeter({ limit }: { limit: LimitStanding }) {
  const share = limit.value > 0 ? limit.used / limit.value : 1
  const used = limit.metric === 'spend' ? `$${limit.used.toFixed(2)}` : limit.used.toLocaleString('en-US')
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} className="small">
        <span>
          {describeRule(limit)}
          {limit.source === 'fleet' && <span className="muted"> · fleet</span>}
        </span>
        <span className={share >= 1 ? 'strong' : 'muted'}>
          {used}
          {share >= 1 ? ' · paused' : ''}
        </span>
      </div>
      <div
        role="meter"
        aria-label={describeRule(limit)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share * 100))}
        style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden', marginTop: 3 }}
      >
        <div
          style={{
            width: `${Math.min(100, share * 100)}%`,
            height: '100%',
            background: share >= 1 ? 'var(--bad-mark)' : share >= 0.8 ? 'var(--warn-mark)' : 'var(--ok-mark)',
          }}
        />
      </div>
      {limit.resetsAt && share >= 1 && (
        <div className="hint" title={exact(limit.resetsAt)}>Resets {timeUntil(limit.resetsAt)}</div>
      )}
    </div>
  )
}

/**
 * One shop's AI: spend and tokens over a period (estimated), where it stands
 * against each of its limits, and its own settings — model, features, and
 * limits that override the fleet's. Changing them is admin-only.
 */
export function ShopAssistantPlan({
  api,
  shopId,
  onUnauthorized,
}: {
  api: Api
  shopId: string
  onUnauthorized: () => void
}) {
  const [period, setPeriod] = useState<ReportPeriod>('month')
  const [detail, setDetail] = useState<ShopAssistantDetail | null>(null)
  const [models, setModels] = useState<AssistantModel[]>([])
  const [fleetModel, setFleetModel] = useState<AssistantModelId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [d, switches] = await Promise.all([api.shopAssistant(shopId, period), api.assistantSwitches()])
      setDetail(d)
      setModels(switches.models)
      setFleetModel(switches.defaults.model)
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not load the shop’s AI usage')
    }
  }, [api, shopId, period, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  async function run(key: string, action: () => Promise<void>, done: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load()
      setNotice(done)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Forbidden ? 'Only admins can change a shop’s AI plan.' : err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  if (!detail || !fleetModel) return error ? <Card title="AI usage & plan"><Notice>{error}</Notice></Card> : null

  const { usage, plan, settings, limits } = detail
  const t = usage.totals
  const labelOf = (id: string) => models.find((m) => m.id === id)?.label ?? MODEL_LABEL[id] ?? id

  return (
    <Card
      title="AI usage & plan"
      actions={
        <select className="input" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} style={{ width: 'auto' }}>
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      }
    >
      {error && <Notice>{error}</Notice>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="strong" style={{ fontSize: 20 }}>{usd(t.costMicros)}</span>
        <span className="hint">estimated · {PERIOD_OPTIONS.find((p) => p.id === period)?.label.toLowerCase()}</span>
      </div>
      <dl className="kv-list" style={{ margin: '8px 0' }}>
        <KV k="Requests" v={`${t.requests}${t.errors ? ` (${t.errors} failed)` : ''}`} />
        <KV k="Total tokens" v={t.totalTokens.toLocaleString('en-US')} />
        <KV k="Input" v={t.inputTokens.toLocaleString('en-US')} />
        <KV k="Cache read / write" v={`${t.cacheReadTokens.toLocaleString('en-US')} / ${t.cacheWriteTokens.toLocaleString('en-US')}`} />
        <KV k="Output" v={t.outputTokens.toLocaleString('en-US')} />
        {usage.byKind.map((k) => (
          <KV key={k.kind} k={KIND_LABEL[k.kind] ?? k.kind} v={`${k.requests} · ${compactCount(k.totalTokens)} tokens · ${usd(k.costMicros)}`} />
        ))}
        {usage.byModel.length > 1 &&
          usage.byModel.map((m) => <KV key={m.model} k={labelOf(m.model)} v={`${m.requests} · ${usd(m.costMicros)}`} />)}
        {usage.lastUsedAt && <KV k="Last used" v={timeAgo(usage.lastUsedAt)} title={exact(usage.lastUsedAt)} />}
      </dl>
      {usage.byDay.length > 1 && (
        <Sparkline values={usage.byDay.map((d) => d.costMicros)} label="This shop's AI spend per day over the period" />
      )}

      <div className="cmd-head" style={{ marginTop: 16, marginBottom: 6 }}>
        <span className="strong">Limits now</span>
      </div>
      {limits.current.length === 0 ? (
        <p className="hint">No limits apply — only the server’s hourly ceiling.</p>
      ) : (
        limits.current.map((l) => <LimitMeter key={`${l.metric}:${l.period}:${l.feature ?? '*'}`} limit={l} />)
      )}

      <div className="cmd-head" style={{ marginTop: 16, marginBottom: 6 }}>
        <span className="strong">Model and features</span>
      </div>
      <label className="field" style={{ marginBottom: 10 }}>
        <span>Model</span>
        <select
          className="input"
          value={settings.model ?? ''}
          disabled={busy === 'settings'}
          onChange={(e) =>
            void run('settings', () => api.setShopAssistantSettings(shopId, { model: (e.target.value || null) as AssistantModelId | null }), 'Model saved — applies from the next question.')
          }
        >
          <option value="">Fleet default ({labelOf(fleetModel)})</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <span className="hint">Running on {labelOf(plan.model)} now.</span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={settings.briefing}
          disabled={busy === 'settings'}
          onChange={(e) => void run('settings', () => api.setShopAssistantSettings(shopId, { briefing: e.target.checked }), 'Saved.')}
        />
        <span>Daily briefing</span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={settings.invoiceReading}
          disabled={busy === 'settings'}
          onChange={(e) => void run('settings', () => api.setShopAssistantSettings(shopId, { invoiceReading: e.target.checked }), 'Saved.')}
        />
        <span>Reading supplier invoices</span>
      </label>

      <div className="cmd-head" style={{ marginTop: 8, marginBottom: 6 }}>
        <span className="strong">This shop’s own limits</span>
      </div>
      <LimitsEditor
        scope="shop"
        rules={limits.own}
        inherited={limits.fleet}
        busy={busy === 'limits'}
        onSave={(rules: LimitRule[]) => void run('limits', () => api.setShopLimits(shopId, rules), 'Limits saved — they apply from the next question.')}
      />

      {notice && <p className="hint" style={{ marginTop: 8 }}>{notice}</p>}
      {settings.updatedAt && (
        <p className="hint" style={{ marginTop: 8 }} title={exact(settings.updatedAt)}>
          Settings last changed {timeAgo(settings.updatedAt)}
          {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.
        </p>
      )}
    </Card>
  )
}
