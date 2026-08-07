import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, DeviceRow, FleetState, Overview } from '../api.ts'
import type { Navigate } from '../App.tsx'
import type { Route } from '../lib/route.ts'
import { Icon } from '../components/Icon.tsx'
import { PlainHeader, SortHeader, type Sort } from '../components/SortHeader.tsx'
import { Button, Chip, Empty, Notice, Status, TableSkeleton } from '../components/ui.tsx'
import { cedis, duration, exact, timeAgo } from '../lib/format.ts'
import { primaryReason, STATE_LABEL, TONE } from '../lib/state.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { useHotkey } from '../lib/useHotkey.ts'
import { DeviceDrawer } from './DeviceDrawer.tsx'
import { Rollout } from './Rollout.tsx'

type SortKey = 'state' | 'shop' | 'version' | 'sync' | 'sales' | 'errors' | 'lastSeen'
type Filter = 'all' | FleetState

const PAGE_SIZE = 50

export function Terminals({
  api,
  route,
  overview,
  reloadKey,
  onNavigate,
  onReplace,
}: {
  api: Api
  route: Route
  overview: Overview | null
  reloadKey: number
  onNavigate: Navigate
  onReplace: (params: Record<string, string | undefined>) => void
}) {
  // The URL is the source of truth for everything shareable: filters, sort, page
  // and which drawer is open. A link to a broken terminal is the single most
  // useful thing one operator can send another.
  const filter = (route.params.state as Filter | undefined) ?? 'all'
  const shopId = route.params.shopId
  const platform = route.params.platform
  const appVersion = route.params.version
  const openDeviceId = route.params.device
  const offset = Number(route.params.offset ?? 0) || 0
  const sort: Sort<SortKey> = {
    key: (route.params.sort as SortKey | undefined) ?? 'state',
    dir: route.params.dir === 'desc' ? 'desc' : 'asc',
  }

  // Search is local while typing and mirrored to the URL once it settles —
  // writing every keystroke would make Back walk letter by letter.
  const [query, setQuery] = useState(route.params.q ?? '')
  const [rows, setRows] = useState<DeviceRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DeviceRow | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())
  const debouncedQuery = useDebounced(query)

  useEffect(() => {
    onReplace({ q: debouncedQuery.trim() || undefined, offset: undefined })
  }, [debouncedQuery, onReplace])

  const setFilter = (next: Filter) =>
    // Narrowing always returns to the first page: otherwise a tighter filter can
    // land on an offset past the end and read as "no terminals".
    onReplace({ state: next === 'all' ? undefined : next, offset: undefined })

  const setSort = (next: Sort<SortKey>) =>
    onReplace({ sort: next.key, dir: next.dir, offset: undefined })

  const setOffset = (next: number) =>
    onReplace({ offset: next > 0 ? String(next) : undefined })

  const load = useCallback(async () => {
    try {
      const page = await api.devices({
        q: debouncedQuery.trim() || undefined,
        state: filter,
        shopId,
        platform,
        appVersion,
        sort: sort.key,
        dir: sort.dir,
        limit: PAGE_SIZE,
        offset,
      })
      setRows(page.devices)
      setTotal(page.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the fleet server')
    }
  }, [api, debouncedQuery, filter, shopId, platform, appVersion, sort.key, sort.dir, offset])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  // Deep-linked (?device=…): open that terminal's drawer, whether the link came
  // from an alert, an error group, or somebody's chat message.
  useEffect(() => {
    if (!openDeviceId) {
      setSelected(null)
      return
    }
    let live = true
    api
      .device(openDeviceId)
      .then((d) => live && setSelected(d))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [api, openDeviceId])

  const counts = overview?.counts
  const filtering =
    filter !== 'all' || query.trim() !== '' || shopId != null || platform != null || appVersion != null
  const shopLabel = shopId ? (rows?.[0]?.shopName ?? 'this shop') : null

  const clearAll = () => {
    setQuery('')
    onReplace({
      q: undefined,
      state: undefined,
      shopId: undefined,
      platform: undefined,
      version: undefined,
      offset: undefined,
    })
  }

  // Click a build or platform in the table to narrow to it — the cheapest way to
  // ask "who else is on this" without a separate distinct-values endpoint.
  const setPlatform = (next: string | undefined) => onReplace({ platform: next, offset: undefined })
  const setVersionFilter = (next: string | undefined) => onReplace({ version: next, offset: undefined })

  const openDevice = (d: DeviceRow) => onReplace({ device: d.deviceId })
  const closeDevice = () => onReplace({ device: undefined })

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Terminals</h1>
          <p className="view-sub">
            Every install that has reported in. Each one checks in about every three minutes.
          </p>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {overview && <Kpis overview={overview} apiBase={api.apiBase} />}

      <section className="panel">
        <Gauge counts={counts} loading={rows == null} />

        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              className="input"
              type="search"
              value={query}
              placeholder="Search shop, device, version…"
              aria-label="Search terminals"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>

          <div className="filters" role="group" aria-label="Filter by state">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="key"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(filter === f.id && f.id !== 'all' ? 'all' : f.id)}
              >
                {f.tone && <span className="dot" data-tone={f.tone} />}
                {counts && <b>{counts[f.id]}</b>}
                {f.label}
              </button>
            ))}
          </div>

          {filtering && (
            <div className="toolbar-end">
              {shopId && <Chip tone="idle">Shop: {shopLabel}</Chip>}
              {platform && (
                <Chip tone="idle">
                  Platform: {platform}
                </Chip>
              )}
              {appVersion && (
                <Chip tone="idle">
                  Version: {appVersion}
                </Chip>
              )}
              <span>
                {total} {total === 1 ? 'match' : 'matches'}
              </span>
              <Button size="sm" variant="ghost" onClick={clearAll}>
                Clear
              </Button>
            </div>
          )}
        </div>

        {/* Rolling out acts on exactly what the filter above has selected, which
            is why it lives here rather than in a menu of its own. */}
        <Rollout
          api={api}
          query={{ q: debouncedQuery.trim() || undefined, state: filter, shopId, platform, appVersion }}
          total={total}
          canAct={api.operator.role !== 'viewer'}
          release={overview?.release ?? null}
          onIssued={() => void load()}
        />

        {rows == null ? (
          <TableSkeleton rows={6} />
        ) : total === 0 && !filtering ? (
          <Empty icon="terminals" title="No terminals have reported yet">
            A terminal appears here the first time its desktop app checks in. If one is installed
            and still missing, its build may be pointing at a different fleet URL.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty
            icon="search"
            title="Nothing matches those filters"
            action={
              <Button size="sm" onClick={clearAll}>
                Clear filters
              </Button>
            }
          >
            {counts?.all ?? 0} {(counts?.all ?? 0) === 1 ? 'terminal is' : 'terminals are'}{' '}
            reporting — none of them match.
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Status" sortKey="state" sort={sort} onSort={setSort} defaultDir="asc" />
                    <SortHeader label="Shop" sortKey="shop" sort={sort} onSort={setSort} defaultDir="asc" />
                    <SortHeader label="Version" sortKey="version" sort={sort} onSort={setSort} />
                    <PlainHeader label="Platform" />
                    <SortHeader label="Sync" sortKey="sync" sort={sort} onSort={setSort} />
                    <SortHeader label="Sales today" sortKey="sales" sort={sort} onSort={setSort} numeric />
                    <SortHeader label="Errors" sortKey="errors" sort={sort} onSort={setSort} numeric />
                    <SortHeader label="Last seen" sortKey="lastSeen" sort={sort} onSort={setSort} numeric />
                    <PlainHeader label="Open detail" srOnly />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.deviceId} data-clickable="true" onClick={() => openDevice(d)}>
                      <td>
                        <Status tone={TONE[d.state]} label={STATE_LABEL[d.state]} />
                        {/* The server says WHY, worst reason first. Showing it in
                            the row is what turns "Attention" from a colour into
                            something someone can act on without opening it. */}
                        {d.state !== 'healthy' && primaryReason(d.reasons) && (
                          <div className="row-sub">{primaryReason(d.reasons)}</div>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="row-open"
                          onClick={(e) => {
                            e.stopPropagation()
                            openDevice(d)
                          }}
                        >
                          {d.shopName ?? 'Unclaimed terminal'}
                        </button>
                        <div className="row-sub mono">
                          {d.deviceId.slice(0, 12)}
                          {!d.keyVerified && (
                            <span className="tag-warn" title="Reporting on the shared enrollment key">
                              unverified
                            </span>
                          )}
                        </div>
                      </td>
                      {/* The patched version when a terminal is carrying one,
                          because during a rollout that is the number being
                          watched. The installed version stays visible after it,
                          since which installer is on the machine still decides
                          what a patch is allowed to assume. */}
                      <td className="mono">
                        {d.appVersion ? (
                          <button
                            type="button"
                            className="row-open mono"
                            title="Filter to this version"
                            onClick={(e) => {
                              e.stopPropagation()
                              setVersionFilter(d.appVersion!)
                            }}
                          >
                            {d.bundleVersion ?? d.appVersion}
                          </button>
                        ) : (
                          '—'
                        )}
                        {d.bundleVersion && d.bundleVersion !== d.appVersion && (
                          <span className="muted small"> on {d.appVersion ?? '?'}</span>
                        )}
                      </td>
                      <td className="muted">
                        {d.platform ? (
                          <button
                            type="button"
                            className="row-open"
                            title="Filter to this platform"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPlatform(d.platform!)
                            }}
                          >
                            {d.platform}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{syncCell(d)}</td>
                      <td className="col-num">{salesCell(d)}</td>
                      <td className="col-num">
                        {d.recentOpenErrorGroups > 0 ? (
                          <Chip tone="warn">{d.recentOpenErrorGroups}</Chip>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="col-num muted" title={exact(d.lastReportAt)}>
                        {timeAgo(d.lastReportAt)}
                      </td>
                      <td style={{ width: 1, paddingLeft: 0 }}>
                        <Icon name="chevron" size={14} className="chev" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pager
              offset={offset}
              limit={PAGE_SIZE}
              total={total}
              onOffset={setOffset}
              noun="terminal"
            />
          </>
        )}
      </section>

      {selected && (
        <DeviceDrawer
          api={api}
          device={selected}
          onClose={closeDevice}
          onNavigate={onNavigate}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------------- kpis */

/**
 * The numbers a snapshot table cannot show: how available the fleet has BEEN,
 * how far behind the slowest queues are, and how far the current build has
 * spread. All three come from history, which is why they could not exist before.
 */
function Kpis({ overview, apiBase }: { overview: Overview; apiBase: string }) {
  const top = overview.versions[0]
  const adoption =
    top && overview.counts.all > 0 ? Math.round((top.count / overview.counts.all) * 100) : null
  const release = overview.release
  const latestPublished = release?.latestVersion ?? null
  // The manifest names a filename, not a URL — Caddy serves the feed directory
  // at /updates on this same host, alongside the API (see UPDATE_FEED_DIR).
  const installerHref = release?.installer ? `${apiBase}/updates/${release.installer}` : null

  return (
    <div className="kpis">
      <div className="kpi">
        <span className="kpi-label">Fleet uptime · 30d</span>
        <span className="kpi-value">
          {overview.uptimeBps30d == null ? '—' : `${(overview.uptimeBps30d / 100).toFixed(1)}%`}
        </span>
        <span className="kpi-note">
          {overview.uptimeBps30d == null ? 'Collecting history' : 'Reporting time per terminal'}
        </span>
      </div>

      <div className="kpi">
        <span className="kpi-label">Sync lag · p95</span>
        <span className="kpi-value">
          {overview.syncLagMs.p95 == null ? 'Clear' : duration(overview.syncLagMs.p95)}
        </span>
        <span className="kpi-note">
          {overview.syncLagMs.p50 == null
            ? 'No queued rows anywhere'
            : `Median ${duration(overview.syncLagMs.p50)}`}
        </span>
      </div>

      <div className="kpi">
        <span className="kpi-label">Current build</span>
        <span className="kpi-value mono">{top?.version ?? '—'}</span>
        <span className="kpi-note">
          {adoption == null
            ? 'No terminals reporting'
            : `${adoption}% of ${overview.counts.all} · ${overview.versions.length} version(s) live`}
        </span>
        {/* The published version, when it is not the one terminals are running.
            "Current build" is only ever what the fleet REPORTED, so a release
            that has reached nobody yet has no way of appearing on this page —
            which is the exact moment somebody goes looking for it. */}
        {latestPublished && latestPublished !== top?.version && (
          <span className="kpi-note">
            <b className="mono">{latestPublished}</b> published, not yet taken
          </span>
        )}
        {installerHref && (
          <span className="kpi-note">
            <a href={installerHref} target="_blank" rel="noreferrer">
              Download installer
            </a>
            {release?.releasedAt && ` · published ${timeAgo(release.releasedAt)}`}
          </span>
        )}
      </div>

      <div className="kpi">
        <span className="kpi-label">Unverified keys</span>
        <span className="kpi-value">{overview.unverifiedDevices}</span>
        <span className="kpi-note">
          {overview.unverifiedDevices === 0
            ? 'Every terminal reports on its own key'
            : 'Still on the shared enrollment secret'}
        </span>
      </div>

      <div className="kpi">
        <span className="kpi-label">Pending commands</span>
        <span className="kpi-value">{overview.pendingCommands}</span>
        <span className="kpi-note">
          {overview.pendingCommands === 0
            ? 'Nothing queued'
            : 'Waiting for a terminal to check in'}
        </span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- gauge */

const FILTERS: { id: Filter; label: string; tone: 'ok' | 'warn' | 'bad' | null }[] = [
  { id: 'all', label: 'All', tone: null },
  { id: 'healthy', label: 'Healthy', tone: 'ok' },
  { id: 'attention', label: 'Attention', tone: 'warn' },
  { id: 'offline', label: 'Offline', tone: 'bad' },
]

function Gauge({
  counts,
  loading,
}: {
  counts: Overview['counts'] | undefined
  loading: boolean
}) {
  const c = counts ?? { all: 0, healthy: 0, attention: 0, offline: 0 }
  const needLook = c.attention + c.offline

  return (
    <div className="panel-head">
      <div className="health-count">
        {c.all}
        <span>{c.all === 1 ? 'terminal reporting' : 'terminals reporting'}</span>
      </div>

      <div className="gauge">
        <div
          className="bar"
          role="img"
          aria-label={`${c.healthy} healthy, ${c.attention} needing attention, ${c.offline} offline`}
        >
          {c.healthy > 0 && <span className="bar-seg" data-tone="ok" style={{ flexGrow: c.healthy }} />}
          {c.attention > 0 && (
            <span className="bar-seg" data-tone="warn" style={{ flexGrow: c.attention }} />
          )}
          {c.offline > 0 && <span className="bar-seg" data-tone="bad" style={{ flexGrow: c.offline }} />}
        </div>
        <div className="gauge-note">
          {c.all === 0
            ? loading
              ? 'Waiting for the first check-in…'
              : 'Nothing reporting yet'
            : needLook === 0
              ? 'Every terminal is online and clear'
              : `${needLook} of ${c.all} need a look`}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- pager */

export function Pager({
  offset,
  limit,
  total,
  onOffset,
  noun,
}: {
  offset: number
  limit: number
  total: number
  onOffset: (n: number) => void
  noun: string
}) {
  if (total <= limit) return null
  const from = offset + 1
  const to = Math.min(offset + limit, total)

  return (
    <div className="pager">
      <span className="muted small">
        {from}–{to} of {total} {total === 1 ? noun : `${noun}s`}
      </span>
      <div className="pager-buttons">
        <Button size="sm" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button size="sm" disabled={to >= total} onClick={() => onOffset(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ helpers */

function syncCell(d: DeviceRow) {
  const pending = d.syncPending ?? 0
  const failed = d.syncFailed ?? 0
  if (d.syncPending == null && d.syncFailed == null) return <span className="muted">—</span>
  if (failed > 0) return <Chip tone="bad">{failed} failed</Chip>
  // A queue only earns a chip once it crosses a threshold; the server already
  // decided that, so mirror its verdict rather than inventing a second rule.
  const flagged = d.reasons.some((r) => r.code === 'sync_stuck' || r.code === 'sync_deep')
  if (flagged) return <Chip tone="warn">{pending} queued</Chip>
  if (pending > 0) return <span className="muted">{pending} in flight</span>
  return <span className="muted">Clear</span>
}

function salesCell(d: DeviceRow) {
  if (d.salesTodayCount == null) return <span className="muted">—</span>
  return (
    <>
      <div>{cedis(d.salesTodayPesewas ?? 0)}</div>
      <div className="row-sub">
        {d.salesTodayCount} {d.salesTodayCount === 1 ? 'sale' : 'sales'}
      </div>
    </>
  )
}
