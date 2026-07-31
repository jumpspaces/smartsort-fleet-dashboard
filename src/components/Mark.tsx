/**
 * The wordmark. Four squares on a 2×2 grid — a small fleet — with one of them
 * dimmed: the terminal you opened this to find. It carries no brand colour by
 * design; on this surface colour means fleet state and nothing else.
 */
export function Mark({ sub = true }: { sub?: boolean }) {
  return (
    <div className="mark">
      <span className="mark-glyph" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        SmartSort Fleet
        {sub && (
          <>
            {' '}
            <span className="mark-sub">Internal</span>
          </>
        )}
      </span>
    </div>
  )
}
