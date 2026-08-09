/**
 * A small hand-rolled icon set rather than a dependency: this app needs a
 * handful of glyphs, and one consistent stroke weight matters more than
 * breadth. All are 16px on a 16 grid, 1.5 stroke, round caps — same vocabulary
 * everywhere.
 */

export type IconName =
  | 'terminals'
  | 'shops'
  | 'search'
  | 'chevron'
  | 'sortArrow'
  | 'copy'
  | 'check'
  | 'close'
  | 'refresh'
  | 'alert'
  | 'bug'
  | 'bell'
  | 'link'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'inbox'
  | 'users'
  | 'list'
  | 'prompt'
  | 'download'
  | 'upload'

/** A stroked outline, optionally with a solid half — used for the auto-theme
    glyph, where a stroke-only half circle just reads as the letter D. */
type Glyph = string | { d: string; fill: string }

const PATHS: Record<IconName, Glyph> = {
  terminals: 'M2.75 3.25h10.5v7.5H2.75zM6 13.25h4M8 10.75v2.5',
  shops: 'M2.75 6.25h10.5v7h-10.5zM2.75 6.25 4 2.75h8L13.25 6.25M6.25 13.25v-4h3.5v4',
  search: 'M7.25 12a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5ZM10.75 10.75l2.5 2.5',
  chevron: 'M6 3.5 10.5 8 6 12.5',
  sortArrow: 'M8 3.25v9.5M4.75 9.5 8 12.75l3.25-3.25',
  copy: 'M5.75 5.75h7.5v7.5h-7.5zM10.25 5.75v-3h-7.5v7.5h3',
  check: 'm3.25 8.5 3.25 3.25 6.25-7',
  close: 'm4 4 8 8M12 4l-8 8',
  refresh: 'M13.25 8a5.25 5.25 0 1 1-1.6-3.78M13.25 2.5v3h-3',
  alert: 'M8 5.5v3.25M8 11.25h.01M8 2.25 14 12.75H2z',
  bug: 'M5.25 6.25a2.75 2.75 0 0 1 5.5 0v3a2.75 2.75 0 0 1-5.5 0zM6.25 4.25 5.25 2.75M9.75 4.25l1-1.5M5.25 7.5H2.75M13.25 7.5h-2.5M5.25 10.25 3 11.5M10.75 10.25 13 11.5',
  bell: 'M8 2.75a3.75 3.75 0 0 1 3.75 3.75c0 3 1 3.75 1 3.75h-9.5s1-.75 1-3.75A3.75 3.75 0 0 1 8 2.75ZM6.75 12.75a1.25 1.25 0 0 0 2.5 0',
  link: 'M6.75 9.25a2.5 2.5 0 0 0 3.5 0l2-2a2.47 2.47 0 0 0-3.5-3.5l-.75.75M9.25 6.75a2.5 2.5 0 0 0-3.5 0l-2 2a2.47 2.47 0 0 0 3.5 3.5l.75-.75',
  sun: 'M8 10.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58',
  moon: 'M13.25 9.4A5.6 5.6 0 0 1 6.6 2.75a5.75 5.75 0 1 0 6.65 6.65Z',
  auto: {
    d: 'M8 14.25a6.25 6.25 0 1 0 0-12.5 6.25 6.25 0 0 0 0 12.5Z',
    fill: 'M8 1.75a6.25 6.25 0 0 1 0 12.5Z',
  },
  inbox: 'M2.75 8.75h3l1 2h2.5l1-2h3M2.75 8.75 4.5 3.25h7l1.75 5.5v4h-10.5z',
  users:
    'M6 8.25a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2 13.25c0-2.21 1.79-4 4-4s4 1.79 4 4M11 4.1a2.5 2.5 0 0 1 0 4.83M13.5 13.25c0-2.02-1.5-3.68-3.5-3.96',
  list: 'M6.25 4.25h7M6.25 8h7M6.25 11.75h7M2.75 4.25h.01M2.75 8h.01M2.75 11.75h.01',
  prompt: 'M2.75 2.75h10.5v10.5H2.75zM5 6.25 7.25 8 5 9.75M8.75 9.75h2.25',
  download: 'M8 2.75v7M5 6.75 8 9.75l3-3M3.25 12.75h9.5',
  upload: 'M8 9.75v-7M5 5.75 8 2.75l3 3M3.25 12.75h9.5',
}

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  const glyph = PATHS[name]
  const outline = typeof glyph === 'string' ? glyph : glyph.d

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={outline} />
      {typeof glyph !== 'string' && <path d={glyph.fill} fill="currentColor" stroke="none" />}
    </svg>
  )
}
