import { describe, expect, it } from 'vitest'
import { buildHash, PARENT, parseHash } from './route.ts'

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
    const hash = '#/terminals?q=kumasi&state=offline'
    expect(buildHash(parseHash(hash))).toBe(hash)
  })

  it('reads a detail page and its subject', () => {
    // These are pages, not drawers over a list, so the whole address is the
    // detail view plus the one id it is about.
    expect(parseHash('#/device?id=abc-123')).toEqual({ view: 'device', params: { id: 'abc-123' } })
    expect(parseHash('#/shop?id=s-1')).toEqual({ view: 'shop', params: { id: 's-1' } })
    expect(parseHash('#/error?id=deadbeef')).toEqual({
      view: 'error',
      params: { id: 'deadbeef' },
    })
  })

  it('does not confuse the error page with the errors list', () => {
    expect(parseHash('#/errors').view).toBe('errors')
    expect(parseHash('#/error').view).toBe('error')
  })

  it('sends links minted for the old drawers to the page that replaced them', () => {
    // These are pasted into chats and tickets and outlive the UI that made them.
    expect(parseHash('#/terminals?device=abc-123')).toEqual({
      view: 'device',
      params: { id: 'abc-123' },
    })
    expect(parseHash('#/shops?shop=s-1')).toEqual({ view: 'shop', params: { id: 's-1' } })
    expect(parseHash('#/errors?fp=deadbeef')).toEqual({ view: 'error', params: { id: 'deadbeef' } })
  })

  it('drops the list filters a legacy link carried alongside its subject', () => {
    // The detail page has no use for them, and keeping them in the URL would
    // claim a filter is applied to something that is not a list.
    expect(parseHash('#/terminals?device=abc-123&state=offline&q=kumasi')).toEqual({
      view: 'device',
      params: { id: 'abc-123' },
    })
  })

  it('leaves a list alone when it carries no subject', () => {
    expect(parseHash('#/terminals?state=offline')).toEqual({
      view: 'terminals',
      params: { state: 'offline' },
    })
  })
})

describe('PARENT', () => {
  it('points every detail page at the list it belongs to', () => {
    // The rail lights the parent and the back link goes there, so a detail view
    // missing an entry would strand somebody on a page with no way up.
    expect(PARENT.device).toBe('terminals')
    expect(PARENT.shop).toBe('shops')
    expect(PARENT.error).toBe('errors')
  })

  it('leaves list views without a parent', () => {
    expect(PARENT.terminals).toBeUndefined()
    expect(PARENT.errors).toBeUndefined()
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
