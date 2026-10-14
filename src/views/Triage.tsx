import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AlertRow, Api, DeviceRow, ErrorGroupRow, Overview } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import { Button, Notice, Status } from '../components/ui.tsx'
import { duration, exact, timeAgo } from '../lib/format.ts'
import { tills } from '../lib/plain.ts'
import { TONE } from '../lib/state.ts'
import {
  buildQueue,
  FRESH_ERROR_MS,
  headline,
  type Item,
  type ShopSummary,
  shopLine,
  subline,
  summariseShops,
} from '../lib/triage.ts'
import { AssistantBriefCard } from './AssistantBriefCard.tsx'

/**
 * Home — the console's front door, written for whoever is on duty.
 *
 * Alerts, app problems and unhealthy tills used to live on three pages, and
 * answering "does anything need me" meant visiting all three and reconciling
 * them in your head. This page folds them into one list, once each, worst
 * first, and says each one the way the shop would say it on the phone, with
 * what usually fixes it underneath.
 *
 * What makes an item:
 *   - every open or acknowledged alert — the server already decided these;
 *   - every unhealthy till with NO open alert and no silence — the gap the
 *     evaluator has not covered (a warning-level reason, or a rule switched off);
 *   - every app problem seen in the last day — older ones are backlog,
 *     counted and linked, not listed.
 *
 * Below the list, every shop with a one-line answer to "is it all right?".
 */

const FLEET_PAGE = 200
/** Past this the shop list stops paging; a fleet that size needs the Tills page. */
const FLEET_MAX = 1000

const SHOP_STATE_LABEL = { healthy: 'Fine', attention: 'Needs a look', offline: 'Not connected' } as const

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
  const shops = useMemo(() => summariseShops(devices ?? []), [devices])

  const silenced = (devices ?? []).filter((d) => d.mute && d.state !== 'healthy').length
  const backlog = (groups ?? []).filter((g) => Date.now() - Date.parse(g.lastSeen) > FRESH_ERROR_MS).length
  const loading = alerts == null || devices == null
  const canAct = api.operator.role !== 'viewer'

  const takeOn = useCallback(
    async (item: Item) => {
      const ids = new Set((item.alerts ?? []).filter((a) => a.state === 'open').map((a) => a.id))
      if (ids.size === 0) return
      setAcking(item.key)
      // Optimistic: the row moves to "Being handled" now, not after the round trip.
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
        setError(err instanceof Error ? err.message : 'Could not mark that as being handled')
      } finally {
        setAcking(null)
        void load()
      }
    },
    [api, load],
  )

  // j/k to move, Enter to open, a to take one on. Nothing on the page asks
  // anyone to learn these; they are there for whoever already reaches for them
  // (and listed under ?).
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
          void takeOn(item)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, cursor, canAct, takeOn])

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
      </div>

      {error && <Notice>{error}</Notice>}

      <div className="triage-layout">
        <div className="triage-main">
          <section className="queue" aria-label="Things that need a look">
            {loading ? (
              <QueueSkeleton />
            ) : ordered.length === 0 ? (
              <AllClear total={counts?.all ?? devices?.length ?? 0} />
            ) : (
              <>
                <QueueGroup
                  label="Needs a look"
                  items={needs}
                  offset={0}
                  active={active}
                  acking={acking}
                  canAct={canAct}
                  onHover={setCursor}
                  onTakeOn={takeOn}
                />
                {inHand.length > 0 && (
                  <QueueGroup
                    label="Being handled"
                    note="Someone is on these. They leave the list once the problem is gone."
                    items={inHand}
                    offset={needs.length}
                    active={active}
                    acking={acking}
                    canAct={canAct}
                    onHover={setCursor}
                    onTakeOn={takeOn}
                  />
                )}
              </>
            )}
            {(silenced > 0 || backlog > 0) && (
              <div className="queue-foot">
                {silenced > 0 && (
                  <button type="button" className="linkish" onClick={() => onNavigate('terminals', { muted: 'muted' })}>
                    <Icon name="mute" size={14} />
                    {tills(silenced)} with problems {silenced === 1 ? 'is' : 'are'} paused on purpose
                  </button>
                )}
                {backlog > 0 && (
                  <button type="button" className="linkish" onClick={() => onNavigate('errors')}>
                    <Icon name="bug" size={14} />
                    {backlog} older app problem{backlog === 1 ? '' : 's'}, not seen today
                  </button>
                )}
              </div>
            )}
          </section>

          <ShopList
            shops={shops}
            loading={devices == null}
            truncated={truncated}
            onOpen={(s) => (s.shopId ? onNavigate('shop', { id: s.shopId }) : onNavigate('terminals'))}
            onAll={() => onNavigate('shops')}
          />
        </div>

        <aside className="triage-side">
          {aiOn && <AssistantBriefCard api={api} onUnauthorized={onUnauthorized} />}
          {overview && <AtAGlance overview={overview} apiBase={api.apiBase} onNavigate={onNavigate} />}
        </aside>
      </div>
    </>
  )
}

