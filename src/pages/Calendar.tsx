import { useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { CalendarEvent, CalendarKind } from '../api/types.ts'
import { Card, Empty, Loadable, PageHeader, Segmented } from '../components/ui.tsx'
import { useApi } from '../data.ts'
import { ago, exact } from '../lib/format.ts'
import { href, shopHref, tillHref } from '../lib/router.ts'

const KIND: Record<CalendarKind, { label: string; tone: string }> = {
  schedule: { label: 'Schedule', tone: 'neutral' },
  deletion: { label: 'Deletion', tone: 'offline' },
  follow_up: { label: 'Follow-up', tone: 'attention' },
  renewal: { label: 'Renewal', tone: 'attention' },
  setup_code: { label: 'Setup code', tone: 'neutral' },
  mute_ends: { label: 'Alerts back', tone: 'neutral' },
  rollout: { label: 'Rollout', tone: 'healthy' },
  hold: { label: 'Hold', tone: 'attention' },
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function link(e: CalendarEvent): string | null {
  if (e.kind === 'follow_up') return e.shopId ? href(`/shops/${encodeURIComponent(e.shopId)}`, { tab: 'contacts' }) : null
  if (e.kind === 'renewal') return e.shopId ? href(`/shops/${encodeURIComponent(e.shopId)}`, { tab: 'account' }) : null
  if (e.kind === 'deletion') return e.shopId ? href(`/shops/${encodeURIComponent(e.shopId)}`, { tab: 'closing' }) : null
  if (e.kind === 'schedule') return href('/settings', { tab: 'tills' })
  if (e.deviceId) return tillHref(e.deviceId)
  if (e.shopId) return shopHref(e.shopId)
  return null
}

function Row({ e }: { e: CalendarEvent }) {
  const to = link(e)
  return (
    <li className="row" style={{ padding: '8px 16px', gap: 12, alignItems: 'flex-start' }}>
      <span className="mono small sub" style={{ width: 44, flex: 'none' }} title={exact(e.at)}>
        {time(e.at)}
      </span>
      <span className={`badge ${KIND[e.kind].tone}`} style={{ flex: 'none' }}>
        {KIND[e.kind].label}
      </span>
      <span style={{ minWidth: 0 }}>
        {to ? <a href={to}>{e.title}</a> : e.title}
        {e.detail && <div className="small muted">{e.detail}</div>}
      </span>
    </li>
  )
}

/**
 * Everything with a date, in one place: schedules, deletions, follow-ups,
 * renewals, setup codes running out, mutes ending — and what's under way now.
 */
export function Calendar() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const q = useApi(`calendar:${days}`, (c, s) => api.calendar(c, Number(days), s))
  return (
    <div className="stack">
      <PageHeader
        title="Calendar"
        sub="What's coming up across the fleet: schedules, deletions, follow-ups, renewals, setup codes and mutes running out."
        actions={
          <Segmented
            label="How far ahead"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: 'Week' },
              { value: '30', label: 'Month' },
              { value: '90', label: '3 months' },
            ]}
          />
        }
      />
      <Loadable q={q} rows={6}>
        {({ events, ongoing }) => {
          const groups = new Map<string, CalendarEvent[]>()
          const overdue = events.filter((e) => Date.parse(e.at) < Date.now())
          for (const e of events.filter((x) => Date.parse(x.at) >= Date.now())) {
            const k = dayKey(e.at)
            groups.set(k, [...(groups.get(k) ?? []), e])
          }
          return (
            <>
              {ongoing.length > 0 && (
                <Card title="Under way now" flush>
                  <ul className="list">
                    {ongoing.map((e, i) => (
                      <li key={i} className="row" style={{ padding: '8px 16px', gap: 12 }}>
                        <span className={`badge ${KIND[e.kind].tone}`}>{KIND[e.kind].label}</span>
                        <span style={{ minWidth: 0 }}>
                          {link(e) ? <a href={link(e)!}>{e.title}</a> : e.title}
                          <div className="small muted">
                            Since {ago(e.at)}
                            {e.detail ? ` — ${e.detail}` : ''}
                          </div>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {overdue.length > 0 && (
                <Card title="Overdue" flush>
                  <ul className="list">
                    {overdue.map((e, i) => (
                      <Row key={i} e={e} />
                    ))}
                  </ul>
                </Card>
              )}
              {groups.size === 0 ? (
                <Card>
                  <Empty title="Nothing dated coming up" />
                </Card>
              ) : (
                [...groups].map(([day, list]) => (
                  <Card key={day} title={day} flush>
                    <ul className="list">
                      {list.map((e, i) => (
                        <Row key={i} e={e} />
                      ))}
                    </ul>
                  </Card>
                ))
              )}
            </>
          )
        }}
      </Loadable>
    </div>
  )
}
