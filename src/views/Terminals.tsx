import { useMemo, useRef, useState } from 'react'
import type { DeviceRow } from '../api.ts'
import { Icon } from '../components/Icon.tsx'
import { compare, PlainHeader, SortHeader, type Sort } from '../components/SortHeader.tsx'
import { Button, Chip, Empty, Status, TableSkeleton } from '../components/ui.tsx'
import { ageMs, cedis, exact, timeAgo } from '../lib/format.ts'
import { fleetState, STATE_LABEL, TONE, type FleetState } from '../lib/state.ts'
import { useHotkey } from '../lib/useHotkey.ts'

type SortKey = 'state' | 'shop' | 'version' | 'sync' | 'sales' | 'errors' | 'lastSeen'
type Filter = 'all' | FleetState

/** Worst first — the default view should be the one that needs reading. */
const STATE_RANK: Record<FleetState, number> = { offline: 0, attention: 1, healthy: 2 }

export function Terminals({
  devices,
  errorsByDevice,
  loading,
  onSelect,
}: {
  devices: DeviceRow[] | null
  errorsByDevice: Map<string, number>
  loading: boolean
  onSelect: (d: DeviceRow) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort<SortKey>>({ key: 'state', dir: 'asc' })
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  const rows = devices ?? []

  const decorated = useMemo(
    () =>
      rows.map((d) => {
        const errors = errorsByDevice.get(d.deviceId) ?? 0
        return { d, errors, state: fleetState(d, errors) }
      }),
    [rows, errorsByDevice],
  )

  const counts = useMemo(() => {
    const c = { all: decorated.length, healthy: 0, attention: 0, offline: 0 }
    for (const r of decorated) c[r.state] += 1
    return c
  }, [decorated])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = decorated.filter(({ d, state }) => {
      if (filter !== 'all' && state !== filter) return false
      if (!q) return true
      return (
        (d.shopName ?? '').toLowerCase().includes(q) ||
        d.deviceId.toLowerCase().includes(q) ||
        (d.appVersion ?? '').toLowerCase().includes(q) ||
        (d.platform ?? '').toLowerCase().includes(q)
      )
    })

    const { key, dir } = sort
    return [...matched].sort((a, b) => {
      switch (key) {
        case 'state':
          return (
            compare(STATE_RANK[a.state], STATE_RANK[b.state], dir) ||
            compare(a.d.shopName, b.d.shopName, 'asc')
          )
        case 'shop':
          return compare(a.d.shopName ?? a.d.deviceId, b.d.shopName ?? b.d.deviceId, dir)
        case 'version':
          return compare(a.d.appVersion, b.d.appVersion, dir)
        case 'sync':
          return compare(backlog(a.d), backlog(b.d), dir)
        case 'sales':
          return compare(a.d.salesTodayPesewas, b.d.salesTodayPesewas, dir)
        case 'errors':
          return compare(a.errors, b.errors, dir)
        case 'lastSeen':
          // Newest first when descending, so invert the age.
          return compare(-ageMs(a.d.lastReportAt), -ageMs(b.d.lastReportAt), dir)
      }
    })
  }, [decorated, filter, query, sort])

  const filtering = filter !== 'all' || query.trim() !== ''

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

      <section className="panel">
        <Gauge counts={counts} loading={loading} />

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
                <b>{counts[f.id]}</b>
                {f.label}
              </button>
            ))}
          </div>

          {filtering && (
            <div className="toolbar-end">
              <span>
                {visible.length} of {counts.all}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        {devices == null ? (
          <TableSkeleton rows={6} />
        ) : counts.all === 0 ? (
          <Empty icon="terminals" title="No terminals have reported yet">
            A terminal appears here the first time its desktop app checks in. If one is installed
            and still missing, its build may be pointing at a different fleet URL.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty
            icon="search"
            title="Nothing matches those filters"
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear filters
              </Button>
            }
          >
            {counts.all} {counts.all === 1 ? 'terminal is' : 'terminals are'} reporting — none of
            them match {query.trim() ? `“${query.trim()}”` : `the ${STATE_LABEL[filter as FleetState].toLowerCase()} filter`}.
          </Empty>
        ) : (
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
                {visible.map(({ d, errors, state }) => (
                  <tr key={d.deviceId} data-clickable="true" onClick={() => onSelect(d)}>
                    <td>
                      <Status tone={TONE[state]} label={STATE_LABEL[state]} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="row-open"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(d)
                        }}
                      >
                        {d.shopName ?? 'Unclaimed terminal'}
                      </button>
                      <div className="row-sub mono">{d.deviceId.slice(0, 12)}</div>
                    </td>
                    <td className="mono">{d.appVersion ?? '—'}</td>
                    <td className="muted">{d.platform ?? '—'}</td>
                    <td>{syncCell(d)}</td>
                    <td className="col-num">{salesCell(d)}</td>
                    <td className="col-num">
                      {errors > 0 ? <Chip tone="warn">{errors}</Chip> : <span className="muted">0</span>}
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
        )}
      </section>
    </>
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
  counts: { all: number; healthy: number; attention: number; offline: number }
  loading: boolean
}) {
  const needLook = counts.attention + counts.offline

  return (
    <div className="panel-head">
      <div className="health-count">
        {counts.all}
        <span>{counts.all === 1 ? 'terminal reporting' : 'terminals reporting'}</span>
      </div>

      <div className="gauge">
        <div
          className="bar"
          role="img"
          aria-label={`${counts.healthy} healthy, ${counts.attention} needing attention, ${counts.offline} offline`}
        >
          {counts.healthy > 0 && (
            <span className="bar-seg" data-tone="ok" style={{ flexGrow: counts.healthy }} />
          )}
          {counts.attention > 0 && (
            <span className="bar-seg" data-tone="warn" style={{ flexGrow: counts.attention }} />
          )}
          {counts.offline > 0 && (
            <span className="bar-seg" data-tone="bad" style={{ flexGrow: counts.offline }} />
          )}
        </div>
        <div className="gauge-note">
          {counts.all === 0
            ? loading
              ? 'Waiting for the first check-in…'
              : 'Nothing reporting yet'
            : needLook === 0
              ? 'Every terminal is online and clear'
              : `${needLook} of ${counts.all} need a look`}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ helpers */

function backlog(d: DeviceRow): number | null {
  if (d.syncPending == null && d.syncFailed == null) return null
  // Failures outrank a queue of any length when sorting "worst sync first".
  return (d.syncFailed ?? 0) * 10_000 + (d.syncPending ?? 0)
}

function syncCell(d: DeviceRow) {
  const pending = d.syncPending ?? 0
  const failed = d.syncFailed ?? 0
  if (d.syncPending == null && d.syncFailed == null) return <span className="muted">—</span>
  if (failed > 0) return <Chip tone="bad">{failed} failed</Chip>
  if (pending > 0) return <Chip tone="warn">{pending} queued</Chip>
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
