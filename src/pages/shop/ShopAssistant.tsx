import { useState } from 'react'
import * as api from '../../api/endpoints.ts'
import type { AssistantBrief as Brief } from '../../api/types.ts'
import { ActionError, Toggle } from '../../components/forms.tsx'
import { describeRule, LimitsEditor } from '../../components/LimitsEditor.tsx'
import { Card, Loadable, Segmented, When } from '../../components/ui.tsx'
import type { ReportPeriod } from '../../api/types.ts'
import { useApi, useAssistantOn } from '../../data.ts'
import { count } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

const usd = (micros: number) => {
  const d = micros / 1_000_000
  return d > 0 && d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`
}

/** The written brief, used both fleet-wide on Home and per shop here. */
export function BriefView({ brief }: { brief: Brief }) {
  return (
    <div className="brief">
      <h3>{brief.content.headline}</h3>
      {brief.content.points.length > 0 && (
        <ul>
          {brief.content.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {brief.content.actions.length > 0 && (
        <>
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
            Suggested next steps
          </div>
          <ul>
            {brief.content.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}
      <div className="small muted">
        Written <When iso={brief.createdAt} />
        {brief.cached && ' (saved copy)'}
      </div>
    </div>
  )
}

/** AI is all-or-nothing: when it's off fleet-wide this card isn't shown at all. */
export function ShopAssistant({ shopId }: { shopId: string }) {
  const on = useAssistantOn()
  if (!on) return null
  return <ShopAssistantCard shopId={shopId} />
}

function ShopAssistantCard({ shopId }: { shopId: string }) {
  const { client, canAct, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const sw = useApi('assistant', (c, s) => api.assistant(c, s))
  const [period, setPeriod] = useState<ReportPeriod>('month')
  const d = useApi(`assistant:shop:${shopId}:${period}`, (c, s) => api.shopAssistant(c, shopId, period, s))
  const [reason, setReason] = useState('')
  const [brief, setBrief] = useState<Brief | null>(null)
  const act = useAction(async (fn: () => Promise<unknown>) => {
    await fn()
    invalidate('assistant')
  })
  const getBrief = useAction(async (fresh: boolean) => setBrief(await api.supportBrief(client, shopId, fresh)))

  return (
    <Card title="Assistant" sub="This shop's AI help." flush>
      <Loadable q={d} rows={4}>
        {(a) => {
          const allowed = a.access.allowed
          return (
            <div className="stack" style={{ padding: 16, gap: 14 }}>
              <div className="spread">
                <label className="row">
                  <Toggle
                    label="Assistant for this shop"
                    checked={allowed}
                    disabled={!canAct || act.pending || (!a.access.allowed && a.access.by === 'system')}
                    onChange={(v) => void act.run(() => api.setShopAssistant(client, shopId, v, reason))}
                  />
                  <span style={{ fontWeight: 550 }}>{allowed ? 'On' : 'Off'}</span>
                </label>
                {canAct && (
                  <input
                    className="input"
                    style={{ flex: '1 1 200px', maxWidth: 320 }}
                    aria-label="Reason (optional)"
                    placeholder="Reason, if switching off"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </div>
              {allowed && (
                <>
                  <Segmented
                    label="Period"
                    value={period}
                    onChange={setPeriod}
                    options={[
                      { value: 'today', label: 'Today' },
                      { value: 'week', label: 'Week' },
                      { value: 'month', label: 'Month' },
                      { value: 'last_month', label: 'Last month' },
                      { value: '30d', label: '30 days' },
                    ]}
                  />
                  <div className="row" style={{ gap: 20 }}>
                    <div>
                      <div className="small sub">Used</div>
                      <div style={{ fontWeight: 600 }}>
                        {count(a.usage.totals.requests)} requests · {usd(a.usage.totals.costMicros)}
                      </div>
                    </div>
                    <div>
                      <div className="small sub">Failed</div>
                      <div style={{ fontWeight: 600 }}>{count(a.usage.totals.errors)}</div>
                    </div>
                    <div>
                      <div className="small sub">Last used</div>
                      <div>
                        <When iso={a.usage.lastUsedAt} />
                      </div>
                    </div>
                  </div>
                  {(a.usage.byKind ?? []).length + (a.usage.byModel ?? []).length > 0 && (
                    <div className="form-grid">
                      <Breakdown title="By feature" rows={(a.usage.byKind ?? []).map((k) => ({ name: KIND[k.kind] ?? k.kind, requests: k.requests, cost: k.costMicros }))} />
                      <Breakdown title="By model" rows={(a.usage.byModel ?? []).map((m) => ({ name: sw.data?.models.find((x) => x.id === m.model)?.label ?? m.model, requests: m.requests, cost: m.costMicros }))} />
                    </div>
                  )}

                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="sam">Model</label>
                      <select
                        id="sam"
                        className="select"
                        disabled={!isAdmin || act.pending}
                        value={a.settings.model ?? ''}
                        onChange={(e) => void act.run(() => api.setShopAssistantSettings(client, shopId, { model: e.target.value || null }))}
                      >
                        <option value="">Fleet default</option>
                        {(sw.data?.models ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="row">
                    <Toggle
                      label="Morning briefing"
                      checked={a.settings.briefing}
                      disabled={!isAdmin || act.pending}
                      onChange={(v) => void act.run(() => api.setShopAssistantSettings(client, shopId, { briefing: v }))}
                    />
                    Morning briefing
                  </label>
                  <label className="row">
                    <Toggle
                      label="Reading supplier invoices"
                      checked={a.settings.invoiceReading}
                      disabled={!isAdmin || act.pending}
                      onChange={(v) => void act.run(() => api.setShopAssistantSettings(client, shopId, { invoiceReading: v }))}
                    />
                    Reading supplier invoices
                  </label>

                  <div>
                    <div style={{ fontWeight: 550, marginBottom: 6 }}>Limits</div>
                    {a.limits.current.length > 0 && (
                      <div className="stack" style={{ gap: 6, marginBottom: 10 }}>
                        {a.limits.current.map((l, i) => {
                          const share = l.value > 0 ? l.used / l.value : 1
                          return (
                            <div key={i}>
                              <div className="spread small">
                                <span>
                                  {describeRule(l)} <span className="muted">({l.source === 'shop' ? 'this shop' : 'fleet'})</span>
                                </span>
                                <span className="num muted">
                                  {l.metric === 'spend' ? `$${l.used.toFixed(2)}` : count(l.used)} used
                                </span>
                              </div>
                              <div className={`meter${share >= 1 ? ' bad' : share > 0.8 ? ' warn' : ''}`}>
                                <span style={{ width: `${Math.min(100, share * 100)}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {isAdmin && (
                      <LimitsEditor
                        key={JSON.stringify(a.limits.own)}
                        rules={a.limits.own}
                        scope="shop"
                        busy={act.pending}
                        onSave={(r) => void act.run(() => api.setShopLimits(client, shopId, r))}
                      />
                    )}
                  </div>
                </>
              )}
              {!allowed && a.access.by === 'system' && <div className="small muted">Off for the whole fleet in Settings.</div>}
              <ActionError error={act.error} />

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 550 }}>Before you call</span>
                  <span className="row">
                    <button className="btn sm" disabled={getBrief.pending} onClick={() => void getBrief.run(false)}>
                      {getBrief.pending ? 'Writing…' : brief ? 'Show saved' : 'Brief me on this shop'}
                    </button>
                    {brief && (
                      <button className="btn sm ghost" disabled={getBrief.pending} onClick={() => void getBrief.run(true)}>
                        Write a fresh one
                      </button>
                    )}
                  </span>
                </div>
                <ActionError error={getBrief.error} />
                {brief && <BriefView brief={brief} />}
              </div>
            </div>
          )
        }}
      </Loadable>
    </Card>
  )
}

const KIND: Record<string, string> = { chat: 'Questions', briefing: 'Briefings', invoice: 'Invoices', setup: 'Setup help' }

function Breakdown({ title, rows }: { title: string; rows: { name: string; requests: number; cost: number }[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <div className="small sub" style={{ marginBottom: 4 }}>
        {title}
      </div>
      <table className="table">
        <tbody>
          {[...rows]
            .sort((x, y) => y.cost - x.cost)
            .map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="r num">{count(r.requests)}</td>
                <td className="r num">{usd(r.cost)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
