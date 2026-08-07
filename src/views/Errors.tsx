import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, ErrorGroupRow, GroupDevice, GroupStatus } from '../api.ts'
import type { Navigate } from '../App.tsx'
import type { Route } from '../lib/route.ts'
import { Icon } from '../components/Icon.tsx'
import {
  Button,
  Chip,
  CopyButton,
  Drawer,
  DrawerSection,
  Empty,
  KV,
  Notice,
  TableSkeleton,
} from '../components/ui.tsx'
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
  const openFingerprint = route.params.fp

  const [query, setQuery] = useState(route.params.q ?? '')
  const [groups, setGroups] = useState<ErrorGroupRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ErrorGroupRow | null>(null)
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

  // Keep the open drawer bound to the URL, so a link to one fault opens it.
  useEffect(() => {
    if (!openFingerprint) {
      setSelected(null)
      return
    }
    const match = groups?.find((g) => g.fingerprint === openFingerprint)
    if (match) setSelected(match)
  }, [openFingerprint, groups])

  const changeStatus = useCallback(
    async (fingerprint: string, next: GroupStatus, version?: string | null) => {
      await api.setGroupStatus(fingerprint, next, version)
      onReplace({ fp: undefined })
      await load()
    },
    [api, load, onReplace],
  )

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
                    <tr key={g.id} data-clickable="true" onClick={() => onReplace({ fp: g.fingerprint })}>
                      <td>
                        <button
                          type="button"
                          className="row-open err-title"
                          onClick={(e) => {
                            e.stopPropagation()
                            onReplace({ fp: g.fingerprint })
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

      {selected && (
        <GroupDrawer
          api={api}
          group={selected}
          onClose={() => onReplace({ fp: undefined })}
          onStatus={changeStatus}
          onNavigate={onNavigate}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------- drawer */

function GroupDrawer({
  api,
  group,
  onClose,
  onStatus,
  onNavigate,
}: {
  api: Api
  group: ErrorGroupRow
  onClose: () => void
  onStatus: (fingerprint: string, next: GroupStatus, version?: string | null) => Promise<void>
  onNavigate: Navigate
}) {
  const [devices, setDevices] = useState<GroupDevice[] | null>(null)
  const [fixVersion, setFixVersion] = useState(group.lastVersion ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .groupDevices(group.fingerprint)
      .then((d) => live && setDevices(d))
      .catch(() => live && setDevices([]))
    return () => {
      live = false
    }
  }, [api, group.fingerprint])

  async function act(next: GroupStatus) {
    setBusy(true)
    setError(null)
    try {
      await onStatus(group.fingerprint, next, next === 'resolved' ? fixVersion.trim() || null : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this error')
      setBusy(false)
    }
  }

  return (
    <Drawer
      title={group.message}
      subtitle={<span className="mono">{group.fingerprint.slice(0, 16)}</span>}
      onClose={onClose}
    >
      <DrawerSection title="Triage">
        <div className="drawer-status">
          <Chip tone={GROUP_STATUS_TONE[group.status]}>{GROUP_STATUS_LABEL[group.status]}</Chip>
          {group.regressedAt && <Chip tone="bad">Regressed {timeAgo(group.regressedAt)}</Chip>}
          <CopyButton value={group.message} label="Copy message" />
        </div>

        {error && <Notice>{error}</Notice>}

        {group.status === 'open' ? (
          <div className="triage">
            <label className="field">
              <span>Fixed in version</span>
              <input
                className="input mono"
                value={fixVersion}
                onChange={(e) => setFixVersion(e.target.value)}
                placeholder="1.5.2"
              />
              <span className="hint">
                A terminal on this build or newer hitting it again re-opens this as a regression.
                Older builds still hitting it are expected, and stay quiet.
              </span>
            </label>
            <div className="form-actions">
              <Button variant="primary" busy={busy} onClick={() => void act('resolved')}>
                Mark resolved
              </Button>
              <Button variant="ghost" busy={busy} onClick={() => void act('ignored')}>
                Ignore
              </Button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            <Button variant="primary" busy={busy} onClick={() => void act('open')}>
              Re-open
            </Button>
            <span className="hint">
              {group.status === 'resolved'
                ? `Marked fixed${group.resolvedInVersion ? ` in ${group.resolvedInVersion}` : ''} ${timeAgo(group.resolvedAt)}` +
                  `${group.resolvedByLabel ? ` by ${group.resolvedByLabel}` : ''}.`
                : 'Ignored errors never count against terminal health.'}
            </span>
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Detail">
        <dl className="kv-list">
          <KV k="Source" v={group.source ?? '—'} />
          <KV k="Terminals affected" v={String(group.deviceCount)} />
          <KV k="Total events" v={group.totalCount.toLocaleString()} />
          <KV k="First seen" v={timeAgo(group.firstSeen)} title={exact(group.firstSeen)} />
          <KV k="Last seen" v={timeAgo(group.lastSeen)} title={exact(group.lastSeen)} />
          <KV k="First build" v={<span className="mono">{group.firstVersion ?? '—'}</span>} />
          <KV k="Latest build" v={<span className="mono">{group.lastVersion ?? '—'}</span>} />
        </dl>
        {group.stack && <pre className="stack">{group.stack}</pre>}
      </DrawerSection>

      <DrawerSection title={devices?.length ? `Terminals (${devices.length})` : 'Terminals'}>
        {devices == null ? (
          <div className="skeleton" style={{ width: '50%' }} />
        ) : devices.length === 0 ? (
          <p className="muted small">No terminal rows — this fault's devices have been pruned.</p>
        ) : (
          <ul className="plain-list">
            {devices.map((d) => (
              <li key={d.deviceId}>
                <button
                  type="button"
                  className="row-open mono"
                  onClick={() => {
                    onClose()
                    onNavigate('terminals', { deviceId: d.deviceId })
                  }}
                >
                  {d.deviceId.slice(0, 16)}
                </button>
                <span className="muted small">
                  ×{d.count} · v{d.appVersion ?? '?'} · last{' '}
                  <span title={exact(d.lastSeen)}>{timeAgo(d.lastSeen)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>
    </Drawer>
  )
}
