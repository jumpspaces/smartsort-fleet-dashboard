import { useState } from 'react'
import type { Api, DeviceQuery, Overview } from '../api.ts'
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

/** What the target set was, in words, for the rollout's own record of itself. */
function describe(query: DeviceQuery, total: number): string {
  const parts: string[] = []
  if (query.state && query.state !== 'all') parts.push(query.state)
  if (query.shopId) parts.push('one shop')
  if (query.platform) parts.push(query.platform)
  if (query.appVersion) parts.push(`on ${query.appVersion}`)
  if (query.tag) parts.push(`tagged ${query.tag}`)
  if (query.q) parts.push(`matching "${query.q}"`)
  return parts.length ? `${total} terminals — ${parts.join(', ')}` : `all ${total} terminals`
}

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
  release,
  onIssued,
  onOpenRollouts,
}: {
  api: Api
  /** The Terminals view's current filter — the selection. */
  query: DeviceQuery
  /** How many terminals match it, for the confirmation line. */
  total: number
  canAct: boolean
  /**
   * What is actually published, read off the update feed. This box used to be
   * free text against a regex, so the version came out of somebody's memory and
   * a typo produced a command every terminal would silently refuse.
   */
  release: Overview['release'] | null
  onIssued: () => void
  /** Where to send someone once the rollout has a life of its own to watch. */
  onOpenRollouts?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const rollable = release?.rollableVersions ?? []
  const [busy, setBusy] = useState<null | 'update' | 'undo'>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // Defaults chosen to be defensible without thought: a tenth of the fleet, two
  // bad terminals is a pattern, half an hour is long enough for a shop to have
  // served somebody on the new build.
  const [canaryPercent, setCanaryPercent] = useState(10)
  const [haltErrorDevices, setHaltErrorDevices] = useState(2)
  const [observeMinutes, setObserveMinutes] = useState(30)

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

  /**
   * Start a STAGED rollout: a canary first, watched, then the rest.
   *
   * The old path issued one command per terminal from the browser, which meant
   * the whole fleet took the build in one go and the only supervision was
   * whoever happened to be looking. The server now owns the wave logic, so the
   * page's job is to say what the target set is and hand it over.
   */
  async function stage() {
    setError(null)
    setOutcome(null)
    if (!VERSION.test(version.trim())) {
      setError('Enter a version number like 1.5.2.')
      return
    }
    setBusy('update')
    setProgress(0)
    try {
      const devices = await allMatching()
      const eligible = devices.filter((d) => d.keyVerified)
      if (eligible.length === 0) {
        setError(
          'None of these terminals can take an update — they are still on the shared enrollment key.',
        )
        return
      }
      const rollout = await api.createRollout({
        version: version.trim(),
        deviceIds: eligible.map((d) => d.deviceId),
        targetLabel: describe(query, total),
        canaryPercent,
        haltErrorDevices,
        observeMinutes,
      })
      setOutcome({
        queued: rollout.progress.canaryTotal,
        alreadyQueued: 0,
        skipped: devices.length - eligible.length,
        failed: [],
      })
      onIssued()
      onOpenRollouts?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the rollout')
    } finally {
      setBusy(null)
    }
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
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          // Fill in the newest signed bundle on the way in — nine times in ten
          // it is why the panel is being opened, and the feed has usually
          // arrived by now even though it had not at first render. Never
          // overwrites something already typed.
          setVersion((v) => v || rollable[0] || '')
          setOpen(true)
        }}
      >
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
        {total === 1 ? 'terminal' : 'terminals'} matching the current filter — but not all at once.
        The first {canaryPercent}% take it, spread across shops; if any of them report new faults or
        stop checking in, the rollout halts itself and the rest are never sent it. No till is
        interrupted while it is trading.
      </p>

      {error && <Notice>{error}</Notice>}

      <div className="toolbar" style={{ gap: 8 }}>
        <input
          className="input"
          value={version}
          list="rollout-versions"
          placeholder={rollable[0] ?? '1.6.0'}
          aria-label="Version to roll out"
          disabled={busy != null}
          onChange={(e) => setVersion(e.target.value)}
        />
        {/* Every version with a signed bundle on the feed. A version that isn't
            here has nothing to download, so offering the list is the cheapest
            way to stop a rollout that could only ever fail. */}
        <datalist id="rollout-versions">
          {rollable.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <Button size="sm" busy={busy === 'update'} onClick={() => void stage()}>
          Start rollout
        </Button>
        <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      {/* The safety policy, editable but pre-decided. Left alone it is a
          sensible rollout; the fields exist because "everything at once" is
          occasionally the right call and hiding it would invite the old
          workaround of clicking the per-terminal button forty times. */}
      <div className="toolbar" style={{ gap: 12, marginTop: 10 }}>
        <label className="muted small">
          First wave
          <select
            className="input"
            value={canaryPercent}
            aria-label="Canary size"
            onChange={(e) => setCanaryPercent(Number(e.target.value))}
          >
            {[5, 10, 25, 50, 100].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </label>
        <label className="muted small">
          Halt after
          <select
            className="input"
            value={haltErrorDevices}
            aria-label="Bad terminals before halting"
            onChange={(e) => setHaltErrorDevices(Number(e.target.value))}
          >
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n} bad terminal{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
        <label className="muted small">
          Watch for
          <select
            className="input"
            value={observeMinutes}
            aria-label="Observation window"
            onChange={(e) => setObserveMinutes(Number(e.target.value))}
          >
            {[15, 30, 60, 180, 720].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60}h`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Warn, don't block: the feed is read from one box and an operator may
          legitimately know about a version this server cannot see. */}
      {release?.available && rollable.length > 0 && VERSION.test(version.trim()) &&
        !rollable.includes(version.trim()) && (
          <p className="hint" style={{ marginTop: 8 }}>
            No signed bundle for <b className="mono">{version.trim()}</b> is published. Terminals
            will refuse it. Published: {rollable.slice(0, 5).join(', ')}.
          </p>
        )}

      {busy && (
        <p className="hint" style={{ marginTop: 10 }}>
          Queueing… {progress} of {total}
        </p>
      )}

      {outcome && (
        <div style={{ marginTop: 12 }}>
          <p className="hint">
            First wave queued for <b>{outcome.queued}</b>{' '}
            {outcome.queued === 1 ? 'terminal' : 'terminals'}. The rest follow automatically once
            those have run clean for {observeMinutes} minutes — watch it on the Rollouts page.
            {outcome.alreadyQueued > 0 && ` ${outcome.alreadyQueued} already had one waiting.`}
            {outcome.skipped > 0 &&
              ` ${outcome.skipped} skipped — still reporting on the shared enrollment key rather` +
                ` than their own, so the server will not send them actions.`}
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
            Each terminal picks it up on its next heartbeat, within about three minutes.
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
