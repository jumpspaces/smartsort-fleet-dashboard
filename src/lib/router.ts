import { useCallback, useSyncExternalStore } from 'react'

/**
 * Hash routing: `#/tills/abc?state=offline`. Everything that decides what is on
 * screen lives in the URL, so links can be shared, back works and a refresh
 * lands where you were.
 */

/** List pages, and the detail page each one opens (if any). */
const LISTS = {
  tills: 'till',
  shops: 'shop',
  alerts: null,
  problems: 'problem',
  updates: 'update',
  fixes: null,
  history: null,
  backups: null,
  records: null,
  activity: null,
  settings: null,
  accounts: null,
  calendar: null,
  help: 'helpRequest',
  receipts: null,
  phones: null,
  cloud: null,
} as const

type Lists = typeof LISTS
type ListPage = keyof Lists
type DetailPage = Exclude<Lists[ListPage], null>

export type Route = { page: 'home' } | { page: 'notFound' } | { page: ListPage } | { page: DetailPage; id: string }

export type Page = Route['page']

export interface Location {
  route: Route
  params: URLSearchParams
}

export function parse(hash: string): Location {
  const raw = hash.replace(/^#/, '')
  const [path = '', query = ''] = raw.split('?', 2)
  let parts: string[]
  try {
    parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    parts = ['\u0000']
  }
  const params = new URLSearchParams(query)
  const [head, id, ...rest] = parts
  let route: Route = { page: 'notFound' }
  if (!head) route = { page: 'home' }
  else if (rest.length === 0 && Object.hasOwn(LISTS, head)) {
    const list = head as ListPage
    const detail = LISTS[list]
    if (!id) route = { page: list }
    else if (detail) route = { page: detail, id }
  }
  return { route, params }
}

export function href(path: string, params?: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== '') q.set(k, String(v))
  const s = q.toString()
  return `#${path}${s ? `?${s}` : ''}`
}

export const tillHref = (id: string) => href(`/tills/${encodeURIComponent(id)}`)
export const shopHref = (id: string) => href(`/shops/${encodeURIComponent(id)}`)
export const problemHref = (fingerprint: string) => href(`/problems/${encodeURIComponent(fingerprint)}`)
export const updateHref = (id: string) => href(`/updates/${encodeURIComponent(id)}`)
export const helpHref = (id: string) => href(`/help/${encodeURIComponent(id)}`)
/** A sale search, optionally inside one shop. */
export const receiptsHref = (q: string, shopId?: string) => href('/receipts', { q, shopId })

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useLocation(): Location {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parse(hash)
}

/**
 * Change the current page's query params. Filters replace the history entry
 * rather than pushing one, so back leaves the page instead of undoing a filter
 * one keystroke at a time.
 */
export function useSetParams() {
  return useCallback((patch: Record<string, string | number | undefined | null>) => {
    const { pathname, params } = splitHash(window.location.hash)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') params.delete(k)
      else params.set(k, String(v))
    }
    const s = params.toString()
    const next = `#${pathname}${s ? `?${s}` : ''}`
    history.replaceState(null, '', next)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])
}

function splitHash(hash: string) {
  const [pathname = '/', query = ''] = hash.replace(/^#/, '').split('?', 2)
  return { pathname: pathname || '/', params: new URLSearchParams(query) }
}
