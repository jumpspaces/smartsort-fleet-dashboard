import { useCallback, useEffect, useState } from 'react'
import type { Api, CommandHistoryRow, CommandSpec } from '../api.ts'
import type { Navigate } from '../App.tsx'
import type { Route } from '../lib/route.ts'
import { Chip, Empty, Notice, TableSkeleton } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'
import { Pager } from './Terminals.tsx'

const PAGE_SIZE = 50

const STATES: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'pending', label: 'Waiting' },
  { id: 'sent', label: 'Running' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Failed' },
  { id: 'expired', label: 'Expired' },
]

/**
 * Every command issued fleet-wide, one row per terminal — the audit page for
 * "what did we actually send out", as opposed to the per-device drawer's
 * "what happened to this one till". Answers "was app.bundle 1.6.0 already
 * tried on this shop" without opening every terminal in turn.
 */
export function Commands({
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
  const command = route.params.command ?? ''
  const state = route.params.state ?? ''
  const offset = Number(route.params.offset ?? 0) || 0

  const [catalogue, setCatalogue] = useState<CommandSpec[] | null>(null)
  const [rows, setRows] = useState<CommandHistoryRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.commandCatalogue().then(setCatalogue).catch(() => setCatalogue([]))
  }, [api])

  const load = useCallback(async () => {
    try {
      const page = await api.commandHistory({
        command: command || undefined,
        state: state || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setRows(page.commands)
      setTotal(page.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load command history')
    }
  }, [api, command, state, offset])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const setCommand = (next: string) => onReplace({ command: next || undefined, offset: undefined })
  const setState = (next: string) => onReplace({ state: next || undefined, offset: undefined })
  const setOffset = (next: number) => onReplace({ offset: next > 0 ? String(next) : undefined })

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Commands</h1>
          <p className="view-sub">
            Every remote action issued fleet-wide, across every terminal — the same commands
            the device drawer issues, all in one place.
          </p>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      <section className="panel">
        <div className="toolbar">
          <div className="filters" role="group" aria-label="Filter by command">
            <button
              type="button"
              className="key"
              aria-pressed={command === ''}
              onClick={() => setCommand('')}
            >
              All commands
            </button>
            {(catalogue ?? []).map((c) => (
              <button
                key={c.name}
                type="button"
                className="key"
                aria-pressed={command === c.name}
                onClick={() => setCommand(command === c.name ? '' : c.name)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="filters" role="group" aria-label="Filter by state">
            {STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="key"
                aria-pressed={state === s.id}
                onClick={() => setState(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {rows == null ? (
          <TableSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <Empty icon="list" title="No commands match">
            Nothing has been issued fleet-wide yet, or nothing matches this filter.
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="th-label">Terminal</span>
                    </th>
                    <th scope="col">
                      <span className="th-label">Command</span>
                    </th>
                    <th scope="col">
                      <span className="th-label">State</span>
                    </th>
                    <th scope="col">
                      <span className="th-label">Issued by</span>
                    </th>
                    <th scope="col" className="col-num">
                      <span className="th-label">Issued</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          type="button"
                          className="row-open"
                          onClick={() => onNavigate('terminals', { device: c.deviceId })}
                        >
                          {c.shopName ?? 'Unclaimed terminal'}
                        </button>
                        <div className="row-sub mono">{c.deviceId.slice(0, 12)}</div>
                      </td>
                      <td>
                        <span className="mono">{c.command}</span>
                        {payloadVersion(c) && (
                          <span className="mono muted small"> {payloadVersion(c)}</span>
                        )}
                        {c.error && (
                          <div className="row-sub bad-text" title={c.error}>
                            {c.error}
                          </div>
                        )}
                      </td>
                      <td>
                        <Chip tone={stateTone(c.state)}>{stateLabel(c.state)}</Chip>
                      </td>
                      <td className="muted small">{c.issuedByLabel ?? 'unknown'}</td>
                      <td className="col-num muted" title={exact(c.issuedAt)}>
                        {timeAgo(c.issuedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pager offset={offset} limit={PAGE_SIZE} total={total} onOffset={setOffset} noun="command" />
          </>
        )}
      </section>
    </>
  )
}

function payloadVersion(c: CommandHistoryRow): string | null {
  if (c.command !== 'app.bundle') return null
  const v = (c.payload as { version?: unknown } | null)?.version
  return typeof v === 'string' ? v : null
}

function stateLabel(state: CommandHistoryRow['state']): string {
  switch (state) {
    case 'pending':
      return 'Waiting'
    case 'sent':
      return 'Running'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'expired':
      return 'Expired'
  }
}

function stateTone(state: CommandHistoryRow['state']) {
  switch (state) {
    case 'done':
      return 'ok' as const
    case 'failed':
      return 'bad' as const
    case 'expired':
      return 'idle' as const
    default:
      return 'warn' as const
  }
}
