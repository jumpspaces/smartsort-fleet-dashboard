/**
 * `?` — the keys this console answers to.
 *
 * Shortcuts that nobody can discover are shortcuts nobody uses. The three that
 * exist here are worth learning and none of them is written down anywhere else:
 * `/` to search, `⌘K` to go anywhere, `?` to find this. A tool people sit in
 * front of all day earns one overlay listing them.
 */
import { useEffect } from 'react'
import { Icon } from './Icon.tsx'

const KEYS: { keys: string[]; what: string }[] = [
  { keys: ['⌘', 'K'], what: 'Go to a terminal, a shop, or any section' },
  { keys: ['/'], what: 'Jump to the search box on a list' },
  { keys: ['?'], what: 'This list' },
  { keys: ['Esc'], what: 'Close whatever is open; clear the search box' },
  { keys: ['↑', '↓'], what: 'Move through results in the palette' },
  { keys: ['↵'], what: 'Open the selected result' },
]

export function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="palette-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="prompt" size={15} />
          Keyboard shortcuts
        </div>
        <div className="palette-results">
          {KEYS.map((k) => (
            <div key={k.what} className="palette-item" style={{ cursor: 'default' }}>
              <span className="cell-stack">
                {k.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
              <span className="muted" style={{ marginLeft: 12 }}>
                {k.what}
              </span>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
