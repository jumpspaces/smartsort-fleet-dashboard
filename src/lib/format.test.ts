import { describe, expect, it } from 'vitest'
import { ago, bytes, decimal, duration, money, pct } from './format.ts'

describe('money', () => {
  it('is exact to the pesewa, with grouping', () => {
    expect(money(123456789)).toBe('GHS 1,234,567.89')
    expect(money(5)).toBe('GHS 0.05')
    expect(money(100, 'USD')).toBe('USD 1.00')
  })
  it('never reads -0.00, and signs real negatives', () => {
    expect(money(0)).toBe('GHS 0.00')
    expect(money(-0)).toBe('GHS 0.00')
    expect(money(-250)).toBe('GHS -2.50')
  })
  it('shows a dash for missing', () => {
    expect(money(null)).toBe('—')
  })
})

describe('time', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  it('reads short relative times, then a date past a week', () => {
    expect(ago('2026-11-16T11:59:30Z', now)).toBe('just now')
    expect(ago('2026-11-16T11:48:00Z', now)).toBe('12m ago')
    expect(ago('2026-11-15T12:00:00Z', now)).toBe('24h ago')
    expect(ago('2026-10-01T12:00:00Z', now)).not.toMatch(/ago/)
    expect(ago(null, now)).toBe('—')
    expect(ago('garbage', now)).toBe('—')
  })
  it('compacts durations', () => {
    expect(duration(45_000)).toBe('45s')
    expect(duration(3 * 86_400_000)).toBe('3d')
  })
})

describe('units', () => {
  it('formats bytes and basis points', () => {
    expect(bytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(bytes(null)).toBe('—')
    expect(pct(9987)).toBe('99.87%')
  })
})

describe('decimal', () => {
  it('is exact and signs amounts under one cedi correctly', () => {
    expect(decimal(-50)).toBe('-0.50')
    expect(decimal(123456)).toBe('1234.56')
    expect(decimal(123456, true)).toBe('1,234.56')
    expect(decimal(-0)).toBe('0.00')
  })
})
