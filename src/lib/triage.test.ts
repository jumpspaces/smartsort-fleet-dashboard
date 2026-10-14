import { describe, expect, it, vi } from 'vitest'
import type { AlertRow, DeviceRow, ErrorGroupRow, HealthReason } from '../api.ts'
import { buildQueue, FRESH_ERROR_MS, headline, stripShop } from './triage.ts'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

let seq = 0

function alert(over: Partial<AlertRow> = {}): AlertRow {
  seq += 1
  return {
    id: `alert-${seq}`,
    ruleKey: 'sync.failed',
    deviceId: null,
    shopId: 'shop-a',
    shopName: 'Kumasi Mart',
    severity: 'warning',
    title: 'Sync failing',
    detail: null,
    state: 'open',
    openedAt: ago(10 * MIN),
    lastSeenAt: ago(MIN),
    acknowledgedAt: null,
    acknowledgedByLabel: null,
    resolvedAt: null,
    notifiedAt: null,
    notifyError: null,
    rollupCount: null,
    escalatedAt: null,
    escalations: 0,
    ...over,
  }
}

function reason(code: HealthReason['code'], severity: HealthReason['severity'] = 'warning'): HealthReason {
  return { code, label: `Reason ${code}`, severity }
}

/** Only the fields buildQueue reads; the rest of a heartbeat is irrelevant here. */
function device(over: Partial<DeviceRow> = {}): DeviceRow {
  seq += 1
  return {
    deviceId: `dev-${seq}`,
    shopId: 'shop-a',
    shopName: 'Kumasi Mart',
    machineName: `Till ${seq}`,
    terminalCode: null,
    state: 'healthy',
    reasons: [],
    mute: null,
    openAlerts: 0,
    lastReportAt: ago(MIN),
    ...over,
  } as DeviceRow
}

function group(over: Partial<ErrorGroupRow> = {}): ErrorGroupRow {
  seq += 1
  return {
    id: `group-${seq}`,
    fingerprint: `fp-${seq}`,
    message: `TypeError: thing ${seq} is undefined`,
    source: 'renderer',
    stack: null,
    totalCount: 3,
    deviceCount: 1,
    firstVersion: null,
    lastVersion: null,
    firstSeen: ago(2 * HOUR),
    lastSeen: ago(HOUR),
    status: 'open',
    resolvedAt: null,
    resolvedByLabel: null,
    resolvedInVersion: null,
    regressedAt: null,
    ...over,
  }
}

function queue(input: { alerts?: AlertRow[]; groups?: ErrorGroupRow[]; devices?: DeviceRow[] }) {
  const navigate = vi.fn()
  const items = buildQueue(input.alerts ?? [], input.groups ?? [], input.devices ?? [], navigate, NOW)
  return { items, navigate }
}

describe('buildQueue — alerts', () => {
  it('folds one rule firing on several of a shop’s tills into one row', () => {
    const tills = [device(), device(), device()]
    const alerts = tills.map((d) => alert({ deviceId: d.deviceId }))
    const { items, navigate } = queue({ alerts, devices: tills })

    expect(items).toHaveLength(1)
    expect(items[0].alerts).toHaveLength(3)
    expect(items[0].where).toBe('Kumasi Mart · 3 terminals')
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('shop', { id: 'shop-a' })
  })

  it('keeps the same rule apart across shops and across open vs acknowledged', () => {
    const a = device()
    const b = device()
    const c = device({ shopId: 'shop-b', shopName: 'Accra Mall' })
    const { items } = queue({
      alerts: [
        alert({ deviceId: a.deviceId }),
        alert({ deviceId: b.deviceId, state: 'acknowledged' }),
        alert({ deviceId: c.deviceId, shopId: 'shop-b', shopName: 'Accra Mall' }),
      ],
      devices: [a, b, c],
    })
    expect(items).toHaveLength(3)
    expect(items.filter((i) => i.acknowledged)).toHaveLength(1)
  })

  it('is critical when any alert in a bundle is', () => {
    const tills = [device(), device()]
    const { items } = queue({
      alerts: [
        alert({ deviceId: tills[0].deviceId }),
        alert({ deviceId: tills[1].deviceId, severity: 'critical' }),
      ],
      devices: tills,
    })
    expect(items[0].severity).toBe('critical')
  })

  it('names the terminal and opens it when one alert stands alone', () => {
    const d = device({ machineName: 'Front till' })
    const { items, navigate } = queue({
      alerts: [alert({ deviceId: d.deviceId, title: 'Kumasi Mart: local server is down' })],
      devices: [d],
    })
    expect(items[0].title).toBe('Local server is down')
    expect(items[0].where).toBe('Kumasi Mart · Front till')
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('device', { id: d.deviceId })
  })

  it('ignores resolved alerts', () => {
    expect(queue({ alerts: [alert({ state: 'resolved' })] }).items).toEqual([])
  })

  it('says when an alert could not be delivered', () => {
    const { items } = queue({ alerts: [alert({ notifyError: 'SMTP 550' })] })
    expect(items[0].detail).toBe('Could not be delivered')
  })
})

