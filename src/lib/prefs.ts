import { useEffect, useState } from 'react'

/**
 * Per-browser conveniences: row density and saved views. Same storage keys as
 * the old console, so nobody loses theirs. Storage can be refused (private
 * windows); that costs the preference, never the page.
 */

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Refused — the choice lasts this tab.
  }
}

/* ---------------------------------------------------------------- density */

export type Density = 'comfortable' | 'compact'
const DENSITY = 'fleet_density'

export function applyStoredDensity() {
  document.documentElement.dataset.density = read(DENSITY) === 'compact' ? 'compact' : 'comfortable'
}

export function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(() => (read(DENSITY) === 'compact' ? 'compact' : 'comfortable'))
  useEffect(() => {
    document.documentElement.dataset.density = d
    write(DENSITY, d === 'compact' ? 'compact' : null)
  }, [d])
  return [d, setD]
}

/* ------------------------------------------------------------ saved views */

export interface SavedView {
  name: string
  /** The hash it restores, without the leading '#'. */
  hash: string
}

const VIEWS = 'fleet_saved_views'
const MAX = 12

/** Old console paths, so views saved there still open the right page. */
export function migrateHash(hash: string): string {
  return hash.replace(/^\/terminals(?=$|[/?])/, '/tills').replace(/^\/errors(?=$|[/?])/, '/problems').replace(/^\/rollouts(?=$|[/?])/, '/updates')
}

export function readViews(): SavedView[] {
  try {
    const parsed = JSON.parse(read(VIEWS) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is SavedView => !!v && typeof v.name === 'string' && typeof v.hash === 'string')
      .map((v) => ({ name: v.name, hash: migrateHash(v.hash) }))
  } catch {
    return []
  }
}

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(readViews)
  useEffect(() => {
    // Another tab saved one: pick it up.
    const onStorage = (e: StorageEvent) => e.key === VIEWS && setViews(readViews())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const save = (next: SavedView[]) => {
    const trimmed = next.slice(0, MAX)
    write(VIEWS, JSON.stringify(trimmed))
    setViews(trimmed)
  }
  return {
    views,
    add: (name: string, hash: string) => save([{ name, hash }, ...views.filter((v) => v.name !== name)]),
    remove: (name: string) => save(views.filter((v) => v.name !== name)),
    full: views.length >= MAX,
  }
}
