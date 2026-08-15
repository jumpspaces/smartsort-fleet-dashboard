/**
 * Row density, for people who live in this console.
 *
 * The comfortable default is right for somebody who opens the terminals list
 * twice a day. It is wrong for somebody who has it open all day on a laptop, for
 * whom the sub-lines they have already memorised cost half the rows on screen.
 *
 * Compact removes padding and the secondary lines — never a column, never a
 * number. A density switch that hides information is not a density switch, it is
 * a different view that lies about being the same one.
 *
 * Same shape as the theme preference next to it: an attribute on <html>, so the
 * choice is one CSS selector rather than a prop threaded through every table.
 */
import { useEffect, useState } from 'react'

export type Density = 'comfortable' | 'compact'

const KEY = 'fleet_density'

function read(): Density {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function apply(density: Density): void {
  const root = document.documentElement
  if (density === 'compact') root.setAttribute('data-density', 'compact')
  else root.removeAttribute('data-density')
}

export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensity] = useState<Density>(read)

  useEffect(() => {
    apply(density)
    try {
      localStorage.setItem(KEY, density)
    } catch {
      // A blocked localStorage costs the preference, not the page.
    }
  }, [density])

  return [density, setDensity]
}
