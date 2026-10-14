import { describe, expect, it, vi } from 'vitest'
import type { AlertRow, DeviceRow, ErrorGroupRow, HealthReason } from '../api.ts'
import { REASON_PLAIN, RULE_PLAIN } from './plain.ts'
import { buildQueue, FRESH_ERROR_MS, headline, shopLine, stripShop, summariseShops } from './triage.ts'

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
    expect(items[0].where).toBe('Kumasi Mart · 3 tills')
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

  it('names the till and opens it when one alert stands alone', () => {
    const d = device({ machineName: 'Front till' })
    const { items, navigate } = queue({
      alerts: [alert({ deviceId: d.deviceId, ruleKey: 'server.down', title: 'Kumasi Mart: local server is down' })],
      devices: [d],
    })
    expect(items[0].title).toBe(RULE_PLAIN['server.down'].title)
    expect(items[0].hint).toBe(RULE_PLAIN['server.down'].hint)
    expect(items[0].where).toBe('Kumasi Mart · Front till')
    // The server's own wording is kept for whoever hovers for it.
    expect(items[0].tech).toBe('Local server is down')
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('device', { id: d.deviceId })
  })

  it('falls back to the server’s title for a rule it has no words for', () => {
    const { items } = queue({ alerts: [alert({ ruleKey: 'brand.new', title: 'Kumasi Mart: flux capacitor low' })] })
    expect(items[0].title).toBe('Flux capacitor low')
    expect(items[0].hint).toBeNull()
  })

  it('ignores resolved alerts', () => {
    expect(queue({ alerts: [alert({ state: 'resolved' })] }).items).toEqual([])
  })

  it('says when an alert could not be delivered', () => {
    const { items } = queue({ alerts: [alert({ notifyError: 'SMTP 550' })] })
    expect(items[0].hint).toMatch(/could not be sent/)
  })
})

describe('buildQueue — terminals', () => {
  it('queues an unhealthy till that has no alert of its own', () => {
    const d = device({ state: 'attention', reasons: [reason('disk_low')] })
    const { items, navigate } = queue({ devices: [d] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'device', ...REASON_PLAIN.disk_low, severity: 'warning' })
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('device', { id: d.deviceId })
  })

  it('skips healthy, silenced and already-alerted tills', () => {
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

  it('still queues an offline till that has no other reason', () => {
    const d = device({ state: 'offline', reasons: [] })
    const { items } = queue({ devices: [d] })
    expect(items[0]).toMatchObject({ title: REASON_PLAIN.offline.title, severity: 'critical' })
  })

  it('mentions the other things wrong with the same till', () => {
    const d = device({
      state: 'attention',
      reasons: [reason('disk_low'), reason('backup_stale'), reason('errors_recent')],
    })
    expect(queue({ devices: [d] }).items[0].hint).toMatch(/Also 1 other thing on this till\.$/)
  })

  it('does not count being offline as another thing on an offline till', () => {
    const d = device({ state: 'offline', reasons: [reason('offline', 'critical')] })
    expect(queue({ devices: [d] }).items[0].hint).toBe(REASON_PLAIN.offline.hint)
  })

  it('has words for a reason this build does not know', () => {
    const d = device({ state: 'attention', reasons: [{ code: 'brand_new', label: 'x', severity: 'warning' } as never] })
    expect(queue({ devices: [d] }).items[0].title).toBe('Needs a look')
  })

  it('leaves out tills in a shop that already has a shop-wide alert', () => {
    const shopAlert = alert({ ruleKey: 'shop.offline', deviceId: null, title: 'Kumasi Mart is dark' })
    const { items } = queue({
      alerts: [shopAlert],
      devices: [device({ state: 'offline' }), device({ state: 'offline' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('alert')
  })

  it('folds more than two tills with the same problem into one row', () => {
    const offline = [
      device({ state: 'offline' }),
      device({ state: 'offline' }),
      device({ state: 'offline', shopId: 'shop-b', shopName: 'Accra Mall' }),
    ]
    const { items, navigate } = queue({ devices: offline })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: REASON_PLAIN.offline.title, where: '3 tills in 2 shops' })
    items[0].open()
    expect(navigate).toHaveBeenCalledWith('terminals', { state: 'offline' })
  })

  it('keeps two tills with the same problem as two rows', () => {
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

  it('makes a group critical when it came back today or spans five tills', () => {
    const { items } = queue({
      groups: [
        group({ regressedAt: ago(HOUR) }),
        group({ deviceCount: 5 }),
        group({ regressedAt: ago(FRESH_ERROR_MS + MIN) }),
      ],
    })
    expect(items.map((i) => i.severity)).toEqual(['critical', 'critical', 'warning'])
    expect(items.filter((i) => i.title === 'A fixed app problem is back')).toHaveLength(1)
  })

  it('shows a “new error” alert once, as that alert, opening its group', () => {
    const g = group({ message: 'RangeError: invalid receipt number' })
    const a = alert({
      ruleKey: 'errors.new_group',
      detail: 'RangeError: invalid receipt number\nfirst seen on Front till',
    })
    const { items, navigate } = queue({ alerts: [a], groups: [g] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'alert',
      title: RULE_PLAIN['errors.new_group'].title,
      where: '3 times on 1 till',
      tech: 'RangeError: invalid receipt number',
    })
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
    expect(headline(0, false)).toBe('Everything’s running')
    expect(headline(1, false)).toBe('1 thing needs a look')
    expect(headline(4, false)).toBe('4 things need a look')
    expect(headline(4, true)).toBe('Home')
  })
})

describe('summariseShops', () => {
  it('puts the worst shop first, then by name', () => {
    const shops = summariseShops([
      device({ shopId: 'b', shopName: 'Bolga Store' }),
      device({ shopId: 'a', shopName: 'Accra Mall' }),
      device({ shopId: 'c', shopName: 'Cape Coast', state: 'attention' }),
      device({ shopId: 'd', shopName: 'Dansoman', state: 'offline' }),
    ])
    expect(shops.map((s) => s.name)).toEqual(['Dansoman', 'Cape Coast', 'Accra Mall', 'Bolga Store'])
  })

  it('does not let a paused till pull its shop to the top', () => {
    const mute = { id: 'm', scope: 'device' as const, reason: 'Moving', endsAt: ago(-HOUR), createdByLabel: null }
    const [s] = summariseShops([device(), device({ state: 'offline', mute })])
    expect(s.state).toBe('healthy')
    expect(s.fine).toBe(1)
  })

  it('collects tills not yet in a shop under one heading', () => {
    const [s] = summariseShops([device({ shopId: null, shopName: null }), device({ shopId: null, shopName: null })])
    expect(s).toMatchObject({ shopId: null, name: 'Not in a shop yet', total: 2 })
  })
})

describe('shopLine', () => {
  const line = (states: ('healthy' | 'attention' | 'offline')[]) =>
    shopLine(summariseShops(states.map((state) => device({ state })))[0])

  it('answers “is it all right?” in words', () => {
    expect(line(['healthy'])).toBe('Its till is fine')
    expect(line(['healthy', 'healthy', 'healthy'])).toBe('All 3 tills fine')
    expect(line(['offline'])).toBe('Its till is not connected')
    expect(line(['offline', 'offline'])).toBe('None of 2 tills connected')
    expect(line(['offline', 'attention', 'healthy'])).toBe('1 of 3 not connected')
    expect(line(['attention'])).toBe('Its till needs a look')
    expect(line(['attention', 'healthy'])).toBe('1 of 2 needs a look')
    expect(line(['attention', 'attention', 'healthy'])).toBe('2 of 3 need a look')
  })
})
