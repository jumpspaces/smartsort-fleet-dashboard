import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AlertRow, Api, DeviceRow, ErrorGroupRow, Overview } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { FleetWall } from '../components/FleetWall.tsx'
import { Icon } from '../components/Icon.tsx'
import { Button, Notice } from '../components/ui.tsx'
import { duration, exact, timeAgo } from '../lib/format.ts'
import { buildQueue, FRESH_ERROR_MS, headline, type Item, subline } from '../lib/triage.ts'
import { AssistantBriefCard } from './AssistantBriefCard.tsx'

/**
 * Triage — the console's front door.
 *
 * Alerts, error groups and unhealthy terminals used to live on three pages, and
 * answering "does anything need me" meant visiting all three and reconciling
 * them in your head: the offline till on Terminals is the same thing as the
 * open "Terminal offline" alert on Alerts. This page folds them into one queue,
 * once each, worst first.
 *
 * What makes an item:
 *   - every open or acknowledged alert — the server already decided these;
 *   - every unhealthy terminal with NO open alert and no silence — the gap the
 *     evaluator has not covered (a warning-level reason, or a rule switched off);
 *   - every open error group seen in the last day — older ones are backlog,
 *     counted and linked, not queued.
 *
 * Below the queue, the whole fleet as a wall of squares: the queue says what,
 * the wall says where and how much.
 */

const WALL_PAGE = 200
/** Past this the wall stops paging; a fleet that size needs the table. */
const WALL_MAX = 1000

