import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * A small data layer, enough for a polling console:
 *
 *  - Results are cached by key, so going back to a page shows what it last had
 *    while it refreshes, instead of a blank spinner.
 *  - One request per key at a time, however many components ask.
 *  - Polling pauses while the tab is hidden and catches up when it returns.
 *  - After a write, `invalidate` refetches whatever is on screen.
 */

type Fetcher<T> = (signal: AbortSignal) => Promise<T>

interface Entry<T> {
  data?: T
  error?: Error
  /** When the last request settled; 0 = never, or invalidated. */
  at: number
  /** Bumped on every change — the subscription snapshot. */
  version: number
  inflight?: Promise<void>
  controller?: AbortController
  fetcher?: Fetcher<T>
  listeners: Set<() => void>
}

const cache = new Map<string, Entry<unknown>>()

function entry<T>(key: string): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined
  if (!e) {
    e = { at: 0, version: 0, listeners: new Set() }
    cache.set(key, e as Entry<unknown>)
  }
  return e
}

function touch(e: Entry<unknown>) {
  e.version++
  e.listeners.forEach((l) => l())
}

function load(key: string): Promise<void> {
  const e = entry<unknown>(key)
  if (e.inflight) return e.inflight
  const fetcher = e.fetcher
  if (!fetcher) return Promise.resolve()
  const controller = new AbortController()
  e.controller = controller
  e.inflight = fetcher(controller.signal)
    .then(
      (data) => {
        e.data = data
        e.error = undefined
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        e.error = err instanceof Error ? err : new Error(String(err))
      },
    )
    .finally(() => {
      e.at = Date.now()
      e.inflight = undefined
      e.controller = undefined
      touch(e)
    })
  touch(e)
  return e.inflight
}

/** Mark every key starting with `prefix` stale, and refetch the ones on screen. */
export function invalidate(prefix: string) {
  for (const [key, e] of cache) {
    if (!key.startsWith(prefix)) continue
    e.at = 0
    if (e.listeners.size) void load(key)
  }
}

/** Drop everything — on sign-out, so the next operator never sees old data. */
export function clearCache() {
  for (const e of cache.values()) e.controller?.abort()
  cache.clear()
}

export interface QueryResult<T> {
  data: T | undefined
  error: Error | undefined
  /** Nothing to show yet. */
  loading: boolean
  /** A request is in flight (possibly behind cached data). */
  refreshing: boolean
  updatedAt: number
  reload: () => Promise<void>
}

export interface QueryOptions {
  /** Poll interval in ms. */
  every?: number
  /** Skip fetching while false. */
  enabled?: boolean
}

export function useQuery<T>(key: string, fetcher: Fetcher<T>, { every, enabled = true }: QueryOptions = {}): QueryResult<T> {
  const e = entry<T>(key)
  // The newest closure wins, so a refetch always uses current inputs.
  e.fetcher = fetcher

  const subscribe = useCallback(
    (cb: () => void) => {
      const cur = entry<T>(key)
      cur.listeners.add(cb)
      return () => {
        cur.listeners.delete(cb)
      }
    },
    [key],
  )
  useSyncExternalStore(subscribe, () => entry<T>(key).version)

  useEffect(() => {
    if (!enabled) return
    const isStale = () => {
      const cur = entry<T>(key)
      return !cur.at || (every != null && Date.now() - cur.at >= every)
    }
    if (isStale()) void load(key)
    if (!every) return

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(key)
    }, every)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isStale()) void load(key)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, every, enabled])

  return {
    data: e.data,
    error: e.error,
    loading: enabled && e.data === undefined && !e.error,
    refreshing: !!e.inflight,
    updatedAt: e.at,
    reload: () => load(key),
  }
}

/** A write with pending/error state. Errors are kept for display, not thrown. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      return undefined
    } finally {
      setPending(false)
    }
  }, [])
  return { run, pending, error }
}

/** A value that settles `ms` after the last change — for search boxes. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}
