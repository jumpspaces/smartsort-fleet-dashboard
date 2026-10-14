import { useMemo } from 'react'
import type { DeviceRow, FleetState } from '../api.ts'
import { timeAgo } from '../lib/format.ts'
import { STATE_LABEL, terminalName } from '../lib/state.ts'

/**
 * Every terminal in the fleet as one square, grouped by shop.
 *
 * The table answers "what is this terminal doing"; the wall answers "where is
 * the trouble" before anyone has read a word. A fleet of two hundred fits on one
 * screen, and the eye finds the one ring or slashed square among the filled ones
 * faster than it finds the one amber row in a sorted list. That is the only job
 * this has, so it has no axis, no legend beyond the three states and no hover
 * card: the square links to the terminal's own page, which has everything.
 *
 * Shape carries the state, as everywhere else here: filled for healthy, a ring
 * for attention, a slashed outline for offline. Silenced terminals fade so a
 * planned outage does not read as a fresh one.
 */

const RANK: Record<FleetState, number> = { offline: 0, attention: 1, healthy: 2 }

interface ShopGroup {
  key: string
  name: string
  devices: DeviceRow[]
  worst: FleetState
  trouble: number
}

export function FleetWall({
  devices,
  onOpen,
}: {
  devices: DeviceRow[]
  onOpen: (d: DeviceRow) => void
}) {
  const groups = useMemo(() => groupByShop(devices), [devices])

  return (
    <div className="wall">
      {groups.map((g) => (
        <div className="wall-shop" key={g.key} data-worst={g.worst}>
          <div className="wall-shop-head">
            <span className="wall-shop-name" title={g.name}>
              {g.name}
            </span>
            <span className="wall-shop-count num">
              {g.trouble > 0 ? `${g.trouble}/${g.devices.length}` : g.devices.length}
            </span>
          </div>
          <div className="wall-tiles">
            {g.devices.map((d) => {
              const label = `${terminalName(d)} · ${STATE_LABEL[d.state]}${
                d.reasons[0] && d.state !== 'healthy' ? ` — ${d.reasons[0].label}` : ''
              } · seen ${timeAgo(d.lastReportAt)}${d.mute ? ' · silenced' : ''}`
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  className="tile"
                  data-state={d.state}
                  data-muted={d.mute ? 'true' : undefined}
                  aria-label={label}
                  title={label}
                  onClick={() => onOpen(d)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function groupByShop(devices: DeviceRow[]): ShopGroup[] {
  const map = new Map<string, ShopGroup>()
  for (const d of devices) {
    const key = d.shopId ?? '__unclaimed'
    let g = map.get(key)
    if (!g) {
      g = { key, name: d.shopName ?? 'Unclaimed', devices: [], worst: 'healthy', trouble: 0 }
      map.set(key, g)
    }
    g.devices.push(d)
    if (RANK[d.state] < RANK[g.worst]) g.worst = d.state
    if (d.state !== 'healthy') g.trouble += 1
  }
  for (const g of map.values()) {
    g.devices.sort(
      (a, b) =>
        RANK[a.state] - RANK[b.state] || terminalName(a).localeCompare(terminalName(b)),
    )
  }
  // Trouble first, so the wall reads top-left to bottom-right as worst to fine;
  // within a state, alphabetical, so a shop stays put between polls.
  return [...map.values()].sort(
    (a, b) => RANK[a.worst] - RANK[b.worst] || a.name.localeCompare(b.name),
  )
}
