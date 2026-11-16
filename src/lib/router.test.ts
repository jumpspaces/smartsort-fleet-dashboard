import { describe, expect, it } from 'vitest'
import { href, parse } from './router.ts'

describe('parse', () => {
  it('reads list pages, detail pages and params', () => {
    expect(parse('').route).toEqual({ page: 'home' })
    expect(parse('#/').route).toEqual({ page: 'home' })
    expect(parse('#/tills?state=offline').route).toEqual({ page: 'tills' })
    expect(parse('#/tills?state=offline').params.get('state')).toBe('offline')
    expect(parse('#/tills/abc%2F1').route).toEqual({ page: 'till', id: 'abc/1' })
    expect(parse('#/problems/fp1').route).toEqual({ page: 'problem', id: 'fp1' })
    expect(parse('#/updates/r1').route).toEqual({ page: 'update', id: 'r1' })
    expect(parse('#/settings?tab=rules').route).toEqual({ page: 'settings' })
  })

  it('refuses ids on pages without detail, deep paths, unknown pages and bad encoding', () => {
    expect(parse('#/alerts/1').route.page).toBe('notFound')
    expect(parse('#/tills/a/b').route.page).toBe('notFound')
    expect(parse('#/nope').route.page).toBe('notFound')
    expect(parse('#/constructor').route.page).toBe('notFound')
    expect(parse('#/tills/%E0%A4%A').route.page).toBe('notFound')
  })
})

describe('href', () => {
  it('drops empty params', () => {
    expect(href('/tills', { state: 'offline', q: '', page: null })).toBe('#/tills?state=offline')
    expect(href('/')).toBe('#/')
  })
})
