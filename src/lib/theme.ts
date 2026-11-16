import { useEffect, useState } from 'react'

/**
 * Light is the default: this is mostly glanced at on a lit desk, during the
 * day. Dark is a real peer — the 11pm "a shop just called" case — and `system`
 * is a visible choice, but opt-in: an OS set to dark for other reasons should
 * not turn the console dark uninvited.
 */
export type Theme = 'light' | 'dark' | 'system'
const KEY = 'fleet_theme'

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

/** `system` leaves data-theme unset, so the CSS media query decides. */
function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    apply(theme)
    try {
      // Light is the default, so it needs no stored value.
      if (theme === 'light') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, theme)
    } catch {
      // Storage refused: the choice lasts this tab.
    }
  }, [theme])
  return [theme, setTheme]
}

/** Apply the stored choice before React mounts, so there's no flash. */
export function applyStoredTheme() {
  apply(read())
}
