/**
 * Name a filter, come back to it.
 *
 * Every filter this console has is already in the URL, which made links
 * shareable — the hard half. What it did not solve is the daily one: an operator
 * has three or four lists they open every morning ("offline, not silenced",
 * "everything on the old build", "the pilot ring") and rebuilds each of them by
 * hand, every time, from the same four controls.
 *
 * Stored locally rather than on the server, deliberately. These are one person's
 * habits, not fleet configuration: they need no audit trail, no roles, no
 * migration, and syncing them would make a private shortcut into something
 * colleagues can quietly change under you.
 */
import { useEffect, useState } from 'react'
import { Button } from '../components/ui.tsx'
import { Icon } from '../components/Icon.tsx'

const KEY = 'fleet_saved_views'
const MAX = 12

export interface SavedView {
  name: string
  /** The hash this view restores, minus the leading '#'. */
  hash: string
}

function read(): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedView[]
    return Array.isArray(parsed) ? parsed.filter((v) => v?.name && v?.hash).slice(0, MAX) : []
  } catch {
    return []
  }
}

function write(views: SavedView[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(views.slice(0, MAX)))
  } catch {
    // A full or blocked localStorage costs a convenience, not the page.
  }
}

export function SavedViews({ currentHash }: { currentHash: string }) {
  const [views, setViews] = useState<SavedView[]>(read)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  // Another tab saving a view should not leave this one stale.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setViews(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    // Saving over a name replaces it: the alternative is two entries called
    // "offline" that differ in a way nobody can see from the list.
    const next = [{ name: trimmed, hash: currentHash }, ...views.filter((v) => v.name !== trimmed)]
    setViews(next)
    write(next)
    setName('')
    setNaming(false)
  }

  const remove = (target: string) => {
    const next = views.filter((v) => v.name !== target)
    setViews(next)
    write(next)
  }

  const here = views.find((v) => v.hash === currentHash)

  return (
    <div className="toolbar-end">
      {views.map((v) => (
        <span key={v.name} className="tag-chip">
          <button
            type="button"
            className="row-open"
            aria-current={v.hash === currentHash ? 'true' : undefined}
            onClick={() => {
              window.location.hash = v.hash
            }}
          >
            {v.name}
          </button>
          <button type="button" aria-label={`Forget ${v.name}`} onClick={() => remove(v.name)}>
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}

      {naming ? (
        <>
          <input
            className="input"
            value={name}
            autoFocus
            placeholder="Name this list…"
            aria-label="Name for this saved view"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setNaming(false)
            }}
          />
          <Button size="sm" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </>
      ) : (
        !here && (
          <Button size="sm" variant="ghost" onClick={() => setNaming(true)}>
            Save this list
          </Button>
        )
      )}
    </div>
  )
}
