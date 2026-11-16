import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'
const KEY = 'fleet_theme'

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Follows the OS until someone picks; the choice is per browser. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      if (theme === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, theme)
    } catch {
      // Storage refused: the choice lasts this tab.
    }
  }, [theme])
  return [theme, setTheme]
}

/** Apply the stored choice before React mounts, so there's no flash. */
export function applyStoredTheme() {
  const t = read()
  if (t !== 'system') document.documentElement.setAttribute('data-theme', t)
}
