/**
 * One terminal's last day, as a shape.
 *
 * "Last seen: 3m ago" answers exactly one question — is it here now — and hides
 * the one that decides what to do about it. A till that has been solidly up all
 * week and a till that drops off every hour both read "3m ago" between drops,
 * and they are different faults: one needs nothing, the other needs a router.
 *
 * Deliberately not a chart. No axis, no tooltip, no library: forty-eight cells,
 * present or absent, sized to sit inside a table row without changing its
 * height. The eye reads the gaps, which is the whole content.
 */
export function Heartbeat({
  buckets,
  expectedPerBucket,
  bucketMs,
  fromMs,
}: {
  buckets: number[]
  expectedPerBucket: number
  bucketMs: number
  fromMs: number
}) {
  if (buckets.length === 0) return <span className="muted small">—</span>

  const missing = buckets.filter((b) => b === 0).length
  const hours = Math.round((buckets.length * bucketMs) / 3_600_000)
  const label =
    missing === 0
      ? `Checked in throughout the last ${hours}h`
      : `Missed ${missing} of ${buckets.length} check-in windows in the last ${hours}h`

  return (
    <span className="hb" role="img" aria-label={label} title={label}>
      {buckets.map((beats, i) => {
        // Three states, not a gradient: up, partial, absent. A shade per beat
        // count would imply a precision that a bucket boundary does not have —
        // a terminal beating on the edge of two slots is not half down.
        const level = beats === 0 ? 'none' : beats >= expectedPerBucket ? 'full' : 'partial';
        const at = new Date(fromMs + i * bucketMs)
        return (
          <i
            key={i}
            className="hb-cell"
            data-level={level}
            title={`${at.toLocaleString()} — ${beats} check-in${beats === 1 ? '' : 's'}`}
          />
        )
      })}
    </span>
  )
}
