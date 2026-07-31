/**
 * A trend line for one metric over one device's recent beats.
 *
 * Inline SVG, no library, no axes, no tooltip. The question it answers is the
 * one a snapshot cannot — "is this getting worse?" — and that reads off the
 * shape alone. Anything more would be a chart pretending a 48-hour sample is a
 * report.
 *
 * Colour comes from `currentColor` so it inherits the tone of whatever encloses
 * it and stays correct in both themes without a second palette.
 */
export function Sparkline({
  values,
  width = 160,
  height = 32,
  label,
}: {
  values: (number | null)[]
  width?: number
  height?: number
  /** Screen-reader description; the shape alone is not accessible. */
  label: string
}) {
  const points = values.filter((v): v is number => v != null)
  if (points.length < 2) {
    return <div className="spark-empty">Not enough history yet</div>
  }

  const max = Math.max(...points)
  const min = Math.min(...points)
  // A flat line should sit in the middle rather than collapse onto the floor,
  // which would read as "dropped to zero".
  const span = max - min || 1
  const stepX = width / (points.length - 1)
  // Inset by the stroke width so the first and last points are not clipped.
  const pad = 2
  const usable = height - pad * 2

  const d = points
    .map((v, i) => {
      const x = i * stepX
      const y = pad + usable - ((v - min) / span) * usable
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${min} to ${max} over ${points.length} readings`}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
