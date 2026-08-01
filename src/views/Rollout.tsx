import { useState } from 'react'
import type { Api, DeviceQuery } from '../api.ts'
import { Button, Notice } from '../components/ui.tsx'

/**
 * Roll a signed app update out to many terminals at once.
 *
 * THE FILTER IS THE SELECTION. Whatever the Terminals view is currently showing
 * is what this acts on — the same search, state filter and shop that produced
 * the list on screen. That is deliberate: a rollout is the most consequential
 * thing this console can do, and "the terminals I am looking at" is a target an
 * operator can actually verify before pressing the button. Checkboxes across a
 * paginated table would let someone act on rows they had never seen.
 *
 * Underneath it is nothing new — one `app.bundle` command per terminal, exactly
 * as the drawer issues, with the same allowlist, TTL, audit trail and history.
 * There is no bulk endpoint and no separate code path that could drift from the
 * single-terminal one.
 *
 * The update itself is not disruptive: a terminal downloads it, verifies the
 * signature, and loads it the next time it starts. Nothing restarts a till that
 * is trading.
 */

/** Same shape the terminal and the server both insist on. */
const VERSION = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/

/** Terminals fetched per page when expanding the filter into a device list. */
const PAGE = 200
/** Commands issued at once — enough to be quick, not enough to be a stampede. */
const CONCURRENCY = 5

interface Outcome {
  queued: number
  alreadyQueued: number
  skipped: number
  failed: { deviceId: string; reason: string }[]
}

export function Rollout({
  api,
  query,
  total,
  canAct,
  onIssued,
}: {
  api: Api
  /** The Terminals view's current filter — the selection. */
  query: DeviceQuery
  /** How many terminals match it, for the confirmation line. */
  total: number
  canAct: boolean
  /** Refresh the table once commands are queued. */
  onIssued: () => void
}) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState<null | 'update' | 'undo'>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  if (!canAct) return null

  /** Expand the current filter into every matching terminal, not just page one. */
  async function allMatching() {
    const out = []
    for (let offset = 0; ; offset += PAGE) {
      const page = await api.devices({ ...query, limit: PAGE, offset })
      out.push(...page.devices)
      if (out.length >= page.total || page.devices.length === 0) break
    }
    return out
  }

  async function run(command: 'app.bundle' | 'app.revert') {
    setError(null)
    setOutcome(null)

    if (command === 'app.bundle' && !VERSION.test(version.trim())) {
      setError('Enter a version number like 1.5.2.')
      return
    }

    setBusy(command === 'app.bundle' ? 'update' : 'undo')
    setProgress(0)
    try {
      const devices = await allMatching()
      const result: Outcome = { queued: 0, alreadyQueued: 0, skipped: 0, failed: [] }
      const payload = command === 'app.bundle' ? { version: version.trim() } : {}

      // A terminal on the shared enrollment key has not proven who it is and the
      // server will not hand it commands. Counted, not attempted.
      const targets = devices.filter((d) => {
        if (!d.keyVerified) result.skipped++
        return d.keyVerified
      })

      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        await Promise.all(
          targets.slice(i, i + CONCURRENCY).map(async (d) => {
            try {
              await api.issueCommand(d.deviceId, command, payload)
              result.queued++
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Failed'
              // One already waiting is the expected outcome of re-running a
              // rollout, not a fault worth showing as one.
              if (/already/i.test(message)) result.alreadyQueued++
              else result.failed.push({ deviceId: d.deviceId, reason: message })
            }
          }),
        )
        setProgress(Math.min(i + CONCURRENCY, targets.length))
      }

      setOutcome(result)
      onIssued()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the fleet server')
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Roll out update…
      </Button>
    )
  }

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div className="cmd-head" style={{ marginBottom: 6 }}>
        <span className="strong">Roll out an app update</span>
      </div>

      <p className="hint" style={{ marginBottom: 12 }}>
        Sends a signed update to the <b>{total}</b>{' '}
        {total === 1 ? 'terminal' : 'terminals'} matching the current filter. Each one downloads
        it, checks the signature, and loads it the next time it starts — no till is interrupted
        while it is trading.
      </p>

      {error && <Notice>{error}</Notice>}

      <div className="toolbar" style={{ gap: 8 }}>
        <input
          className="input"
          value={version}
          placeholder="1.5.2"
          aria-label="Version to roll out"
          disabled={busy != null}
          onChange={(e) => setVersion(e.target.value)}
        />
        <Button size="sm" busy={busy === 'update'} onClick={() => void run('app.bundle')}>
          Roll out
        </Button>
        <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      {busy && (
        <p className="hint" style={{ marginTop: 10 }}>
          Queueing… {progress} of {total}
        </p>
      )}

      {outcome && (
        <div style={{ marginTop: 12 }}>
          <p className="hint">
            Queued for <b>{outcome.queued}</b>{' '}
            {outcome.queued === 1 ? 'terminal' : 'terminals'}.
            {outcome.alreadyQueued > 0 && ` ${outcome.alreadyQueued} already had one waiting.`}
            {outcome.skipped > 0 &&
              ` ${outcome.skipped} skipped — not yet claimed, so they cannot be sent actions.`}
          </p>
          {outcome.failed.length > 0 && (
            <>
              <p className="bad-text small" style={{ marginTop: 6 }}>
                {outcome.failed.length} failed:
              </p>
              <ul className="plain-list">
                {outcome.failed.slice(0, 10).map((f) => (
                  <li key={f.deviceId} className="muted small">
                    {f.deviceId} — {f.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="hint" style={{ marginTop: 8 }}>
            Each terminal picks it up on its next heartbeat, within about three minutes. Watch
            the Version column to see it land.
          </p>
        </div>
      )}

      {/* The 9am button. A bundle can be bad in a way no health check catches —
          it draws perfectly and a total is wrong — and when that happens the
          fleet needs one action, not a hundred. */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--line, #2a2a2a)', paddingTop: 12 }}>
        <p className="hint" style={{ marginBottom: 8 }}>
          Something wrong with an update already out there?
        </p>
        <Button size="sm" variant="danger" busy={busy === 'undo'} onClick={() => void run('app.revert')}>
          Undo on all {total} matching
        </Button>
      </div>
    </div>
  )
}
