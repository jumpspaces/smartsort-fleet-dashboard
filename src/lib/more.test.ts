import { describe, expect, it } from 'vitest'
import type { Alert, HistoryBeat } from '../api/types.ts'
import { hourly } from './beats.ts'
import { newUrgent } from './notify.ts'
import { awaySummary } from '../pages/Home.tsx'
import { qty } from '../pages/shop/Inventory.tsx'

const beat = (at: string, total: number | null, pending = 0): HistoryBeat =>
  ({ capturedAt: at, salesTodayPesewas: total, syncPending: pending, syncFailed: 0 }) as HistoryBeat

describe('hourly', () => {
  const now = Date.parse('2026-11-16T12:30:00Z')
  it('turns a running daily total into takings per hour, across midnight', () => {
    const hours = hourly(
      [
        beat('2026-11-15T23:10:00Z', 1000),
        beat('2026-11-15T23:40:00Z', 1500, 3),
        beat('2026-11-16T00:10:00Z', 200), // new day: the total starts again
        beat('2026-11-16T00:50:00Z', 450, 1),
      ],
      14,
      now,
    )
    const at = (iso: string) => hours.find((h) => h.at === Date.parse(iso))!
    expect(at('2026-11-15T23:00:00Z')).toMatchObject({ sales: 500, unsent: 3 })
    expect(at('2026-11-16T00:00:00Z')).toMatchObject({ sales: 450, unsent: 1 })
    expect(at('2026-11-16T05:00:00Z')).toMatchObject({ sales: null, unsent: null })
    expect(hours).toHaveLength(14)
  })
  it('ignores beats outside the window', () => {
    expect(hourly([beat('2026-11-01T00:00:00Z', 5)], 4, now).every((h) => h.sales === null)).toBe(true)
  })
})

const alert = (id: string, over: Partial<Alert> = {}) =>
  ({ id, state: 'open', severity: 'critical', openedAt: '2026-11-16T10:00:00Z', resolvedAt: null, ...over }) as Alert

describe('notifications', () => {
  it('announce only urgent, open alerts not seen before', () => {
    const seen = new Set(['a'])
    const fresh = newUrgent(seen, [alert('a'), alert('b'), alert('c', { severity: 'warning' }), alert('d', { state: 'acknowledged' })])
    expect(fresh.map((a) => a.id)).toEqual(['b'])
  })
})

describe('since you were last here', () => {
  it('counts what opened, cleared and is still open after the last visit', () => {
    const since = Date.parse('2026-11-16T09:00:00Z')
    const r = awaySummary(
      [
        alert('old', { openedAt: '2026-11-16T08:00:00Z' }),
        alert('new-open', { openedAt: '2026-11-16T10:00:00Z' }),
        alert('new-cleared', { openedAt: '2026-11-16T10:00:00Z', state: 'resolved', resolvedAt: '2026-11-16T11:00:00Z' }),
        alert('old-cleared', { openedAt: '2026-11-15T10:00:00Z', state: 'resolved', resolvedAt: '2026-11-16T09:30:00Z' }),
      ],
      since,
    )
    expect(r.opened.map((a) => a.id)).toEqual(['new-open', 'new-cleared'])
    expect(r.cleared.map((a) => a.id)).toEqual(['new-cleared', 'old-cleared'])
    expect(r.stillOpen.map((a) => a.id)).toEqual(['new-open'])
  })
})

describe('stock quantities', () => {
  it('reads weighed stock from thousandths, pieces as whole numbers', () => {
    expect(qty(2500, 'kg')).toBe('2.5 kg')
    expect(qty(12000, 'l')).toBe('12 l')
    expect(qty(1005, 'kg')).toBe('1.005 kg')
    expect(qty(-250, 'kg')).toBe('-0.25 kg')
    expect(qty(1200)).toBe('1,200')
  })
})
