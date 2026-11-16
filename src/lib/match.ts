/**
 * How well `query` names `text`: 3 = starts with it, 2 = a word starts with
 * it, 1 = contains it, 0 = no match. Case- and accent-insensitive.
 */
export function score(query: string, text: string): number {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
  const q = fold(query)
  const t = fold(text)
  if (!q) return 0
  if (t.startsWith(q)) return 3
  if (t.split(/[\s\-_/·.]+/).some((w) => w.startsWith(q))) return 2
  return t.includes(q) ? 1 : 0
}

/** Best matches first; ties keep their original order. */
export function rank<T>(query: string, items: T[], text: (t: T) => string, limit = 8): T[] {
  return items
    .map((item, i) => ({ item, i, s: score(query, text(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}

/** Keys pressed while typing belong to the field, not the page. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
