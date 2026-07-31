import { useEffect, useRef } from 'react'

/**
 * A bare single-key shortcut, ignored while the operator is typing into a
 * field. Used for `/` to focus search — the convention in every table-heavy
 * tool, and the only shortcut this app claims.
 */
export function useHotkey(key: string, run: () => void) {
  const latest = useRef(run)
  latest.current = run

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key])
}
