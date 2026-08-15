import { useCallback, useEffect, useState } from 'react'
import type { AlertRow, Api, DeliveryRow, FleetConfigRow, RuleRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import type { Route } from '../lib/route.ts'
import { Icon } from '../components/Icon.tsx'
import { Button, Chip, Empty, Notice, Status, TableSkeleton } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'
import { ALERT_STATE_LABEL, ALERT_STATE_TONE, ruleLabel } from '../lib/state.ts'

type Tab = 'open' | 'acknowledged' | 'resolved' | 'all'

const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
]

/**
 * Alerts — the conditions the server decided were true without anyone looking.
 *
 * This page is the record, not the delivery mechanism: the evaluator has already
 * pushed each of these to the configured webhook once when it opened and once
 * when it cleared. What matters here is that an alert nobody could deliver says
 * so, rather than sitting quietly and looking handled.
 */
export function Alerts({
  api,
  route,
  reloadKey,
  onNavigate,
  onReplace,
}: {
  api: Api
  route: Route
  reloadKey: number
  onNavigate: Navigate
  onReplace: (params: Record<string, string | undefined>) => void
}) {
  const tab = (route.params.state as Tab | undefined) ?? 'open'
  const setTab = (next: Tab) => onReplace({ state: next === 'open' ? undefined : next })
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [webhook, setWebhook] = useState<FleetConfigRow | null>(null)
  const [rules, setRules] = useState<RuleRow[]>([])

  const load = useCallback(async () => {
    try {
      setAlerts(await api.alerts(tab))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load alerts')
    }
  }, [api, tab])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  // Runbook links, so a page arrives with what to do about it rather than only
  // a description of the problem.
  useEffect(() => {
    void api
      .rules()
      .then(setRules)
      .catch(() => setRules([]))
  }, [api])

  useEffect(() => {
    let live = true
    api
      .fleetConfig()
      .then(({ config }) => live && setWebhook(config))
      .catch(() => {}) // Non-admins can still read this; a failure here just hides the chip.
    return () => {
      live = false
    }
  }, [api, reloadKey])

  async function acknowledge(id: string) {
    setBusyId(id)
    try {
      await api.acknowledgeAlert(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge that alert')
    } finally {
      setBusyId(null)
    }
  }

  async function acknowledgeAll() {
    const open = (alerts ?? []).filter((a) => a.state === 'open')
    if (open.length === 0) return
    setBusyId('*')
    setError(null)
    try {
      // Bounded concurrency: quick for a handful, not a stampede for a hundred.
      for (let i = 0; i < open.length; i += 5) {
        await Promise.all(
          open.slice(i, i + 5).map((a) => api.acknowledgeAlert(a.id).catch(() => {})),
        )
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge every alert')
    } finally {
      setBusyId(null)
    }
  }

  const undelivered = (alerts ?? []).filter((a) => a.notifyError != null)
  const openCount = (alerts ?? []).filter((a) => a.state === 'open').length

  async function evaluate() {
    setEvaluating(true)
    setError(null)
    try {
      await api.evaluateAlerts()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the evaluator')
    } finally {
      setEvaluating(false)
    }
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Alerts</h1>
          <p className="view-sub">
            Conditions the server noticed on its own and pushed out. One alert per condition per
            terminal, notified once when it opens and once when it clears. Re-evaluated every
            minute on its own.
          </p>
        </div>
        {api.operator.role !== 'viewer' && (
          <Button size="sm" variant="ghost" busy={evaluating} onClick={() => void evaluate()}>
            <Icon name="refresh" size={14} />
            Re-check now
          </Button>
        )}
      </div>

      <WebhookHealth config={webhook} />

      {error && <Notice>{error}</Notice>}

      {undelivered.length > 0 && (
        <Notice>
          {undelivered.length} alert{undelivered.length === 1 ? '' : 's'} could not be delivered to
          the configured webhook. Nobody was paged for {undelivered.length === 1 ? 'it' : 'them'}.
        </Notice>
      )}

      <section className="panel">
        <div className="toolbar">
          <div className="filters" role="group" aria-label="Filter by alert state">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="key"
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {openCount > 0 && api.operator.role !== 'viewer' && (
            <div className="toolbar-end">
              <Button
                size="sm"
                variant="ghost"
                busy={busyId === '*'}
                onClick={() => void acknowledgeAll()}
              >
                Acknowledge all open ({openCount})
              </Button>
            </div>
          )}
        </div>

        {alerts == null ? (
          <TableSkeleton rows={4} />
        ) : alerts.length === 0 ? (
          <Empty icon={tab === 'open' ? 'check' : 'inbox'} title={emptyTitle(tab)}>
            {tab === 'open'
              ? 'No terminal is offline, backed up or erroring. The evaluator runs every minute; anything it finds appears here and goes out to the webhook at the same time.'
              : 'Nothing matches this filter.'}
          </Empty>
        ) : (
          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={a.id} className="alert" data-severity={a.severity}>
                <div className="alert-main">
                  <div className="alert-head">
                    <Status
                      tone={ALERT_STATE_TONE[a.state]}
                      label={ALERT_STATE_LABEL[a.state]}
                    />
                    <Chip tone={a.severity === 'critical' ? 'bad' : 'warn'}>
                      {ruleLabel(a.ruleKey)}
                    </Chip>
                    {a.notifyError && <Chip tone="bad">Not delivered</Chip>}
                    {/* A rollup stands in for several terminals: saying so is
                        what stops it reading as one till having a bad day. */}
                    {a.rollupCount != null && a.rollupCount > 1 && (
                      <Chip tone="bad">{a.rollupCount} terminals</Chip>
                    )}
                    {a.escalations > 0 && (
                      <Chip tone="warn">
                        Re-paged {a.escalations}×
                      </Chip>
                    )}
                    <RunbookLink ruleKey={a.ruleKey} rules={rules} />
                  </div>

                  <div className="alert-title">{a.title}</div>
                  {a.detail && <div className="alert-detail">{a.detail}</div>}

                  <div className="alert-meta">
                    <span title={exact(a.openedAt)}>Opened {timeAgo(a.openedAt)}</span>
                    {a.acknowledgedAt && (
                      <span title={exact(a.acknowledgedAt)}>
                        · Acknowledged {timeAgo(a.acknowledgedAt)}
                        {a.acknowledgedByLabel ? ` by ${a.acknowledgedByLabel}` : ''}
                      </span>
                    )}
                    {a.resolvedAt && (
                      <span title={exact(a.resolvedAt)}>· Resolved {timeAgo(a.resolvedAt)}</span>
                    )}
                    {a.notifiedAt && <span>· Notified {timeAgo(a.notifiedAt)}</span>}
                    {a.notifyError && <span className="bad-text">· {a.notifyError}</span>}
                  </div>

                  {/* Where this page actually went, per channel. "Notified" is
                      one bit; with several destinations the useful question is
                      which of them heard, and a held one says when it will. */}
                  <Deliveries api={api} alertId={a.id} />
                </div>

                <div className="alert-actions">
                  {a.deviceId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onNavigate('device', { id: a.deviceId! })}
                    >
                      <Icon name="link" size={14} />
                      Terminal
                    </Button>
                  )}
                  {a.state === 'open' && (
                    <Button
                      size="sm"
                      busy={busyId === a.id}
                      onClick={() => void acknowledge(a.id)}
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/**
 * Is the webhook itself reachable — distinct from any one alert's own
 * `notifyError`. A run of failed attempts here usually means the URL or
 * secret is wrong, not that every terminal broke at once.
 */
function WebhookHealth({ config }: { config: FleetConfigRow | null }) {
  if (config == null) return null
  const { webhookLastSuccessAt: success, webhookLastFailureAt: failure } = config
  if (success == null && failure == null) return null // Nothing sent yet — not a verdict either way.

  const failing = failure != null && (success == null || new Date(failure) > new Date(success))

  return (
    <div className="hint" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="dot" data-tone={failing ? 'bad' : 'ok'} />
      {failing ? (
        <>
          Webhook delivery failing — last attempt {timeAgo(failure)}
          {config.webhookLastFailureError && `: ${config.webhookLastFailureError}`}
        </>
      ) : (
        <>Webhook delivering — last success {timeAgo(success)}</>
      )}
    </div>
  )
}

/**
 * Where this alert went, per channel — loaded on demand.
 *
 * "Notified 4m ago" is one bit of information and it was true when there was
 * one destination. With several, the useful question is which of them actually
 * heard: a room that took it, a pager that is failing, a phone whose message is
 * held until the quiet window closes. A held delivery says when it will arrive,
 * because "quiet" and "lost" must never look the same.
 */
function Deliveries({ api, alertId }: { api: Api; alertId: string }) {
  const [rows, setRows] = useState<DeliveryRow[] | null>(null)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        className="row-open small"
        onClick={() => {
          setOpen(true)
          void api
            .alertDeliveries(alertId)
            .then(setRows)
            .catch(() => setRows([]))
        }}
      >
        Where did this go?
      </button>
    )
  }

  if (rows == null) return <div className="skeleton" style={{ width: '40%', marginTop: 6 }} />
  if (rows.length === 0) {
    return (
      <p className="muted small" style={{ marginTop: 6 }}>
        No channel took this one — nothing is configured that wanted it.
      </p>
    )
  }

  return (
    <ul className="plain-list" style={{ marginTop: 6 }}>
      {rows.map((d) => (
        <li key={d.id} className="muted small">
          <b>{d.channelLabel}</b> · {d.direction}
          {d.sentAt ? (
            <span className="ok-text"> · delivered {timeAgo(d.sentAt)}</span>
          ) : d.heldUntil ? (
            <span> · held until {exact(d.heldUntil)}{d.lastError ? ` (${d.lastError})` : ''}</span>
          ) : (
            <span className="bad-text">
              {' '}
              · not delivered{d.attempts > 0 ? ` after ${d.attempts} attempt(s)` : ''}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The link to what to do about this rule, when somebody has recorded one. */
function RunbookLink({ ruleKey, rules }: { ruleKey: string; rules: RuleRow[] }) {
  const rule = rules.find((r) => r.key === ruleKey)
  if (!rule?.runbookUrl) return null
  return (
    <a className="row-open small" href={rule.runbookUrl} target="_blank" rel="noreferrer">
      Runbook
    </a>
  )
}

function emptyTitle(tab: Tab): string {
  switch (tab) {
    case 'open':
      return 'Nothing needs attention'
    case 'acknowledged':
      return 'Nothing acknowledged'
    case 'resolved':
      return 'Nothing resolved yet'
    default:
      return 'No alerts'
  }
}
