import { useEffect, useState } from 'react'

/**
 * Trail a fast-changing value by `ms`.
 *
 * Used for the search boxes: filtering happens on the server now, so every
 * keystroke would otherwise be a round trip, and the results of the ones you
 * typed through are never the ones you wanted.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}