export function Triage({
  api,
  overview,
  reloadKey,
  onNavigate,
  onUnauthorized,
}: {
  api: Api
  overview: Overview | null
  reloadKey: number
  onNavigate: Navigate
  onUnauthorized: () => void
}) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null)
  const [groups, setGroups] = useState<ErrorGroupRow[] | null>(null)
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [acking, setAcking] = useState<string | null>(null)
  const [aiOn, setAiOn] = useState(false)

  const load = useCallback(async () => {
    try {
      const [open, acked, errs, fleet] = await Promise.all([
        api.alerts('open'),
        api.alerts('acknowledged'),
        api.errorGroups({ status: 'open', limit: 100 }),
        loadFleet(api),
      ])
      setAlerts([...open, ...acked])
      setGroups(errs.groups)
      setDevices(fleet.devices)
      setTruncated(fleet.truncated)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the fleet server')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  // The brief costs a model call, so it only appears where the switch is on.
  useEffect(() => {
    let live = true
    api
      .assistantSwitches()
      .then((s) => live && setAiOn(s.systemEnabled))
      .catch(() => live && setAiOn(false))
    return () => {
      live = false
    }
  }, [api])

  const items = useMemo(
    () => buildQueue(alerts ?? [], groups ?? [], devices ?? [], onNavigate),
    [alerts, groups, devices, onNavigate],
  )
  const { needs, inHand, ordered } = useMemo(() => {
    const needs = items.filter((i) => !i.acknowledged)
    const inHand = items.filter((i) => i.acknowledged)
    return { needs, inHand, ordered: [...needs, ...inHand] }
  }, [items])

  const silenced = (devices ?? []).filter((d) => d.mute && d.state !== 'healthy').length
  const backlog = (groups ?? []).filter((g) => Date.now() - Date.parse(g.lastSeen) > FRESH_ERROR_MS).length
  const loading = alerts == null || devices == null
  const canAct = api.operator.role !== 'viewer'

  const acknowledge = useCallback(
    async (item: Item) => {
      const ids = new Set((item.alerts ?? []).filter((a) => a.state === 'open').map((a) => a.id))
      if (ids.size === 0) return
      setAcking(item.key)
      // Optimistic: the row moves to "In hand" now, not after the round trip.
      setAlerts((cur) =>
        cur?.map((a) =>
          ids.has(a.id)
            ? { ...a, state: 'acknowledged', acknowledgedAt: new Date().toISOString(), acknowledgedByLabel: api.operator.name }
            : a,
        ) ?? cur,
      )
      try {
        await Promise.all([...ids].map((id) => api.acknowledgeAlert(id)))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not acknowledge that alert')
      } finally {
        setAcking(null)
        void load()
      }
    },
    [api, load],
  )

  // j/k to move, Enter to open, a to acknowledge — the inbox keys every
  // operator already has in their fingers from mail and issue trackers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('.palette-backdrop')) return
      if (ordered.length === 0) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, ordered.length - 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      } else if (e.key === 'Enter' && el?.tagName !== 'BUTTON') {
        e.preventDefault()
        ordered[Math.min(cursor, ordered.length - 1)]?.open()
      } else if (e.key === 'a' && canAct) {
        const item = ordered[Math.min(cursor, ordered.length - 1)]
        if (item && !item.acknowledged && item.alerts?.length) {
          e.preventDefault()
          void acknowledge(item)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, cursor, canAct, acknowledge])

  useEffect(() => {
    document.querySelector(`[data-cursor='true']`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const counts = overview?.counts
  const active = Math.min(cursor, ordered.length - 1)

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">{headline(needs.length, loading)}</h1>
          <p className="view-sub">{subline(counts, needs.length, inHand.length)}</p>
        </div>
        {ordered.length > 0 && (
          <p className="triage-keys" aria-hidden="true">
            <span><kbd>j</kbd><kbd>k</kbd> move</span>
            <span><kbd>↵</kbd> open</span>
            {canAct && <span><kbd>a</kbd> acknowledge</span>}
          </p>
        )}
      </div>

      {error && <Notice>{error}</Notice>}

      <div className="triage-layout">
        <div className="triage-main">
          <section className="queue" aria-label="Needs attention">
            {loading ? (
              <QueueSkeleton />
            ) : ordered.length === 0 ? (
              <AllClear total={counts?.all ?? devices?.length ?? 0} />
            ) : (
              <>
                <QueueGroup
                  label="Needs you"
                  count={needs.length}
                  items={needs}
                  offset={0}
                  active={active}
                  acking={acking}
                  canAct={canAct}
                  onHover={setCursor}
                  onAcknowledge={acknowledge}
                />
                {inHand.length > 0 && (
                  <QueueGroup
                    label="In hand"
                    note="Acknowledged; still open until the condition clears"
                    count={inHand.length}
                    items={inHand}
                    offset={needs.length}
                    active={active}
                    acking={acking}
                    canAct={canAct}
                    onHover={setCursor}
                    onAcknowledge={acknowledge}
                  />
                )}
              </>
            )}
            {(silenced > 0 || backlog > 0) && (
              <div className="queue-foot">
                {silenced > 0 && (
                  <button type="button" className="linkish" onClick={() => onNavigate('terminals', { muted: 'muted' })}>
                    <Icon name="mute" size={14} />
                    {silenced} unhealthy terminal{silenced === 1 ? '' : 's'} silenced
                  </button>
                )}
                {backlog > 0 && (
                  <button type="button" className="linkish" onClick={() => onNavigate('errors')}>
                    <Icon name="bug" size={14} />
                    {backlog} older open error{backlog === 1 ? '' : 's'} not seen today
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Fleet</h2>
              {counts && (
                <div className="wall-legend">
                  <LegendKey state="healthy" n={counts.healthy} label="healthy" onClick={() => onNavigate('terminals', { state: 'healthy' })} />
                  <LegendKey state="attention" n={counts.attention} label="attention" onClick={() => onNavigate('terminals', { state: 'attention' })} />
                  <LegendKey state="offline" n={counts.offline} label="offline" onClick={() => onNavigate('terminals', { state: 'offline' })} />
                </div>
              )}
            </div>
            <div className="panel-body">
              {devices == null ? (
                <div className="wall-skeleton skeleton" aria-hidden="true" />
              ) : devices.length === 0 ? (
                <p className="hint">
                  No terminal has reported in yet. Installed tills appear here within three minutes of their first
                  start-up.
                </p>
              ) : (
                <>
                  <FleetWall devices={devices} onOpen={(d) => onNavigate('device', { id: d.deviceId })} />
                  {truncated && (
                    <p className="hint" style={{ marginTop: 12 }}>
                      Showing the first {WALL_MAX}.{' '}
                      <button type="button" className="linkish" onClick={() => onNavigate('terminals')}>
                        The terminals table has the rest.
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        <aside className="triage-side">
          {overview && <Vitals overview={overview} apiBase={api.apiBase} onNavigate={onNavigate} />}
          {aiOn && <AssistantBriefCard api={api} onUnauthorized={onUnauthorized} />}
        </aside>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------- queue */

function QueueGroup({
  label,
  note,
  count,
  items,
  offset,
  active,
  acking,
  canAct,
  onHover,
  onAcknowledge,
}: {
  label: string
  note?: string
  count: number
  items: Item[]
  offset: number
  active: number
  acking: string | null
  canAct: boolean
  onHover: (i: number) => void
  onAcknowledge: (item: Item) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="queue-group">
      <h2 className="queue-label">
        {label} <span className="num">{count}</span>
        {note && <span className="queue-note">{note}</span>}
      </h2>
      <ul className="queue-list">
        {items.map((item, i) => (
          <li
            key={item.key}
            className="qi"
            data-severity={item.severity}
            data-acknowledged={item.acknowledged || undefined}
            data-cursor={offset + i === active || undefined}
            onMouseEnter={() => onHover(offset + i)}
          >
            <span className="qi-mark" data-kind={item.kind} aria-hidden="true">
              <Icon name={item.kind === 'error' ? 'bug' : item.kind === 'alert' ? 'bell' : 'terminals'} size={14} />
            </span>
            <button type="button" className="qi-body" onClick={item.open}>
              <span className="qi-title">
                <span className="sr-only">{item.severity === 'critical' ? 'Critical: ' : 'Warning: '}</span>
                {item.title}
              </span>
              <span className="qi-meta">
                {item.where && <span className="qi-where">{item.where}</span>}
                {item.detail && <span className="qi-detail">{item.detail}</span>}
              </span>
            </button>
            <span className="qi-when num" title={item.whenTitle}>
              {item.when}
            </span>
            <span className="qi-actions">
              {!item.acknowledged && item.alerts?.length && canAct ? (
                <Button size="sm" busy={acking === item.key} busyLabel="Acknowledging" onClick={() => onAcknowledge(item)}>
                  Acknowledge
                </Button>
              ) : null}
              {item.acknowledged && item.alerts?.[0]?.acknowledgedByLabel && (
                <span className="qi-who">{item.alerts[0].acknowledgedByLabel}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="queue-group" aria-hidden="true">
      <div className="skeleton" style={{ width: 120, height: 12, marginBottom: 12 }} />
      {[68, 54, 61, 47].map((w, i) => (
        <div className="qi qi-skel" key={i}>
          <span className="skeleton" style={{ width: 22, height: 22, borderRadius: 6 }} />
          <span style={{ display: 'grid', gap: 6, flex: 1 }}>
            <span className="skeleton" style={{ width: `${w}%`, height: 12 }} />
            <span className="skeleton" style={{ width: `${w - 22}%`, height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function AllClear({ total }: { total: number }) {
  return (
    <div className="all-clear">
      <span className="all-clear-mark" aria-hidden="true">
        <Icon name="check" size={18} />
      </span>
      <div>
        <p className="strong">Nothing needs you</p>
        <p className="hint">
          {total > 0
            ? `No open alerts, no unhealthy terminals and no new errors today across ${total} terminal${total === 1 ? '' : 's'}. New problems land at the top of this page within a minute.`
            : 'Once terminals start reporting, anything that needs a person lands here.'}
        </p>
      </div>
    </div>
  )
}

function LegendKey({
  state,
  n,
  label,
  onClick,
}: {
  state: 'healthy' | 'attention' | 'offline'
  n: number
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" className="key" onClick={onClick} title={`Show ${label} terminals`}>
      <span className="tile tile-key" data-state={state} aria-hidden="true" />
      <b>{n}</b> {label}
    </button>
  )
}

/* ------------------------------------------------------------------- vitals */

/**
 * The figures that come from history rather than the current snapshot. A list,
 * not a row of stat cards: they are context for the queue, read once, and
 * carry no colour — nothing here is a fleet state.
 */
function Vitals({
  overview,
  apiBase,
  onNavigate,
}: {
  overview: Overview
  apiBase: string
  onNavigate: Navigate
}) {
  const top = overview.versions[0]
  const all = overview.counts.all
  const adoption = top && all > 0 ? Math.round((top.count / all) * 100) : null
  const latest = overview.release?.latestVersion ?? null
  const installerHref = overview.release?.installer ? `${apiBase}/updates/${overview.release.installer}` : null

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Vitals</h2>
        <button type="button" className="linkish small" onClick={() => onNavigate('trends')}>
          Trends
        </button>
      </div>
      <dl className="vitals">
        <div className="vital">
          <dt>Uptime, 30 days</dt>
          <dd className="num">
            {overview.uptimeBps30d == null ? '—' : `${(overview.uptimeBps30d / 100).toFixed(2)}%`}
          </dd>
        </div>
        <div className="vital">
          <dt>Sync lag, p95</dt>
          <dd className="num">
            {overview.syncLagMs.p95 == null ? 'Clear' : duration(overview.syncLagMs.p95)}
            {overview.syncLagMs.p50 != null && (
              <span className="vital-note">median {duration(overview.syncLagMs.p50)}</span>
            )}
          </dd>
        </div>
        <div className="vital">
          <dt>Running build</dt>
          <dd>
            <span className="mono">{top?.version ?? '—'}</span>
            {adoption != null && (
              <span className="vital-note">
                {adoption}% · {overview.versions.length} live
              </span>
            )}
          </dd>
        </div>
        {latest && latest !== top?.version && (
          <div className="vital">
            <dt>Published</dt>
            <dd>
              <button type="button" className="linkish mono" onClick={() => onNavigate('rollouts')}>
                {latest}
              </button>
              <span className="vital-note">not yet rolled out</span>
            </dd>
          </div>
        )}
        <div className="vital">
          <dt>Queued commands</dt>
          <dd className="num">
            {overview.pendingCommands > 0 ? (
              <button type="button" className="linkish" onClick={() => onNavigate('commands')}>
                {overview.pendingCommands}
              </button>
            ) : (
              '0'
            )}
          </dd>
        </div>
        <div className="vital">
          <dt>Unverified keys</dt>
          <dd className="num">{overview.unverifiedDevices}</dd>
        </div>
      </dl>
      {installerHref && (
        <div className="vitals-foot">
          <a href={installerHref} target="_blank" rel="noreferrer">
            <Icon name="download" size={14} />
            Installer
          </a>
          {overview.release?.releasedAt && (
            <span className="muted" title={exact(overview.release.releasedAt)}>
              published {timeAgo(overview.release.releasedAt)}
            </span>
          )}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------- model */

async function loadFleet(api: Api): Promise<{ devices: DeviceRow[]; truncated: boolean }> {
  const out: DeviceRow[] = []
  for (let offset = 0; offset < WALL_MAX; offset += WALL_PAGE) {
    const page = await api.devices({ sort: 'shop', dir: 'asc', limit: WALL_PAGE, offset })
    out.push(...page.devices)
    if (out.length >= page.total || page.devices.length < WALL_PAGE) {
      return { devices: out, truncated: false }
    }
  }
  return { devices: out, truncated: true }
}
