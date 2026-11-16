import { useState } from 'react'
import * as api from '../../api/endpoints.ts'
import type { Device, TimelineKind } from '../../api/types.ts'
import { Bars } from '../../components/Bars.tsx'
import { ActionError } from '../../components/forms.tsx'
import { Card, Empty, Loadable, When } from '../../components/ui.tsx'
import { useApi, useShopIndex } from '../../data.ts'
import { count, money, pct } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'
import { MuteDialog } from '../shop/ShopTools.tsx'
import { tillName } from '../../lib/plain.ts'

/** Header buttons: silence this till's alerts, or end a silence early. */
export function TillActions({ d }: { d: Device }) {
  const { client, canAct } = useSession()
  const [muting, setMuting] = useState(false)
  const end = useAction(async (id: string) => {
    await api.cancelMute(client, id)
    invalidate('device')
    invalidate('mutes')
  })
  if (!canAct) return null
  return (
    <>
      {d.mute && d.mute.scope === 'device' ? (
        <button className="btn sm" disabled={end.pending} onClick={() => void end.run(d.mute!.id)}>
          Unsilence
        </button>
      ) : (
        <button className="btn sm" onClick={() => setMuting(true)}>
          Silence alerts
        </button>
      )}
      <MuteDialog open={muting} onClose={() => setMuting(false)} target={{ scope: 'device', deviceId: d.deviceId }} name={tillName(d)} />
    </>
  )
}

/** Free-form labels ("pilot", "slow-internet") an operator can filter by later. */
export function Tags({ d }: { d: Device }) {
  const { client, canAct } = useSession()
  const catalogue = useApi('tags', (c, s) => api.tagCatalogue(c, s))
  const [tag, setTag] = useState('')
  const act = useAction(async (fn: () => Promise<unknown>) => {
    await fn()
    setTag('')
    invalidate(`device:${d.deviceId}`)
    invalidate('tags')
  })
  return (
    <Card title="Labels">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6 }}>
          {d.tags.length === 0 && <span className="small muted">No labels.</span>}
          {d.tags.map((t) => (
            <span key={t} className="tag" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {t}
              {canAct && (
                <button
                  className="btn ghost"
                  style={{ height: 16, padding: '0 2px', fontSize: 11 }}
                  aria-label={`Remove label ${t}`}
                  disabled={act.pending}
                  onClick={() => void act.run(() => api.removeTag(client, d.deviceId, t))}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        {canAct && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (tag.trim()) void act.run(() => api.addTag(client, d.deviceId, tag.trim().toLowerCase()))
            }}
          >
            <input
              className="input"
              list="tag-list"
              aria-label="Add a label"
              placeholder="Add a label"
              maxLength={40}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              style={{ flex: 1 }}
            />
            <datalist id="tag-list">
              {(catalogue.data ?? []).map((t) => (
                <option key={t.tag} value={t.tag} />
              ))}
            </datalist>
            <button className="btn sm" type="submit" disabled={!tag.trim() || act.pending}>
              Add
            </button>
          </form>
        )}
        <ActionError error={act.error} />
      </div>
    </Card>
  )
}

/** Fourteen days, one bar each: connected time and sales. */
export function Fortnight({ d }: { d: Device }) {
  const shops = useShopIndex()
  const currency = (d.shopId && shops.get(d.shopId)?.currency) || 'GHS'
  const h = useApi(`device:history:${d.deviceId}`, (c, s) => api.deviceHistory(c, d.deviceId, 24 * 14, s), { every: 300_000 })
  const short = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return (
    <Card title="Last 14 days" sub={h.data?.uptimeBps != null ? `${pct(h.data.uptimeBps)} connected` : undefined}>
      <Loadable q={h} rows={3}>
        {(hist) =>
          hist.days.length === 0 ? (
            <div className="small muted">No daily records yet.</div>
          ) : (
            <div className="stack">
              <Bars
                label="Connected time by day"
                height={56}
                format={(n) => pct(n, 1)}
                points={hist.days.map((x) => ({ key: x.day, value: x.uptimeBps, label: short(x.day) }))}
              />
              <Bars
                label="Sales by day"
                height={56}
                format={(n) => money(n, currency)}
                points={hist.days.map((x) => ({ key: x.day, value: x.salesPesewas, label: short(x.day) }))}
              />
              <div className="small muted">
                {count(hist.days.reduce((s, x) => s + (x.salesCount ?? 0), 0))} sales recorded over the period
              </div>
            </div>
          )
        }
      </Loadable>
    </Card>
  )
}

const KIND_LABEL: Record<TimelineKind, string> = {
  alert_opened: 'Alert',
  alert_resolved: 'Cleared',
  command: 'Fix',
  note: 'Note',
  mute: 'Silenced',
  version: 'Version',
  error: 'App problem',
  rollout: 'Update',
}

/** Everything that happened to this till, newest first. */
export function Timeline({ id }: { id: string }) {
  const t = useApi(`device:timeline:${id}`, (c, s) => api.timeline(c, id, 14, s), { every: 60_000 })
  const [all, setAll] = useState(false)
  return (
    <Card title="What happened" sub="The last 14 days, newest first." flush>
      <Loadable q={t} rows={4}>
        {(events) =>
          events.length === 0 ? (
            <Empty title="Nothing recorded" />
          ) : (
            <>
              <ul className="timeline" style={{ paddingTop: 14 }}>
                {(all ? events : events.slice(0, 12)).map((e, i) => (
                  <li key={`${e.at}:${i}`}>
                    <span className={`tl-dot${e.severity ? ` ${e.severity}` : ''}`} />
                    <div className="spread">
                      <span>
                        <span className="tag" style={{ marginRight: 6 }}>
                          {KIND_LABEL[e.kind] ?? e.kind}
                        </span>
                        <span style={{ fontWeight: 550 }}>{e.title}</span>
                      </span>
                      <span className="small muted">
                        <When iso={e.at} />
                      </span>
                    </div>
                    {(e.detail || e.actor) && (
                      <div className="small sub" style={{ overflowWrap: 'anywhere' }}>
                        {e.detail}
                        {e.actor && <span className="muted"> — {e.actor}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {events.length > 12 && (
                <div className="pager">
                  <span />
                  <button className="btn sm ghost" onClick={() => setAll((v) => !v)}>
                    {all ? 'Show fewer' : `Show all ${events.length}`}
                  </button>
                </div>
              )}
            </>
          )
        }
      </Loadable>
    </Card>
  )
}
