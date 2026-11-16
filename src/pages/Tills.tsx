import { useEffect, useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { Device, DeviceQuery, DeviceSort, FleetState } from '../api/types.ts'
import { BulkTills } from '../components/BulkTills.tsx'
import { ActionError } from '../components/forms.tsx'
import { SavedViews } from '../components/SavedViews.tsx'
import { TillsTable } from '../components/TillsTable.tsx'
import { Card, Empty, Live, Loadable, PageHeader, Search, Segmented } from '../components/ui.tsx'
import { useApi, useDevices, useOverview } from '../data.ts'
import { count, decimal } from '../lib/format.ts'
import { saveCsv } from '../lib/csv.ts'
import { STATE_LABEL, reasonPlain, tillName } from '../lib/plain.ts'
import { useAction, useDebounced } from '../lib/query.ts'
import { useSetParams } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const PAGE = 50
const STATES = ['all', 'attention', 'offline', 'healthy'] as const
const SORTS: DeviceSort[] = ['state', 'shop', 'version', 'sync', 'sales', 'errors', 'lastSeen', 'disk']
const PLATFORMS = [
  { value: 'win32', label: 'Windows' },
  { value: 'darwin', label: 'Mac' },
  { value: 'linux', label: 'Linux' },
]

/** Everything the URL says about the list, as the server's query. */
export function queryFromParams(params: URLSearchParams): DeviceQuery {
  const state = (STATES as readonly string[]).includes(params.get('state') ?? '') ? (params.get('state') as FleetState | 'all') : 'all'
  const sortParam = params.get('sort') as DeviceSort | null
  const muted = params.get('muted')
  return {
    q: params.get('q') || undefined,
    state,
    sort: sortParam && SORTS.includes(sortParam) ? sortParam : undefined,
    dir: params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : undefined,
    platform: params.get('platform') || undefined,
    version: params.get('version') || undefined,
    tag: params.get('tag') || undefined,
    muted: muted === 'muted' || muted === 'unmuted' ? muted : undefined,
    includeRemoved: params.get('removed') === '1',
  }
}

export function Tills({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const { client } = useSession()
  const base = queryFromParams(params)
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0)

  // The box is local so typing is instant; the URL follows once it settles.
  const [text, setText] = useState(params.get('q') ?? '')
  const q = useDebounced(text.trim())
  useEffect(() => {
    if (q !== (params.get('q') ?? '')) setParams({ q, page: null })
  }, [q, params, setParams])

  const query: DeviceQuery = { ...base, q: q || undefined }
  const overview = useOverview()
  const tags = useApi('tags', (c, s) => api.tagCatalogue(c, s))
  const devices = useDevices({ ...query, limit: PAGE, offset: page * PAGE })
  const counts = overview.data?.counts
  const filtered = !!(query.platform || query.version || query.tag || query.muted || query.includeRemoved)

  const exportCsv = useAction(async () => {
    const all = await api.allDevices(client, query)
    saveCsv<Device>('tills', all, [
      { header: 'Till', value: (d) => tillName(d) },
      { header: 'Device ID', value: (d) => d.deviceId },
      { header: 'Shop', value: (d) => d.shopName },
      { header: 'Status', value: (d) => STATE_LABEL[d.state] },
      { header: 'Problem', value: (d) => (d.reasons[0] ? reasonPlain(d.reasons[0].code).title : '') },
      { header: 'Version', value: (d) => d.appVersion },
      { header: 'Computer', value: (d) => [d.platform, d.osVersion].filter(Boolean).join(' ') },
      { header: 'Unsent sales', value: (d) => (d.syncPending ?? 0) + (d.syncFailed ?? 0) },
      // Minor units as a plain decimal string — exact, no float.
      { header: 'Sales today', value: (d) => (d.salesTodayPesewas == null ? '' : decimal(d.salesTodayPesewas)) },
      { header: 'Last check-in', value: (d) => d.lastReportAt },
      { header: 'Labels', value: (d) => d.tags.join(' ') },
      { header: 'Removed', value: (d) => (d.removedAt ? 'yes' : '') },
    ])
  })

  return (
    <div className="stack">
      <PageHeader
        title="Tills"
        sub="Every SmartSort terminal that has reported in."
        actions={
          <>
            <Live updatedAt={devices.updatedAt} busy={devices.refreshing} />
            <button className="btn sm" disabled={exportCsv.pending} onClick={() => void exportCsv.run()}>
              {exportCsv.pending ? 'Preparing…' : 'Download CSV'}
            </button>
            <BulkTills query={query} total={devices.data?.total ?? 0} />
          </>
        }
      />
      <ActionError error={exportCsv.error} />
      <div className="spread">
        <Segmented
          label="Filter by status"
          value={base.state ?? 'all'}
          onChange={(v) => setParams({ state: v === 'all' ? null : v, page: null })}
          options={[
            { value: 'all', label: 'All', n: counts?.all },
            { value: 'attention', label: 'Need a look', n: counts?.attention },
            { value: 'offline', label: 'Offline', n: counts?.offline },
            { value: 'healthy', label: 'Working', n: counts?.healthy },
          ]}
        />
        <Search value={text} onChange={setText} placeholder="Search till, shop or version" />
      </div>
      <div className="row">
        <select className="select" aria-label="Version" value={query.version ?? ''} onChange={(e) => setParams({ version: e.target.value, page: null })}>
          <option value="">Any version</option>
          {(overview.data?.versions ?? []).map((v) => (
            <option key={v.version} value={v.version}>
              {v.version} ({v.count})
            </option>
          ))}
        </select>
        <select className="select" aria-label="Computer" value={query.platform ?? ''} onChange={(e) => setParams({ platform: e.target.value, page: null })}>
          <option value="">Any computer</option>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Label" value={query.tag ?? ''} onChange={(e) => setParams({ tag: e.target.value, page: null })}>
          <option value="">Any label</option>
          {(tags.data ?? []).map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.devices})
            </option>
          ))}
        </select>
        <select className="select" aria-label="Silenced" value={query.muted ?? ''} onChange={(e) => setParams({ muted: e.target.value, page: null })}>
          <option value="">Silenced or not</option>
          <option value="unmuted">Not silenced</option>
          <option value="muted">Silenced</option>
        </select>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!query.includeRemoved} onChange={(e) => setParams({ removed: e.target.checked ? '1' : null, page: null })} />
          Include removed tills
        </label>
        {filtered && (
          <button className="btn sm ghost" onClick={() => setParams({ version: null, platform: null, tag: null, muted: null, removed: null, page: null })}>
            Clear filters
          </button>
        )}
      </div>
      <SavedViews page="/tills" />
      <Card flush>
        <Loadable q={devices} rows={8}>
          {(p) =>
            p.devices.length === 0 ? (
              <Empty title={q || base.state !== 'all' || filtered ? 'No tills match' : 'No tills yet'}>
                {q || base.state !== 'all' || filtered ? 'Try a different filter or search.' : 'Tills appear here once they report in.'}
              </Empty>
            ) : (
              <>
                <TillsTable
                  devices={p.devices}
                  sorting={{
                    sort: base.sort,
                    dir: base.dir,
                    onSort: (s) => {
                      // Names and status read best A→Z / worst-first; numbers biggest-first.
                      const natural = s === 'state' || s === 'shop' ? 'asc' : 'desc'
                      const current = base.dir ?? natural
                      const next = base.sort === s ? (current === 'asc' ? 'desc' : 'asc') : natural
                      setParams({ sort: s, dir: next, page: null })
                    },
                  }}
                />
                <div className="pager">
                  <span className="num">
                    {count(p.offset + 1)}–{count(p.offset + p.devices.length)} of {count(p.total)}
                  </span>
                  <span className="row">
                    <button className="btn sm" disabled={page === 0} onClick={() => setParams({ page: page - 1 || null })}>
                      Previous
                    </button>
                    <button className="btn sm" disabled={p.offset + p.devices.length >= p.total} onClick={() => setParams({ page: page + 1 })}>
                      Next
                    </button>
                  </span>
                </div>
              </>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}
