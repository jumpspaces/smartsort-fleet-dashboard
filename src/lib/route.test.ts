import { describe, expect, it } from 'vitest'
import { buildHash, parseHash } from './route.ts'

describe('parseHash', () => {
  it('defaults to terminals when there is no hash', () => {
    expect(parseHash('')).toEqual({ view: 'terminals', params: {} })
    expect(parseHash('#')).toEqual({ view: 'terminals', params: {} })
    expect(parseHash('#/')).toEqual({ view: 'terminals', params: {} })
  })

  it('reads the view and its params', () => {
    expect(parseHash('#/errors?status=resolved&q=crash')).toEqual({
      view: 'errors',
      params: { status: 'resolved', q: 'crash' },
    })
  })

  it('falls back for an unknown view rather than rendering nothing', () => {
    // A stale or hand-edited link must land somewhere useful, not on a blank page.
    expect(parseHash('#/nonsense?a=b')).toEqual({ view: 'terminals', params: {} })
  })

  it('drops empty params so they never reach a query', () => {
    expect(parseHash('#/terminals?q=&state=offline').params).toEqual({ state: 'offline' })
  })

  it('round-trips through buildHash', () => {
    const hash = '#/terminals?device=abc-123&state=offline'
    expect(buildHash(parseHash(hash))).toBe(hash)
  })
})

describe('buildHash', () => {
  it('omits the query when there is nothing to say', () => {
    expect(buildHash({ view: 'alerts', params: {} })).toBe('#/alerts')
  })

  it('sorts params so identical state always yields an identical link', () => {
    // Otherwise two people looking at the same thing produce different URLs,
    // and the history fills with entries that differ only in key order.
    const a = buildHash({ view: 'terminals', params: { state: 'offline', q: 'kumasi' } })
    const b = buildHash({ view: 'terminals', params: { q: 'kumasi', state: 'offline' } })
    expect(a).toBe(b)
    expect(a).toBe('#/terminals?q=kumasi&state=offline')
  })

  it('leaves empty values out entirely', () => {
    expect(buildHash({ view: 'errors', params: { q: '', status: 'open' } })).toBe(
      '#/errors?status=open',
    )
  })

  it('encodes values that would otherwise break the query', () => {
    const hash = buildHash({ view: 'errors', params: { q: 'a&b=c d' } })
    expect(parseHash(hash).params.q).toBe('a&b=c d')
  })
})
