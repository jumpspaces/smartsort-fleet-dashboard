import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api/endpoints.ts'
import { useApi, useShops } from '../data.ts'
import { rank } from '../lib/match.ts'
import { tillName } from '../lib/plain.ts'
import { useDebounced } from '../lib/query.ts'
import { href, shopHref, tillHref } from '../lib/router.ts'

export const PAGES: { label: string; path: string; params?: Record<string, string> }[] = [
  { label: 'Home', path: '/' },
  { label: 'Alerts', path: '/alerts' },
  { label: 'Tills', path: '/tills' },
  { label: 'Tills — offline', path: '/tills', params: { state: 'offline' } },
  { label: 'Tills — need a look', path: '/tills', params: { state: 'attention' } },
  { label: 'Shops', path: '/shops' },
  { label: 'App problems', path: '/problems' },
  { label: 'Remote fixes', path: '/fixes' },
  { label: 'Updates', path: '/updates' },
  { label: 'History', path: '/history' },
  { label: 'Backups', path: '/backups' },
  { label: 'Records check', path: '/records' },
  { label: 'Activity log', path: '/activity' },
  { label: 'Settings — team', path: '/settings' },
  { label: 'Settings — alert rules', path: '/settings', params: { tab: 'rules' } },
  { label: 'Settings — detection', path: '/settings', params: { tab: 'detection' } },
  { label: 'Settings — notifications', path: '/settings', params: { tab: 'notify' } },
  { label: 'Settings — quiet periods', path: '/settings', params: { tab: 'quiet' } },
  { label: 'Settings — assistant', path: '/settings', params: { tab: 'assistant' } },
  { label: 'Settings — festive days', path: '/settings', params: { tab: 'festive' } },
]

interface Hit {
  key: string
  label: string
  kind: string
  to: string
}

/** ⌘K: go to any page, shop or till by typing its name. */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const dq = useDebounced(q.trim(), 150)
  const shops = useShops()
  // Tills are too many to hold; ask the server once the query is specific.
  const tills = useApi(`devices:palette:${dq}`, (c, s) => api.devices(c, { q: dq, limit: 8, includeRemoved: true }, s), {
    enabled: open && dq.length >= 2,
  })

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setQ('')
      setSel(0)
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  const hits: Hit[] = useMemo(() => {
    const term = q.trim()
    const pages = (term ? rank(term, PAGES, (p) => p.label, 5) : PAGES.slice(0, 6)).map((p) => ({
      key: `p:${p.label}`,
      label: p.label,
      kind: 'Page',
      to: href(p.path, p.params),
    }))
    if (!term) return pages
    const shopHits = rank(term, shops.data ?? [], (s) => `${s.name} ${s.code ?? ''} ${s.location ?? ''} ${s.owner?.name ?? ''}`, 6).map((s) => ({
      key: `s:${s.id}`,
      label: s.name,
      kind: 'Shop',
      to: shopHref(s.id),
    }))
    const tillHits = (dq === term ? (tills.data?.devices ?? []) : []).map((d) => ({
      key: `t:${d.deviceId}`,
      label: `${tillName(d)}${d.shopName ? ` · ${d.shopName}` : ''}`,
      kind: 'Till',
      to: tillHref(d.deviceId),
    }))
    return [...pages, ...shopHits, ...tillHits]
  }, [q, dq, shops.data, tills.data])

  const go = (h: Hit | undefined) => {
    if (!h) return
    location.hash = h.to
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className="dialog palette"
      aria-label="Go to"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={hits[sel] ? `pal-${sel}` : undefined}
            placeholder="Go to a page, shop or till…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((n) => Math.min(n + 1, hits.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((n) => Math.max(n - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                go(hits[sel])
              }
            }}
          />
          <ul id="palette-list" role="listbox">
            {hits.length === 0 && <li className="small muted" style={{ padding: 10 }}>{tills.refreshing ? 'Searching…' : 'Nothing matches.'}</li>}
            {hits.map((h, i) => (
              <li key={h.key} id={`pal-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)}>
                <a href={h.to} onClick={onClose}>
                  <span>{h.label}</span>
                  <span className="small muted">{h.kind}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </dialog>
  )
}

const KEYS: [string, string][] = [
  ['⌘ K  /  Ctrl K', 'Go to a page, shop or till'],
  ['/', 'Search this page'],
  ['j  /  k', 'Next / previous row'],
  ['Enter', 'Open the picked row'],
  ['a', 'Take the picked alert (“I’m on it”)'],
  ['?', 'Show these keys'],
  ['Esc', 'Close a window'],
]

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {open && (
        <div className="dialog-body">
          <h2 style={{ marginBottom: 12 }}>Keyboard shortcuts</h2>
          <table className="table">
            <tbody>
              {KEYS.map(([k, what]) => (
                <tr key={k}>
                  <td className="nowrap">
                    <span className="kbd">{k}</span>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </dialog>
  )
}
