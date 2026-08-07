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

export type View = 'terminals' | 'shops' | 'errors' | 'alerts' | 'operators' | 'audit'

const VIEWS: View[] = ['terminals', 'shops', 'errors', 'alerts', 'operators', 'audit']

export interface Route {
  view: View
  params: Record<string, string>
}

const DEFAULT_ROUTE: Route = { view: 'terminals', params: {} }

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
 * The current route, and two ways to change it.
 *
 * `navigate` pushes — a new place, so Back returns to where you were.
 * `replace` swaps — the same place, refined. Typing six characters into a search
 * box is one destination, not six, and must not take six presses of Back to
 * escape.
 */
export function useRoute(): {
  route: Route
  navigate: (view: View, params?: Record<string, string | undefined>) => void
  replace: (params: Record<string, string | undefined>) => void
} {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    // The first load may have no hash at all; give it one so Back has somewhere
    // to return to and the address bar reflects what is on screen.
    if (!window.location.hash) {
      window.history.replaceState(null, '', buildHash(route))
    }
    return () => window.removeEventListener('hashchange', onHashChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  const apply = useCallback((next: Route, mode: 'push' | 'replace') => {
    const hash = buildHash(next)
    if (hash === window.location.hash) return
    if (mode === 'push') window.history.pushState(null, '', hash)
    else window.history.replaceState(null, '', hash)
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
          window.history.replaceState(null, '', hash)
        }
        return next
      })
    },
    [],
  )

  return { route, navigate, replace }
}

/** Drop empty and undefined values so they never reach the URL. */
function clean(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') out[k] = v
  }
  return out
}
