import { useEffect } from 'react'

/**
 * When this operator last had the console in front of them, for Home's
 * "since you were last here". Recorded while the tab is visible, read once
 * per page load — so the previous visit is what the summary compares with.
 */
const key = (operatorId: string) => `fleet_last_seen:${operatorId}`
let previous: number | null | undefined

function read(operatorId: string): number | null {
  try {
    const v = Number(localStorage.getItem(key(operatorId)))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/** The last visit before this page load (null on a first visit). */
export function previousVisit(operatorId: string): number | null {
  if (previous === undefined) previous = read(operatorId)
  return previous
}

/** Keep the timestamp fresh while someone is looking. */
export function useRecordVisit(operatorId: string) {
  useEffect(() => {
    previousVisit(operatorId) // capture before overwriting
    const mark = () => {
      if (document.visibilityState !== 'visible') return
      try {
        localStorage.setItem(key(operatorId), String(Date.now()))
      } catch {
        // Storage refused: the summary just won't show next time.
      }
    }
    mark()
    const t = window.setInterval(mark, 60_000)
    document.addEventListener('visibilitychange', mark)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', mark)
    }
  }, [operatorId])
}

/** For tests. */
export function resetVisitForTests() {
  previous = undefined
}
