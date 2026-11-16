import { useEffect, useRef, useState } from 'react'
import type { Alert } from '../api/types.ts'
import { rulePlain } from './plain.ts'
import { shopHref, tillHref } from './router.ts'

/**
 * Desktop notifications for urgent alerts, while the console is open in a
 * background tab. Opt-in per browser. Alerts already open when the page
 * loads are never announced — only ones that appear while you're away.
 */
const PREF = 'fleet_notify'

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) === 'on'
  } catch {
    return false
  }
}

export function useNotifyPref(): [boolean, () => Promise<void>] {
  const [on, setOn] = useState(() => notifySupported() && readPref() && Notification.permission === 'granted')
  const toggle = async () => {
    if (!notifySupported()) return
    if (on) {
      setOn(false)
      try {
        localStorage.removeItem(PREF)
      } catch {
        // ignore
      }
      return
    }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (perm !== 'granted') return
    try {
      localStorage.setItem(PREF, 'on')
    } catch {
      // ignore
    }
    setOn(true)
  }
  return [on, toggle]
}

/** Which alerts are new since the last look — pure, for testing. */
export function newUrgent(seen: Set<string>, alerts: Alert[]): Alert[] {
  return alerts.filter((a) => a.state === 'open' && a.severity === 'critical' && !seen.has(a.id))
}

export function useAlertNotifications(alerts: Alert[] | undefined, enabled: boolean) {
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!alerts) return
    // First load: remember what's already open, announce nothing.
    if (seen.current === null) {
      seen.current = new Set(alerts.map((a) => a.id))
      return
    }
    const fresh = newUrgent(seen.current, alerts)
    alerts.forEach((a) => seen.current!.add(a.id))
    if (!enabled || !notifySupported() || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible') return
    for (const a of fresh.slice(0, 3)) {
      const p = rulePlain(a.ruleKey, a.title)
      const n = new Notification(`${p.title}${a.shopName ? ` — ${a.shopName}` : ''}`, {
        body: p.hint || a.title,
        tag: a.id,
      })
      n.onclick = () => {
        window.focus()
        location.hash = a.deviceId ? tillHref(a.deviceId) : a.shopId ? shopHref(a.shopId) : '#/alerts'
        n.close()
      }
    }
  }, [alerts, enabled])
}