describe('buildQueue — terminals', () => {
  it('queues an unhealthy terminal that has no alert of its own', () => {
    const d = device({ state: 'attention', reasons: [reason('disk_low')] })
    const { items, navigate } = queue({ devices: [d] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'device', title: 'Reason disk_low', severity: 'warning' })
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('device', { id: d.deviceId })
  })

  it('skips healthy, silenced and already-alerted terminals', () => {
    const { items } = queue({
      devices: [
        device(),
        device({
          state: 'offline',
          mute: { id: 'm1', scope: 'device', reason: 'Moving shop', endsAt: ago(-HOUR), createdByLabel: null },
        }),
        device({ state: 'offline', openAlerts: 1 }),
      ],
    })
    expect(items).toEqual([])
  })

  it('leaves recent errors to the error groups', () => {
    const d = device({ state: 'attention', reasons: [reason('errors_recent')] })
    expect(queue({ devices: [d] }).items).toEqual([])
  })

  it('still queues an offline terminal that has no other reason', () => {
    const d = device({ state: 'offline', reasons: [] })
    const { items } = queue({ devices: [d] })
    expect(items[0]).toMatchObject({ title: 'Terminal offline', severity: 'critical' })
  })

  it('counts the reasons beyond the first', () => {
    const d = device({
      state: 'attention',
      reasons: [reason('disk_low'), reason('backup_stale'), reason('errors_recent')],
    })
    expect(queue({ devices: [d] }).items[0].detail).toBe('+1 more')
  })

  it('leaves out terminals in a shop that already has a shop-wide alert', () => {
    const shopAlert = alert({ ruleKey: 'shop.offline', deviceId: null, title: 'Kumasi Mart is dark' })
    const { items } = queue({
      alerts: [shopAlert],
      devices: [device({ state: 'offline' }), device({ state: 'offline' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('alert')
  })

  it('folds more than two terminals with the same problem into one row', () => {
    const offline = [
      device({ state: 'offline' }),
      device({ state: 'offline' }),
      device({ state: 'offline', shopId: 'shop-b', shopName: 'Accra Mall' }),
    ]
    const { items, navigate } = queue({ devices: offline })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: 'Terminals offline', where: '3 terminals in 2 shops' })
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('terminals', { state: 'offline' })
  })

  it('keeps two terminals with the same problem as two rows', () => {
    const { items } = queue({ devices: [device({ state: 'offline' }), device({ state: 'offline' })] })
    expect(items).toHaveLength(2)
  })
})

describe('buildQueue — error groups', () => {
  it('queues groups seen in the last day and leaves older ones as backlog', () => {
    const fresh = group({ lastSeen: ago(HOUR) })
    const stale = group({ lastSeen: ago(FRESH_ERROR_MS + MIN) })
    const { items } = queue({ groups: [fresh, stale] })
    expect(items.map((i) => i.key)).toEqual([`error:${fresh.fingerprint}`])
  })

  it('makes a group critical when it regressed today or spans five terminals', () => {
    const { items } = queue({
      groups: [
        group({ regressedAt: ago(HOUR) }),
        group({ deviceCount: 5 }),
        group({ regressedAt: ago(FRESH_ERROR_MS + MIN) }),
      ],
    })
    expect(items.map((i) => i.severity)).toEqual(['critical', 'critical', 'warning'])
    expect(items.find((i) => i.detail?.startsWith('Regressed'))).toBeDefined()
  })

  it('shows a “new error” alert once, as that alert, opening its group', () => {
    const g = group({ message: 'RangeError: invalid receipt number' })
    const a = alert({
      ruleKey: 'errors.new_group',
      detail: 'RangeError: invalid receipt number\nfirst seen on Front till',
    })
    const { items, navigate } = queue({ alerts: [a], groups: [g] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'alert', title: 'New error: RangeError: invalid receipt number' })
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('error', { id: g.fingerprint })
  })

  it('does not match a “new error” alert to an unrelated group', () => {
    const g = group({ message: 'TypeError: a' })
    const a = alert({ ruleKey: 'errors.new_group', detail: 'SyntaxError: b' })
    expect(queue({ alerts: [a], groups: [g] }).items).toHaveLength(2)
  })
})

describe('buildQueue — order', () => {
  it('puts critical first, then newest', () => {
    const { items } = queue({
      alerts: [
        alert({ id: 'old-warning', openedAt: ago(3 * HOUR) }),
        alert({ id: 'new-warning', openedAt: ago(MIN) }),
        alert({ id: 'old-critical', severity: 'critical', openedAt: ago(5 * HOUR) }),
      ],
    })
    expect(items.map((i) => i.alerts![0].id)).toEqual(['old-critical', 'new-warning', 'old-warning'])
  })
})

describe('stripShop', () => {
  it('drops the shop name the row already shows and capitalises what is left', () => {
    expect(stripShop('Kumasi Mart: local server is down', 'Kumasi Mart')).toBe('Local server is down')
  })

  it('leaves a title that does not start with the shop alone', () => {
    expect(stripShop('Backups not running', 'Kumasi Mart')).toBe('Backups not running')
    expect(stripShop('Accra Mall: x', null)).toBe('Accra Mall: x')
  })
})

describe('headline', () => {
  it('agrees in number', () => {
    expect(headline(0, false)).toBe('All clear')
    expect(headline(1, false)).toBe('1 thing needs you')
    expect(headline(4, false)).toBe('4 things need you')
    expect(headline(4, true)).toBe('Triage')
  })
})
