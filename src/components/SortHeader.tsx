import { Icon } from './Icon.tsx'

export interface Sort<K extends string> {
  key: K
  dir: 'asc' | 'desc'
}

/**
 * A sortable column header. The visible label stays a noun phrase; the arrow is
 * decorative and the announced name carries the direction a press will produce,
 * so a screen reader user isn't told the arrow's shape.
 */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  numeric = false,
  /** Most columns read best descending first (worst / newest at the top). */
  defaultDir = 'desc',
}: {
  label: string
  sortKey: K
  sort: Sort<K>
  onSort: (s: Sort<K>) => void
  numeric?: boolean
  defaultDir?: 'asc' | 'desc'
}) {
  const active = sort.key === sortKey
  const nextDir = active ? (sort.dir === 'asc' ? 'desc' : 'asc') : defaultDir

  return (
    <th
      scope="col"
      className={numeric ? 'col-num' : undefined}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className="th-sort"
        onClick={() => onSort({ key: sortKey, dir: nextDir })}
        aria-label={`${label}, sort ${nextDir === 'asc' ? 'ascending' : 'descending'}`}
      >
        {label}
        <Icon name="sortArrow" size={12} className="th-arrow" />
      </button>
    </th>
  )
}

export function PlainHeader({
  label,
  numeric = false,
  srOnly = false,
}: {
  label: string
  numeric?: boolean
  srOnly?: boolean
}) {
  return (
    <th scope="col" className={numeric ? 'col-num' : undefined}>
      <span className={srOnly ? 'sr-only' : 'th-label'}>{label}</span>
    </th>
  )
}

/** Shared comparator: nulls always sort last, whichever direction is active. */
export function compare(
  a: number | string | null,
  b: number | string | null,
  dir: 'asc' | 'desc',
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const sign = dir === 'asc' ? 1 : -1
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).localeCompare(String(b), undefined, { numeric: true }) * sign
  }
  return (a - b) * sign
}
