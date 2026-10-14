import { useCallback, useEffect, useState } from 'react'

/**
 * Light is the default because of where this gets used: a lit desk, during the
 * day, glanced at between other work. Dark is a real peer rather than an
 * afterthought — the 11pm "a shop just called" case is exactly when someone
 * opens this — and `system` stays a visible choice, but it is opt-in: an OS set
 * to dark for other reasons should not turn the console dark uninvited.
 */
export type ThemePref = 'light' | 'dark' | 'system'

const LS_THEME = 'fleet_theme'

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref)
}

/** Light unless someone has chosen otherwise — `system` is stored explicitly. */
function read(): ThemePref {
  try {
    const stored = localStorage.getItem(LS_THEME)
    return stored === 'dark' || stored === 'system' ? stored : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme(): [ThemePref, (next: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(read)

  useEffect(() => {
    apply(pref)
    if (pref !== 'system') return
    // Follow the OS while `system` is selected — a laptop that flips at dusk
    // should flip this too, without a reload.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const set = useCallback((next: ThemePref) => {
    try {
      if (next === 'light') localStorage.removeItem(LS_THEME)
      else localStorage.setItem(LS_THEME, next)
    } catch {
      // A blocked localStorage costs the preference, not the page.
    }
    setPref(next)
  }, [])

  return [pref, set]
}

/** Called before React mounts so the first paint is already the right theme. */
export function initTheme() {
  apply(read())
}
