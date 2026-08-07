import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, AuditRow } from '../api.ts'
import { Unauthorized } from '../api.ts'
import { Icon } from '../components/Icon.tsx'
import { Empty, Notice, TableSkeleton } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { useHotkey } from '../lib/useHotkey.ts'

const LIMITS = [100, 250, 500] as const

/**
 * The append-only record behind every mutating call this console makes: who
 * revoked a key, who issued a command, who signed in and from where.
 *
 * Read-only and unfiltered server-side beyond a row limit — this is a log, not
 * a queue, so there is nothing here to act on. The search box narrows what is
 * already on screen rather than round-tripping, since a few hundred rows of
 * text is cheaper to filter in the browser than to keep re-asking the server.
 */
export function Audit({ api, onUnauthorized }: { api: Api; onUnauthorized: () => void }) {
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(100)
  const [entries, setEntries] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  const load = useCallback(async () => {
    try {
      setEntries(await api.audit(limit))
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not load the audit log')
    }
  }, [api, limit, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  const needle = debounced.trim().toLowerCase()
  const filtered =
    entries == null
      ? null
      : needle === ''
        ? entries
        : entries.filter((e) =>
            [e.actorLabel, e.action, e.targetType, e.targetId, e.ip]
              .filter(Boolean)
              .some((f) => f!.toLowerCase().includes(needle)),
          )

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Audit</h1>
          <p className="view-sub">
            Every mutating action taken through this console, append-only: who did what, when,
            and from where.
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
              placeholder="Filter by actor, action, target…"
              aria-label="Filter audit log"
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </div>

          <div className="filters" role="group" aria-label="Rows to load">
            {LIMITS.map((n) => (
              <button
                key={n}
                type="button"
                className="key"
                aria-pressed={limit === n}
                onClick={() => setLimit(n)}
              >
                Last {n}
              </button>
            ))}
          </div>
        </div>

        {filtered == null ? (
          <TableSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <Empty icon="list" title={entries!.length === 0 ? 'Nothing recorded yet' : 'Nothing matches'}>
            {entries!.length === 0
              ? 'Actions taken through this console — sign-ins, revokes, commands, triage — appear here.'
              : 'Try a different filter.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="th-label">When</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">Actor</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">Action</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">Target</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">From</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="col-num muted" title={exact(e.createdAt)}>
                      {timeAgo(e.createdAt)}
                    </td>
                    <td>{e.actorLabel ?? 'system'}</td>
                    <td className="mono small">{e.action}</td>
                    <td className="muted small">
                      {e.targetType ? (
                        <>
                          {e.targetType}
                          {e.targetId && <span className="mono"> {e.targetId.slice(0, 12)}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                      {e.detail != null && (
                        <div
                          className="row-sub mono"
                          title={JSON.stringify(e.detail)}
                          style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {JSON.stringify(e.detail)}
                        </div>
                      )}
                    </td>
                    <td className="muted small">{e.ip ?? '—'}</td>
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
