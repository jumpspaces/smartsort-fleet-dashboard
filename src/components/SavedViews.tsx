import { useState } from 'react'
import { useSavedViews } from '../lib/prefs.ts'

/**
 * Name the current filter and come back to it in one click — for the three or
 * four lists someone opens every morning. Per browser.
 */
export function SavedViews({ page }: { page: string }) {
  const { views, add, remove, full } = useSavedViews()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const current = window.location.hash.replace(/^#/, '')
  const mine = views.filter((v) => v.hash.split('?')[0] === page)
  const hasFilter = current.includes('?')

  return (
    <div className="chips" aria-label="Saved views">
      {mine.map((v) => (
        <span key={v.name} className="chip" style={v.hash === current ? { borderColor: 'var(--ink)' } : undefined}>
          <a href={`#${v.hash}`}>{v.name}</a>
          <button type="button" aria-label={`Forget view ${v.name}`} title="Forget this view" onClick={() => remove(v.name)}>
            ×
          </button>
        </span>
      ))}
      {naming ? (
        <form
          className="row"
          style={{ gap: 4 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            add(name.trim(), current)
            setName('')
            setNaming(false)
          }}
        >
          <input
            className="input"
            style={{ height: 28, width: 180 }}
            autoFocus
            maxLength={40}
            placeholder="Name this view"
            aria-label="Name this view"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
          />
          <button className="btn sm primary" type="submit">
            Save
          </button>
        </form>
      ) : (
        hasFilter && (
          <button type="button" className="btn sm ghost" disabled={full} title={full ? 'Forget one first (12 at most)' : undefined} onClick={() => setNaming(true)}>
            + Save this view
          </button>
        )
      )}
    </div>
  )
}
