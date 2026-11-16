import { describe, expect, it } from 'vitest'
import type { Device } from '../api/types.ts'
import { byProblem } from './Home.tsx'
import { queryFromParams } from './Tills.tsx'

const till = (id: string, state: Device['state'], code: string | null, last: string) =>
  ({ deviceId: id, state, reasons: code ? [{ code, label: '', severity: 'critical' }] : [], lastReportAt: last }) as unknown as Device

describe('Home grouping', () => {
  it('folds tills with the same problem into one line, offline first, dated by the oldest', () => {
    const groups = byProblem([
      till('a', 'attention', 'disk_low', '2026-11-16T10:00:00Z'),
      till('b', 'offline', 'offline', '2026-11-16T09:00:00Z'),
      till('c', 'offline', 'offline', '2026-11-15T09:00:00Z'),
    ])
    expect(groups.map((g) => g.key)).toEqual(['offline', 'disk_low'])
    expect(groups[0]!.tills.map((t) => t.deviceId)).toEqual(['b', 'c'])
    expect(groups[0]!.since).toBe('2026-11-15T09:00:00Z')
    expect(groups[0]!.plain.title).toBe('Not connected')
  })
})

describe('Tills filters from the URL', () => {
  it('reads every filter and ignores junk', () => {
    const q = queryFromParams(new URLSearchParams('state=offline&version=2.3.1&platform=win32&tag=pilot&muted=unmuted&removed=1&sort=sales&dir=asc'))
    expect(q).toMatchObject({ state: 'offline', version: '2.3.1', platform: 'win32', tag: 'pilot', muted: 'unmuted', includeRemoved: true, sort: 'sales', dir: 'asc' })
    const junk = queryFromParams(new URLSearchParams('state=bogus&sort=nope&muted=maybe&dir=up'))
    expect(junk).toMatchObject({ state: 'all', sort: undefined, muted: undefined, dir: undefined, includeRemoved: false })
  })
})
