/**
 * ⌘K — go to anything by typing its name.
 *
 * The console has outgrown its rail: eleven sections, and the things an operator
 * actually wants are three levels down inside them — one shop, one terminal, one
 * fault. Navigating to a specific terminal currently means Terminals → search →
 * scan → click, which is four steps to reach something whose name the person
 * already knows.
 *
 * Searches across shops and terminals through the endpoints that already exist,
 * debounced, plus the static destinations. Deliberately no fuzzy matching
 * library: substring on a name is what people type, and anything cleverer would
 * make the first result unpredictable — the one property this must never lose,
 * because the whole interaction is "type three letters, press Enter".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Api } from '../api.ts'
import type { View } from '../lib/route.ts'
import { Icon, type IconName } from './Icon.tsx'

export interface PaletteAction {
  id: string
  group: 'Go to' | 'Terminals' | 'Shops'
  label: string
  hint?: string
  icon: IconName
  run: () => void
}

const SECTIONS: { view: View; label: string; icon: IconName }[] = [
  { view: 'terminals', label: 'Terminals', icon: 'terminals' },
  { view: 'alerts', label: 'Alerts', icon: 'bell' },
  { view: 'errors', label: 'Errors', icon: 'bug' },
  { view: 'shops', label: 'Shops', icon: 'shops' },
  { view: 'rollouts', label: 'Rollouts', icon: 'rocket' },
  { view: 'trends', label: 'Trends', icon: 'trend' },
  { view: 'backups', label: 'Backups', icon: 'shield' },
  { view: 'commands', label: 'Commands', icon: 'prompt' },
  { view: 'audit', label: 'Audit', icon: 'list' },
]

export function Palette({
  api,
  onClose,
  onNavigate,
}: {
  api: Api
  onClose: () => void
  onNavigate: (view: View, params?: Record<string, string | undefined>) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [remote, setRemote] = useState<PaletteAction[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const go = useCallback(
    (view: View, params?: Record<string, string | undefined>) => {
      onNavigate(view, params)
      onClose()
    },
    [onNavigate, onClose],
  )

  const statics = useMemo<PaletteAction[]>(
    () =>
      SECTIONS.map((s) => ({
        id: `view:${s.view}`,
        group: 'Go to' as const,
        label: s.label,
        icon: s.icon,
        run: () => go(s.view),
      })),
    [go],
  )

  // Remote results only once there is something to search for: an empty palette
  // should open instantly and offer the sections, not a page of arbitrary rows.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setRemote([])
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      void Promise.all([
        api.devices({ q: term, limit: 6 }).catch(() => null),
        api.shops().catch(() => null),
      ]).then(([devices, shops]) => {
        if (!live) return
        const out: PaletteAction[] = []
        for (const d of devices?.devices ?? []) {
          out.push({
            id: `device:${d.deviceId}`,
            group: 'Terminals',
            label: d.machineName
              ? `${d.shopName ?? 'Unclaimed'} · ${d.machineName}`
              : (d.shopName ?? d.deviceId.slice(0, 12)),
            hint: d.terminalCode ?? d.deviceId.slice(0, 8),
            icon: 'terminals',
            run: () => go('device', { id: d.deviceId }),
          })
        }
        const needle = term.toLowerCase()
        for (const s of (shops ?? []).filter(
          (s) =>
            s.name.toLowerCase().includes(needle) ||
            (s.code ?? '').toLowerCase().includes(needle),
        )) {
          out.push({
            id: `shop:${s.id}`,
            group: 'Shops',
            label: s.name,
            hint: s.code ?? undefined,
            icon: 'shops',
            run: () => go('shop', { id: s.id }),
          })
        }
        setRemote(out.slice(0, 12))
      })
    }, 160)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [api, query, go])

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    const matching = term
      ? statics.filter((a) => a.label.toLowerCase().includes(term))
      : statics
    return [...matching, ...remote]
  }, [statics, remote, query])

  useEffect(() => setCursor(0), [query])

  const grouped = useMemo(() => {
    const out: { group: string; items: PaletteAction[] }[] = []
    for (const item of results) {
      const last = out.at(-1)
      if (last && last.group === item.group) last.items.push(item)
      else out.push({ group: item.group, items: [item] })
    }
    return out
  }, [results])

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search the console">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Search terminals, shops and sections…"
          aria-label="Search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              results[cursor]?.run()
            }
          }}
        />

        <div className="palette-results">
          {results.length === 0 && (
            <div className="palette-group">Nothing matches “{query.trim()}”</div>
          )}
          {grouped.map((g) => (
            <div key={g.group}>
              <div className="palette-group">{g.group}</div>
              {g.items.map((item) => {
                const index = results.indexOf(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="palette-item"
                    aria-selected={index === cursor}
                    onMouseEnter={() => setCursor(index)}
                    onClick={item.run}
                  >
                    <Icon name={item.icon} size={14} />
                    {item.label}
                    {item.hint && <span className="muted mono">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="palette-foot">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