/* --------------------------------------------------------------------- list */

function QueueGroup({
  label,
  note,
  items,
  offset,
  active,
  acking,
  canAct,
  onHover,
  onTakeOn,
}: {
  label: string
  note?: string
  items: Item[]
  offset: number
  active: number
  acking: string | null
  canAct: boolean
  onHover: (i: number) => void
  onTakeOn: (item: Item) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="queue-group">
      <h2 className="queue-label">
        {label}
        {note && <span className="queue-note">{note}</span>}
      </h2>
      <ul className="queue-list">
        {items.map((item, i) => {
          const who = item.alerts?.[0]?.acknowledgedByLabel
          // Eight shops dark at once should read as eight shops, not the same
          // advice eight times: the advice goes on the first row it applies to.
          const hint = item.hint && items.findIndex((x) => x.hint === item.hint) === i ? item.hint : null
          return (
            <li
              key={item.key}
              className="qi"
              data-severity={item.severity}
              data-acknowledged={item.acknowledged || undefined}
              data-cursor={offset + i === active || undefined}
              onMouseEnter={() => onHover(offset + i)}
            >
              <span className="qi-mark" aria-hidden="true">
                <Icon name={item.kind === 'error' ? 'bug' : item.kind === 'alert' ? 'bell' : 'terminals'} size={14} />
              </span>
              <button type="button" className="qi-body" onClick={item.open} title={item.tech ?? undefined}>
                <span className="qi-title">
                  <span className="sr-only">{item.severity === 'critical' ? 'Urgent: ' : ''}</span>
                  {item.title}
                </span>
                {item.where && <span className="qi-where">{item.where}</span>}
                {hint && <span className="qi-hint">{hint}</span>}
              </button>
              <span className="qi-when" title={item.whenTitle}>
                {item.when}
              </span>
              <span className="qi-actions">
                {!item.acknowledged && item.alerts?.length && canAct ? (
                  <Button size="sm" busy={acking === item.key} busyLabel="Saving" onClick={() => onTakeOn(item)}>
                    I’m on it
                  </Button>
                ) : null}
                {item.acknowledged && who && <span className="qi-who">{who} is on it</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="queue-group" aria-hidden="true">
      <div className="skeleton" style={{ width: 120, height: 12, marginBottom: 12 }} />
      {[68, 54, 61].map((w, i) => (
        <div className="qi qi-skel" key={i}>
          <span className="skeleton" style={{ width: 28, height: 28, borderRadius: 999 }} />
          <span style={{ display: 'grid', gap: 8, flex: 1 }}>
            <span className="skeleton" style={{ width: `${w}%`, height: 14 }} />
            <span className="skeleton" style={{ width: `${w - 22}%`, height: 11 }} />
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
        <p className="strong">Nothing needs you right now</p>
        <p className="hint">
          {total > 0
            ? `All ${tills(total)} are connected and working. If something goes wrong, it shows up here within a minute — no need to keep checking.`
            : 'Once tills are installed and switched on, anything that needs a person shows up here.'}
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- shops */

/**
 * Every shop, one line each. Shops with a problem are always shown; the fine
 * ones fold away behind a count once there are enough to push the list off
 * the screen, because a long column of "All 3 tills fine" is reading nobody
 * needs to do.
 */
const FINE_SHOWN = 6

function ShopList({
  shops,
  loading,
  truncated,
  onOpen,
  onAll,
}: {
  shops: ShopSummary[]
  loading: boolean
  truncated: boolean
  onOpen: (s: ShopSummary) => void
  onAll: () => void
}) {
  const [showFine, setShowFine] = useState(false)
  const trouble = shops.filter((s) => s.state !== 'healthy')
  const fine = shops.filter((s) => s.state === 'healthy')
  const foldFine = fine.length > FINE_SHOWN && !showFine
  const shown = foldFine ? trouble : shops

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Your shops</h2>
        <button type="button" className="linkish small" onClick={onAll}>
          See all shops
        </button>
      </div>
      {loading ? (
        <div className="panel-body">
          <div className="shop-list-skeleton skeleton" aria-hidden="true" />
        </div>
      ) : shops.length === 0 ? (
        <div className="panel-body">
          <p className="hint">
            No till has connected yet. A till appears here a few minutes after SmartSort is first opened on it.
          </p>
        </div>
      ) : (
        <>
          <ul className="shop-list">
            {shown.map((s) => (
              <li key={s.key}>
                <button type="button" className="shop-row" onClick={() => onOpen(s)}>
                  <span className="shop-row-name">{s.name}</span>
                  <span className="shop-row-line">
                    {shopLine(s)}
                    {s.state === 'healthy' && s.fine < s.total ? ' · paused on purpose' : ''}
                  </span>
                  <Status tone={TONE[s.state]} label={SHOP_STATE_LABEL[s.state]} />
                </button>
              </li>
            ))}
          </ul>
          {(foldFine || truncated) && (
            <div className="shop-list-foot">
              {foldFine && (
                <button type="button" className="linkish" onClick={() => setShowFine(true)}>
                  <Icon name="check" size={14} />
                  {trouble.length === 0 ? 'All' : 'The other'} {fine.length} shops are fine — show them
                </button>
              )}
              {truncated && <span className="hint">Showing the first {FLEET_MAX} tills; the Shops page has the rest.</span>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------- at a glance */

/**
 * A few figures from history rather than the current moment, each with a
 * plain label. Context, read once — so no colour; none of it is a state.
 */
function AtAGlance({
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
  const share = top && all > 0 ? Math.round((top.count / all) * 100) : null
  const latest = overview.release?.latestVersion ?? null
  const installerHref = overview.release?.installer ? `${apiBase}/updates/${overview.release.installer}` : null
  const lag = overview.syncLagMs

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">At a glance</h2>
      </div>
      <dl className="vitals">
        <div className="vital">
          <dt>Tills connected, last 30 days</dt>
          <dd className="num">
            {overview.uptimeBps30d == null ? '—' : `${(overview.uptimeBps30d / 100).toFixed(1)}% of the time`}
          </dd>
        </div>
        <div className="vital">
          <dt>Time for a sale to reach the cloud</dt>
          <dd>
            {lag.p50 == null ? (
              'Nothing waiting'
            ) : (
              <span title={lag.p95 != null ? `Slowest 1 in 20: ${duration(lag.p95)}` : undefined}>
                {lag.p50 < 1000 ? 'Under a second' : `Usually ${duration(lag.p50)}`}
              </span>
            )}
          </dd>
        </div>
        <div className="vital">
          <dt>SmartSort version on most tills</dt>
          <dd>
            {top?.version ?? '—'}
            {share != null && <span className="vital-note">{share}% of tills</span>}
          </dd>
        </div>
        {latest && latest !== top?.version && (
          <div className="vital">
            <dt>Newer version ready</dt>
            <dd>
              <button type="button" className="linkish" onClick={() => onNavigate('rollouts')}>
                {latest}
              </button>
              <span className="vital-note">not sent to tills yet</span>
            </dd>
          </div>
        )}
        {overview.pendingCommands > 0 && (
          <div className="vital">
            <dt>Remote fixes waiting to run</dt>
            <dd>
              <button type="button" className="linkish" onClick={() => onNavigate('commands')}>
                {overview.pendingCommands}
              </button>
            </dd>
          </div>
        )}
        {overview.unverifiedDevices > 0 && (
          <div className="vital">
            <dt>Tills not linked to a shop</dt>
            <dd className="num">{overview.unverifiedDevices}</dd>
          </div>
        )}
      </dl>
      {installerHref && (
        <div className="vitals-foot">
          <a href={installerHref} target="_blank" rel="noreferrer">
            <Icon name="download" size={14} />
            Download SmartSort
          </a>
          {overview.release?.releasedAt && (
            <span className="muted" title={exact(overview.release.releasedAt)}>
              {timeAgo(overview.release.releasedAt)}
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
  for (let offset = 0; offset < FLEET_MAX; offset += FLEET_PAGE) {
    const page = await api.devices({ sort: 'shop', dir: 'asc', limit: FLEET_PAGE, offset })
    out.push(...page.devices)
    if (out.length >= page.total || page.devices.length < FLEET_PAGE) {
      return { devices: out, truncated: false }
    }
  }
  return { devices: out, truncated: true }
}
