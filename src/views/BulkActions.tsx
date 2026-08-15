/**
 * Do one safe thing to every terminal the filter has selected.
 *
 * Rolling out an update already worked this way; everything else was one
 * terminal at a time, which meant "force a sync on the nine tills whose queue is
 * stuck" was nine page loads and nine clicks — long enough that in practice
 * nobody did it, and the queues stayed stuck.
 *
 * THE FILTER IS THE SELECTION, exactly as the rollout panel has it: whatever the
 * list is currently showing is what this acts on. Checkboxes across a paginated
 * table would let somebody act on rows they never saw, and these are actions on
 * a stranger's shop floor.
 *
 * Only the harmless commands are offered here. Restarting a terminal's backend
 * interrupts trading, and doing that to forty shops from one button is not a
 * bulk action, it is an outage — so it stays where it belongs, on one terminal's
 * page with that terminal's name on it.
 */
import { useState } from 'react'
import type { Api, DeviceQuery, DeviceRow } from '../api.ts'
import { Button, Notice } from '../components/ui.tsx'

/** Terminals fetched per page when expanding the filter into a device list. */
const PAGE = 200
const CONCURRENCY = 5

const SAFE: { command: string; label: string; blurb: string }[] = [
  {
    command: 'sync.now',
    label: 'Force sync',
    blurb: 'Drains whatever is queued, immediately, on every matching terminal.',
  },
  {
    command: 'report.now',
    label: 'Ask for a fresh check-in',
    blurb: 'Useful right after a fix, when waiting three minutes to see it is the slow part.',
  },
  {
    command: 'backup.now',
    label: 'Back up now',
    blurb: 'Takes a local snapshot before anybody touches anything.',
  },
]

export function BulkActions({
  api,
  query,
  total,
  canAct,
  onDone,
}: {
  api: Api
  query: DeviceQuery
  total: number
  canAct: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ queued: number; skipped: number; failed: number } | null>(
    null,
  )

  if (!canAct) return null

  async function allMatching(): Promise<DeviceRow[]> {
    const out: DeviceRow[] = []
    for (let offset = 0; ; offset += PAGE) {
      const page = await api.devices({ ...query, limit: PAGE, offset })
      out.push(...page.devices)
      if (out.length >= page.total || page.devices.length === 0) break
    }
    return out
  }

  async function run(command: string) {
    setBusy(command)
    setError(null)
    setOutcome(null)
    setProgress(0)
    try {
      const devices = await allMatching()
      const result = { queued: 0, skipped: 0, failed: 0 }
      // A terminal on the shared enrollment key is not sent actions by the
      // server. Counted rather than attempted, so the report is honest.
      const targets = devices.filter((d) => {
        if (!d.keyVerified) result.skipped++
        return d.keyVerified
      })

      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        await Promise.all(
          targets.slice(i, i + CONCURRENCY).map(async (d) => {
            try {
              await api.issueCommand(d.deviceId, command, {})
              result.queued++
            } catch (err) {
              // One already waiting is the expected outcome of pressing this
              // twice, not a fault worth reporting as one.
              if (!/already/i.test(err instanceof Error ? err.message : '')) result.failed++
            }
          }),
        )
        setProgress(Math.min(i + CONCURRENCY, targets.length))
      }

      setOutcome(result)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the fleet server')
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Act on these {total}…
      </Button>
    )
  }

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div className="cmd-head" style={{ marginBottom: 6 }}>
        <span className="strong">Act on the {total} terminals in this list</span>
      </div>

      {error && <Notice>{error}</Notice>}

      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        {SAFE.map((c) => (
          <Button
            key={c.command}
            size="sm"
            busy={busy === c.command}
            disabled={busy != null}
            title={c.blurb}
            onClick={() => void run(c.command)}
          >
            {c.label}
          </Button>
        ))}
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
        <p className="hint" style={{ marginTop: 10 }}>
          Queued for <b>{outcome.queued}</b>. {outcome.skipped > 0 && `${outcome.skipped} skipped — still on the shared enrollment key. `}
          {outcome.failed > 0 && `${outcome.failed} failed. `}
          Each terminal picks it up on its next check-in, within about three minutes.
        </p>
      )}

      <p className="hint" style={{ marginTop: 8 }}>
        Restarting a terminal's backend is not offered here: it interrupts whoever is at the till,
        and doing that to a filter's worth of shops at once is an outage rather than an action.
      </p>
    </div>
  )
}
