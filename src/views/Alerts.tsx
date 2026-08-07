import { useCallback, useEffect, useState } from 'react'
import type { AlertRow, Api } from '../api.ts'
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

  const undelivered = (alerts ?? []).filter((a) => a.notifyError != null)

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
                </div>

                <div className="alert-actions">
                  {a.deviceId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onNavigate('terminals', { device: a.deviceId! })}
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
