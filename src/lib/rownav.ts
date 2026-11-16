/**
 * j / k through the rows of whatever list is on screen, Enter to open the one
 * picked, `a` to act on it (take an alert). Rows opt in with `data-nav`; the
 * row's first link is what Enter opens, and an element marked `data-ack` is
 * what `a` presses. Kept to the DOM so every page gets it by marking rows,
 * with no state threaded through React.
 */

const ACTIVE = 'data-nav-active'

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('main [data-nav]')].filter((el) => el.offsetParent !== null)
}

function current(list: HTMLElement[]): number {
  return list.findIndex((el) => el.hasAttribute(ACTIVE))
}

function select(list: HTMLElement[], i: number) {
  list.forEach((el) => el.removeAttribute(ACTIVE))
  const el = list[i]
  if (!el) return
  el.setAttribute(ACTIVE, '')
  el.scrollIntoView({ block: 'nearest' })
}

/** Returns true when the key was handled. */
export function handleRowKey(key: string): boolean {
  const list = rows()
  if (list.length === 0) return false
  const i = current(list)
  if (key === 'j' || key === 'ArrowDown') {
    select(list, i < 0 ? 0 : Math.min(i + 1, list.length - 1))
    return true
  }
  if (key === 'k' || key === 'ArrowUp') {
    if (i < 0) return false
    select(list, Math.max(i - 1, 0))
    return true
  }
  if (i < 0) return false
  const row = list[i]!
  if (key === 'Enter') {
    // A focused button or link keeps its own Enter.
    const focused = document.activeElement
    if (focused && focused !== document.body && focused.matches('a, button, [role="button"], [role="switch"]')) return false
    const link = row.matches('a[href]') ? row : row.querySelector<HTMLAnchorElement>('a[href]')
    if (link) {
      link.click()
      return true
    }
    return false
  }
  if (key === 'a') {
    const ack = row.querySelector<HTMLButtonElement>('[data-ack]:not([disabled])')
    if (ack) {
      ack.click()
      return true
    }
    return false
  }
  if (key === 'Escape') {
    select(list, -1)
    return true
  }
  return false
}

/** Forget the selection when the page changes. */
export function clearRowNav() {
  document.querySelectorAll(`[${ACTIVE}]`).forEach((el) => el.removeAttribute(ACTIVE))
}
