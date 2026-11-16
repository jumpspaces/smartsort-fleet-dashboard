/**
 * A plain bar chart: one bar per day, ink-coloured (colour is reserved for
 * state). Hover shows the exact value; the max is labelled so the scale is
 * readable without an axis.
 */
export function Bars({
  points,
  format,
  height = 96,
  label,
}: {
  points: { key: string; value: number | null; label: string }[]
  format: (n: number) => string
  height?: number
  label: string
}) {
  const values = points.map((p) => p.value ?? 0)
  const max = Math.max(...values, 0)
  if (points.length === 0) return <div className="muted small">No data yet.</div>
  return (
    <figure className="bars" aria-label={label} style={{ margin: 0 }}>
      <div className="bars-max small muted">{format(max)}</div>
      <div className="bars-plot" style={{ height }} role="img" aria-label={`${label}, highest ${format(max)}`}>
        {points.map((p) => {
          const h = max > 0 && p.value != null ? Math.max(2, (p.value / max) * height) : 0
          return (
            <span key={p.key} title={`${p.label}: ${p.value == null ? 'no data' : format(p.value)}`}>
              <i style={{ height: h }} className={p.value == null ? 'gap' : undefined} />
            </span>
          )
        })}
      </div>
      <div className="strip-axis">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </figure>
  )
}
