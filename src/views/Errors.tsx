import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, ErrorGroupRow, GroupStatus } from '../api.ts'
import type { Navigate } from '../App.tsx'
import type { Route } from '../lib/route.ts'
import { Icon } from '../components/Icon.tsx'
import { Button, Chip, Empty, Notice, TableSkeleton } from '../components/ui.tsx'
import { downloadCsv, toCsv } from '../lib/csv.ts'
import { exact, timeAgo } from '../lib/format.ts'
import { GROUP_STATUS_LABEL, GROUP_STATUS_TONE } from '../lib/state.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { useHotkey } from '../lib/useHotkey.ts'
import { BulkErrorActions } from './BulkErrorActions.tsx'
import { Pager } from './Terminals.tsx'

const PAGE_SIZE = 25

const TABS: { id: GroupStatus | 'all'; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'all', label: 'All' },
]

/**
 * Errors as faults, not as incidents.
 *
 * The device drawer answers "what is wrong with this terminal". This view is the
 * other axis: one row per distinct fault across the fleet, with how many
 * terminals it hit and which builds it appeared in. Without it, one bug on forty
 * terminals looks like forty unrelated problems and the actual priority — that
 * it is ONE bug, hitting a third of the fleet — is invisible.
 */
export function Errors({
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
  const status = (route.params.status as GroupStatus | 'all' | undefined) ?? 'open'
  const offset = Number(route.params.offset ?? 0) || 0

  const [query, setQuery] = useState(route.params.q ?? '')
  const [groups, setGroups] = useState<ErrorGroupRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())
  const debounced = useDebounced(query)

  useEffect(() => {
    onReplace({ q: debounced.trim() || undefined, offset: undefined })
  }, [debounced, onReplace])

  const setStatus = (next: GroupStatus | 'all') =>
    onReplace({ status: next === 'open' ? undefined : next, offset: undefined })
  const setOffset = (next: number) =>
    onReplace({ offset: next > 0 ? String(next) : undefined })

  const load = useCallback(async () => {
    try {
      const page = await api.errorGroups({
        status,
        q: debounced.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setGroups(page.groups)
      setTotal(page.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load errors')
    }
  }, [api, status, debounced, offset])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  async function exportCsv() {
    setExporting(true)
    try {
      const all: ErrorGroupRow[] = []
      for (let off = 0; ; off += 200) {
        const page = await api.errorGroups({ status, q: debounced.trim() || undefined, limit: 200, offset: off })
        all.push(...page.groups)
        if (all.length >= page.total || page.groups.length === 0) break
      }
      downloadCsv(
        `errors-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(all, [
          { header: 'Message', value: (g) => g.message },
          { header: 'Status', value: (g) => g.status },
          { header: 'Source', value: (g) => g.source },
          { header: 'Terminals affected', value: (g) => g.deviceCount },
          { header: 'Total events', value: (g) => g.totalCount },
          { header: 'First version', value: (g) => g.firstVersion },
          { header: 'Last version', value: (g) => g.lastVersion },
          { header: 'First seen', value: (g) => g.firstSeen },
          { header: 'Last seen', value: (g) => g.lastSeen },
          { header: 'Resolved in version', value: (g) => g.resolvedInVersion },
        ]),
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Errors</h1>
          <p className="view-sub">
            One row per distinct fault across the whole fleet. Resolving one records the build that
            fixed it and stops it counting against terminal health.
          </p>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              className="input"
              type="search"
              value={query}
              placeholder="Search error text…"
              aria-label="Search errors"
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>

          <div className="filters" role="group" aria-label="Filter by triage state">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="key"
                aria-pressed={status === t.id}
                onClick={() => setStatus(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="toolbar-end">
            <Button size="sm" variant="ghost" busy={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </div>

          {status === 'open' && (
            <div className="toolbar-end">
              <BulkErrorActions
                api={api}
                q={debounced.trim() || undefined}
                total={total}
                canAct={api.operator.role !== 'viewer'}
                onDone={() => void load()}
              />
            </div>
          )}
        </div>

        {groups == null ? (
          <TableSkeleton rows={5} />
        ) : groups.length === 0 ? (
          <Empty
            icon={status === 'open' ? 'check' : 'inbox'}
            title={status === 'open' ? 'No open errors' : 'Nothing here'}
          >
            {status === 'open'
              ? 'Every fault reported from the field has been resolved or ignored. New ones appear here within a few minutes of a terminal hitting them.'
              : 'No error groups match this filter.'}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="th-label">Error</span>
                    </th>
                    <th scope="col">
                      <span className="th-label">Status</span>
                    </th>
                    <th scope="col" className="col-num">
                      <span className="th-label">Terminals</span>
                    </th>
                    <th scope="col" className="col-num">
                      <span className="th-label">Events</span>
                    </th>
                    <th scope="col">
                      <span className="th-label">Versions</span>
                    </th>
                    <th scope="col" className="col-num">
                      <span className="th-label">Last seen</span>
                    </th>
                    <th scope="col">
                      <span className="sr-only">Open detail</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr
                      key={g.id}
                      data-clickable="true"
                      onClick={() => onNavigate('error', { id: g.fingerprint })}
                    >
                      <td>
                        <button
                          type="button"
                          className="row-open err-title"
                          onClick={(e) => {
                            e.stopPropagation()
                            onNavigate('error', { id: g.fingerprint })
                          }}
                        >
                          {g.message}
                        </button>
                        <div className="row-sub">{g.source ?? 'unknown source'}</div>
                      </td>
                      <td>
                        <Chip tone={GROUP_STATUS_TONE[g.status]}>
                          {GROUP_STATUS_LABEL[g.status]}
                        </Chip>
                        {/* A fault we believed fixed, firing on a build at or
                            past the fix. Loud on purpose. */}
                        {g.regressedAt && <Chip tone="bad">Regressed</Chip>}
                      </td>
                      <td className="col-num">{g.deviceCount}</td>
                      <td className="col-num">{g.totalCount.toLocaleString()}</td>
                      <td className="mono small">
                        {g.firstVersion === g.lastVersion
                          ? (g.lastVersion ?? '—')
                          : `${g.firstVersion ?? '?'} → ${g.lastVersion ?? '?'}`}
                      </td>
                      <td className="col-num muted" title={exact(g.lastSeen)}>
                        {timeAgo(g.lastSeen)}
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
              noun="error"
            />
          </>
        )}
      </section>
    </>
  )
}
