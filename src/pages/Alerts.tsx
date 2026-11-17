import * as api from '../api/endpoints.ts'
import type { Alert, AlertState } from '../api/types.ts'
import { Card, Empty, ErrorNote, Live, Loadable, PageHeader, Segmented, When } from '../components/ui.tsx'
import { useState } from 'react'
import { useAlerts, useApi } from '../data.ts'
import { plural } from '../lib/format.ts'
import { rulePlain } from '../lib/plain.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { shopHref, tillHref, useSetParams } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const TABS = ['open', 'acknowledged', 'resolved', 'all'] as const
type Tab = (typeof TABS)[number]

export function Alerts({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const { client, canAct } = useSession()
  const raw = params.get('state') ?? 'open'
  const tab: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'open'
  const alerts = useAlerts(tab as AlertState | 'all')
  const rules = useApi('rules', (c, s) => api.rules(c, s))
  const runbooks = new Map((rules.data ?? []).filter((r) => r.runbookUrl).map((r) => [r.key, r.runbookUrl!]))

  const ack = useAction(async (id: string) => {
    await api.acknowledgeAlert(client, id)
    invalidate('alerts')
    invalidate('overview')
  })
  const evaluate = useAction(async () => {
    await api.evaluateAlerts(client)
    invalidate('alerts')
    invalidate('overview')
    invalidate('device')
  })

  return (
    <div className="stack">
      <PageHeader
        title="Alerts"
        sub="One alert per problem per till. It closes by itself when the problem clears."
        actions={
          <>
            <Live updatedAt={alerts.updatedAt} busy={alerts.refreshing} />
            {canAct && (
              <button
                className="btn sm"
                disabled={evaluate.pending}
                onClick={() => void evaluate.run()}
                title="Re-check every till now instead of waiting for the next minute"
              >
                {evaluate.pending ? 'Checking…' : 'Check now'}
              </button>
            )}
          </>
        }
      />
      <Segmented
        label="Alert state"
        value={tab}
        onChange={(v) => setParams({ state: v === 'open' ? null : v })}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'acknowledged', label: 'Being handled' },
          { value: 'resolved', label: 'Cleared' },
          { value: 'all', label: 'All' },
        ]}
      />
      {evaluate.error && <ErrorNote error={evaluate.error} />}
      {ack.error && <ErrorNote error={ack.error} />}
      <Card flush>
        <Loadable q={alerts} rows={6}>
          {(list) =>
            list.length === 0 ? (
              <Empty title={tab === 'open' ? 'No open alerts' : 'Nothing here'}>
                {tab === 'open' ? 'Every till is quiet.' : undefined}
              </Empty>
            ) : (
              <ul className="list">
                {list.map((a) => (
                  <AlertItem
                    key={a.id}
                    a={a}
                    runbook={runbooks.get(a.ruleKey) ?? null}
                    canAck={canAct && a.state === 'open'}
                    acking={ack.pending}
                    onAck={() => void ack.run(a.id)}
                  />
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}

function AlertItem({
  a,
  runbook,
  canAck,
  acking,
  onAck,
}: {
  a: Alert
  runbook: string | null
  canAck: boolean
  acking: boolean
  onAck: () => void
}) {
  const p = rulePlain(a.ruleKey, a.title)
  const [showSent, setShowSent] = useState(false)
  const critical = a.severity === 'critical'
  return (
    <li data-nav>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className={`badge ${a.state === 'resolved' ? 'healthy' : critical ? 'offline' : 'attention'}`}>
              {a.state === 'resolved' ? 'Cleared' : critical ? 'Urgent' : 'Warning'}
            </span>
            <span className="issue-title">{p.title}</span>
          </div>
          {p.hint && (
            <div className="issue-hint" style={{ marginTop: 4 }}>
              {p.hint}
            </div>
          )}
          <div className="row small sub" style={{ marginTop: 6, gap: 6 }}>
            {a.shopId ? <a href={shopHref(a.shopId)}>{a.shopName ?? 'Shop'}</a> : <span>Fleet-wide</span>}
            {a.deviceId && (
              <>
                <span className="muted">·</span>
                <a href={tillHref(a.deviceId)}>Open till</a>
              </>
            )}
            {a.rollupCount != null && a.rollupCount > 1 && (
              <>
                <span className="muted">·</span>
                <span>{plural(a.rollupCount, 'till')}</span>
              </>
            )}
            <span className="muted">·</span>
            <span className="muted" title={a.detail ?? undefined}>
              {a.title}
            </span>
            {runbook && /^https?:\/\//.test(runbook) && (
              <>
                <span className="muted">·</span>
                <a href={runbook} target="_blank" rel="noreferrer noopener">
                  Runbook
                </a>
              </>
            )}
            <span className="muted">·</span>
            <button className="btn sm ghost" style={{ height: 22, padding: '0 6px' }} onClick={() => setShowSent((v) => !v)} aria-expanded={showSent}>
              {showSent ? 'Hide who was told' : 'Who was told'}
            </button>
          </div>
          {a.autoFixNote && (
            <div className="small sub" style={{ marginTop: 4 }}>
              Automatic fix: {a.autoFixNote}
            </div>
          )}
          {a.escalations > 0 && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
              Escalated {plural(a.escalations, 'time')}, last <When iso={a.escalatedAt} />
            </div>
          )}
          {showSent && <Deliveries alertId={a.id} />}
        </div>
        <div style={{ textAlign: 'right' }} className="small">
          <div className="muted">
            Opened <When iso={a.openedAt} />
          </div>
          {a.state === 'acknowledged' && (
            <div className="sub">
              {a.acknowledgedByLabel ?? 'Someone'} took it <When iso={a.acknowledgedAt} />
            </div>
          )}
          {a.state === 'resolved' && (
            <div className="sub">
              Cleared <When iso={a.resolvedAt} />
            </div>
          )}
          {a.notifyError && !a.notifiedAt && (
            <div style={{ color: 'var(--bad)' }} title={a.notifyError}>
              Notification not delivered
            </div>
          )}
          {canAck && (
            <button className="btn sm" data-ack style={{ marginTop: 6 }} disabled={acking} onClick={onAck}>
              I'm on it
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function Deliveries({ alertId }: { alertId: string }) {
  const d = useApi(`alerts:deliveries:${alertId}`, (c, s) => api.alertDeliveries(c, alertId, s))
  return (
    <div style={{ marginTop: 8 }}>
      <Loadable q={d} rows={2}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="small muted">No channel was set up to receive this.</div>
          ) : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {rows.map((r) => (
                <li key={r.id}>
                  <strong>{r.channelLabel}</strong> — {r.direction === 'open' ? 'raised' : 'cleared'}:{' '}
                  {r.sentAt ? (
                    <>
                      delivered <When iso={r.sentAt} />
                    </>
                  ) : r.heldUntil ? (
                    <>held for quiet hours until {new Date(r.heldUntil).toLocaleTimeString()}</>
                  ) : (
                    <span style={{ color: 'var(--bad)' }}>
                      not delivered after {plural(r.attempts, 'try', 'tries')}
                      {r.lastError ? ` (${r.lastError})` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </div>
  )
}
