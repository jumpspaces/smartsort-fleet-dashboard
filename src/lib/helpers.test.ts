import { describe, expect, it } from 'vitest'
import { toCsv } from './csv.ts'
import { pool } from './pool.ts'
import { isTyping, rank, score } from './match.ts'
import { migrateHash } from './prefs.ts'

describe('toCsv', () => {
  it('quotes commas, quotes and line breaks', () => {
    const csv = toCsv([{ a: 'x, y', b: 'say "hi"', c: 'two\nlines' }], [
      { header: 'A', value: (r) => r.a },
      { header: 'B', value: (r) => r.b },
      { header: 'C', value: (r) => r.c },
    ])
    expect(csv).toBe('A,B,C\r\n"x, y","say ""hi""","two\nlines"\r\n')
  })
  it('defuses spreadsheet formulas in text, but not in numbers', () => {
    const csv = toCsv([{ t: '=HYPERLINK("x")', n: -5 }], [
      { header: 'T', value: (r) => r.t },
      { header: 'N', value: (r) => r.n },
    ])
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")",-5`)
  })
  it('leaves blanks for null', () => {
    expect(toCsv([{ v: null }], [{ header: 'V', value: (r) => r.v }])).toBe('V\r\n\r\n')
  })
})

describe('pool', () => {
  it('never runs more than the limit at once, and keeps going past failures', async () => {
    let running = 0
    let peak = 0
    const r = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((res) => setTimeout(res, 2))
      running--
      if (n % 3 === 0) throw new Error(`bad ${n}`)
    })
    expect(peak).toBe(3)
    expect(r.ok.sort()).toEqual([1, 2, 4, 5, 7])
    expect(r.failed.map((f) => f.error).sort()).toEqual(['bad 3', 'bad 6'])
  })
  it('handles an empty list', async () => {
    expect(await pool([], 5, async () => {})).toEqual({ ok: [], failed: [] })
  })
})

describe('match', () => {
  it('ranks prefix, then word start, then substring', () => {
    expect(score('kum', 'Kumasi Mart')).toBe(3)
    expect(score('mart', 'Kumasi Mart')).toBe(2)
    expect(score('asi', 'Kumasi Mart')).toBe(1)
    expect(score('zzz', 'Kumasi Mart')).toBe(0)
    expect(score('cafe', 'Café Accra')).toBe(3)
  })
  it('orders results by score and keeps ties stable', () => {
    const items = ['Tamale Textiles', 'Tema Fresh Foods', 'Fresh Tema', 'Osu Pharmacy']
    expect(rank('tem', items, (s) => s)).toEqual(['Tema Fresh Foods', 'Fresh Tema'])
  })
  it('knows when a key press belongs to a field', () => {
    expect(isTyping({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTyping({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
  })
})

describe('saved views from the old console', () => {
  it('point at the renamed pages', () => {
    expect(migrateHash('/terminals?state=offline')).toBe('/tills?state=offline')
    expect(migrateHash('/errors')).toBe('/problems')
    expect(migrateHash('/rollouts/abc')).toBe('/updates/abc')
    expect(migrateHash('/terminalsx')).toBe('/terminalsx')
    expect(migrateHash('/shops?q=a')).toBe('/shops?q=a')
  })
})
