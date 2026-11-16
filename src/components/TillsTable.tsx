import type { Device, DeviceSort } from '../api/types.ts'
import { useHeartbeats, useShopIndex } from '../data.ts'
import { count, money } from '../lib/format.ts'
import { reasonPlain, tillName } from '../lib/plain.ts'
import { shopHref, tillHref } from '../lib/router.ts'
import { Icon } from './Icon.tsx'
import { StateBadge, Strip, When } from './ui.tsx'

interface Sorting {
  sort: DeviceSort | undefined
  dir: 'asc' | 'desc' | undefined
  onSort: (s: DeviceSort) => void
}

/**
 * The one table of tills, used on the Tills page and a shop's page. A row
 * answers three questions left to right: which till, is it OK, and if not why.
 */
export function TillsTable({
  devices,
  hideShop,
  sorting,
}: {
  devices: Device[]
  hideShop?: boolean
  sorting?: Sorting
}) {
  const shops = useShopIndex()
  const strips = useHeartbeats(devices.map((d) => d.deviceId))
  const stripById = new Map((strips.data ?? []).map((s) => [s.deviceId, s]))

  const head = (label: string, key?: DeviceSort, right?: boolean) => {
    const active = sorting && key && sorting.sort === key
    return (
      <th
        className={right ? 'r' : undefined}
        aria-sort={active ? (sorting.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {sorting && key ? (
          <button className="sort-btn" onClick={() => sorting.onSort(key)}>
            {label}
            {active && <Icon name={sorting.dir === 'asc' ? 'up' : 'down'} size={12} />}
          </button>
        ) : (
          label
        )}
      </th>
    )
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {head('Till')}
            {!hideShop && head('Shop', 'shop')}
            {head('Status', 'state')}
            {head('Last 24 hours')}
            {head('Unsent sales', 'sync', true)}
            {head('Sales today', 'sales', true)}
            {head('Version', 'version')}
            {head('Last seen', 'lastSeen')}
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const top = d.reasons[0]
            const currency = (d.shopId && shops.get(d.shopId)?.currency) || 'GHS'
            const unsent = (d.syncPending ?? 0) + (d.syncFailed ?? 0)
            return (
              <tr
                key={d.deviceId}
                className="link"
                onClick={(e) => {
                  // Let inner links (the shop) and modified clicks behave normally.
                  if ((e.target as HTMLElement).closest('a') || e.metaKey || e.ctrlKey) return
                  location.hash = tillHref(d.deviceId)
                }}
              >
                <td className="primary-cell">
                  <a href={tillHref(d.deviceId)}>{tillName(d)}</a>
                  {top && d.state !== 'healthy' && (
                    <div className="small sub" title={top.label}>
                      {reasonPlain(top.code).title}
                      {d.reasons.length > 1 && ` +${d.reasons.length - 1} more`}
                    </div>
                  )}
                </td>
                {!hideShop && (
                  <td>
                    {d.shopId ? (
                      <a href={shopHref(d.shopId)} className="sub">
                        {d.shopName ?? 'Unnamed shop'}
                      </a>
                    ) : (
                      <span className="muted">Not linked</span>
                    )}
                  </td>
                )}
                <td>
                  <StateBadge state={d.state} muted={!!d.mute} />
                </td>
                <td>
                  <Strip strip={stripById.get(d.deviceId)} />
                </td>
                <td className={`r num${unsent ? '' : ' muted'}`}>
                  {d.syncPending == null ? '—' : count(unsent)}
                </td>
                <td className="r num nowrap">
                  {d.salesTodayPesewas == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      {money(d.salesTodayPesewas, currency)}
                      <div className="small muted">{count(d.salesTodayCount)} sales</div>
                    </>
                  )}
                </td>
                <td className="mono">{d.appVersion ?? '—'}</td>
                <td className="sub">
                  <When iso={d.lastReportAt} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
