import { useCallback, useEffect, useState } from 'react'

/**
 * Hash-based routing for the console's view state.
 *
 * Every filter, search and open drawer used to live in React state and
 * localStorage, which meant the state you were looking at had no address: you
 * could not send a colleague the offline terminal you were about to ask them
 * about, the back button did nothing, and a refresh dropped you at the top of an
 * unfiltered list. For a tool whose whole job is "look at this specific broken
 * thing", that is the difference between a dashboard and a screenshot.
 *
 * Hash rather than history: this is a static SPA served from a plain file host
 * with no rewrite rule, so a deep path would 404 on reload. Deliberately no
 * router dependency — the whole grammar is `#/view?a=b`.
 */

export type View =
  | 'terminals'
  | 'device'
  | 'shops'
  | 'shop'
  | 'errors'
  | 'error'
  | 'alerts'
  | 'commands'
  | 'rollouts'
  | 'trends'
  | 'backups'
  | 'quality'
  | 'operators'
  | 'audit'

const VIEWS: View[] = [
  'terminals',
  'device',
  'shops',
  'shop',
  'errors',
  'error',
  'alerts',
  'commands',
  'rollouts',
  'trends',
  'backups',
  'quality',
  'operators',
  'audit',
]

/**
 * Detail views are pages of their own, but they are still *inside* a section:
 * the rail must keep the parent lit, and their back link must know where up is.
 */
export const PARENT: Partial<Record<View, View>> = {
  device: 'terminals',
  shop: 'shops',
  error: 'errors',
}

export interface Route {
  view: View
  params: Record<string, string>
}

const DEFAULT_ROUTE: Route = { view: 'terminals', params: {} }

/**
 * Links minted while detail was a drawer over its list, of the shape
 * `#/terminals?device=…`. Operators paste these into chat and tickets, so they
 * outlive the UI that made them: translate rather than dropping someone on an
 * unfiltered list with no sign that anything was meant to open.
 */
const LEGACY: { list: View; param: string; page: View }[] = [
  { list: 'terminals', param: 'device', page: 'device' },
  { list: 'shops', param: 'shop', page: 'shop' },
  { list: 'errors', param: 'fp', page: 'error' },
]

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  if (!raw) return DEFAULT_ROUTE

  const [path, search = ''] = raw.split('?')
  const view = VIEWS.find((v) => v === path)
  if (!view) return DEFAULT_ROUTE

  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(search)) {
    if (v !== '') params[k] = v
  }

  const legacy = LEGACY.find((l) => l.list === view && params[l.param])
  if (legacy) return { view: legacy.page, params: { id: params[legacy.param] } }

  return { view, params }
}

export function buildHash(route: Route): string {
  const qs = new URLSearchParams()
  // Sorted so the same state always produces the same URL — otherwise two
  // identical views yield different links and the history fills with noise.
  for (const key of Object.keys(route.params).sort()) {
    const value = route.params[key]
    if (value !== undefined && value !== '') qs.set(key, value)
  }
  const search = qs.toString()
  return `#/${route.view}${search ? `?${search}` : ''}`
}

/**
 * What we hang on each history entry. `from` is the hash we left to get here,
 * which is what lets a detail page's back link return to the *filtered* list
 * somebody was actually looking at rather than a bare, unfiltered one.
 */
interface Entry {
  depth: number
  from: string | null
}

function entry(): Entry {
  const s = window.history.state as Partial<Entry> | null
  return {
    depth: typeof s?.depth === 'number' ? s.depth : 0,
    from: typeof s?.from === 'string' ? s.from : null,
  }
}

/**
 * The current route, and three ways to change it.
 *
 * `navigate` pushes — a new place, so Back returns to where you were.
 * `replace` swaps — the same place, refined. Typing six characters into a search
 * box is one destination, not six, and must not take six presses of Back to
 * escape.
 * `back` goes up one level, preferring the history entry we came from when that
 * is the parent list, so its filters, sort and page survive the round trip.
 */
export function useRoute(): {
  route: Route
  navigate: (view: View, params?: Record<string, string | undefined>) => void
  replace: (params: Record<string, string | undefined>) => void
  back: (parent: View) => void
} {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    // Canonicalise what we landed on: no hash at all, an unknown view, or a
    // legacy drawer link. The address bar has to say what is actually on screen,
    // or the next person copies a URL that no longer means what it shows.
    const canonical = buildHash(route)
    if (window.location.hash !== canonical) {
      window.history.replaceState(entry() satisfies Entry, '', canonical)
    }
    return () => window.removeEventListener('hashchange', onHashChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  const apply = useCallback((next: Route, mode: 'push' | 'replace') => {
    const hash = buildHash(next)
    if (hash === window.location.hash) return
    const here = entry()
    if (mode === 'push') {
      const state: Entry = { depth: here.depth + 1, from: window.location.hash }
      window.history.pushState(state, '', hash)
    } else {
      window.history.replaceState(here satisfies Entry, '', hash)
    }
    // pushState/replaceState do not fire hashchange, so drive state directly.
    setRoute(next)
  }, [])

  const navigate = useCallback(
    (view: View, params: Record<string, string | undefined> = {}) => {
      apply({ view, params: clean(params) }, 'push')
    },
    [apply],
  )

  const replace = useCallback(
    (params: Record<string, string | undefined>) => {
      setRoute((cur) => {
        const next = { view: cur.view, params: clean({ ...cur.params, ...params }) }
        const hash = buildHash(next)
        if (hash !== window.location.hash) {
          window.history.replaceState(entry() satisfies Entry, '', hash)
        }
        return next
      })
    },
    [],
  )

  const back = useCallback(
    (parent: View) => {
      const here = entry()
      // Only step back when the previous entry really is the list we belong to.
      // Otherwise — a deep link, or arriving from an alert — go there fresh;
      // stepping back blindly would land somewhere unrelated or leave the app.
      if (here.depth > 0 && here.from && parseHash(here.from).view === parent) {
        window.history.back()
        return
      }
      apply({ view: parent, params: {} }, 'push')
    },
    [apply],
  )

  return { route, navigate, replace, back }
}

/** Drop empty and undefined values so they never reach the URL. */
function clean(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') out[k] = v
  }
  return out
}
