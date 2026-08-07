import { useState } from 'react'
import type { Api } from '../api.ts'
import { Button, Notice } from '../components/ui.tsx'

/**
 * Ignore or resolve every OPEN fault matching the current search at once.
 *
 * Same shape as Rollout.tsx: the filter IS the selection, expanded page by
 * page rather than acting on only what happens to be on screen — a fleet with
 * more than PAGE_SIZE open faults must not have this silently act on the
 * first page and call it "all matching".
 */

const PAGE = 100
const CONCURRENCY = 5

interface Outcome {
  done: number
  failed: number
}

export function BulkErrorActions({
  api,
  q,
  total,
  canAct,
  onDone,
}: {
  api: Api
  /** The Errors view's current search text — the selection, alongside status=open. */
  q: string | undefined
  /** How many open groups match it, for the confirmation line. */
  total: number
  canAct: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState<null | 'resolve' | 'ignore'>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  if (!canAct || total === 0) return null

  async function allOpenMatching() {
    const out = []
    for (let offset = 0; ; offset += PAGE) {
      const page = await api.errorGroups({ status: 'open', q, limit: PAGE, offset })
      out.push(...page.groups)
      if (out.length >= page.total || page.groups.length === 0) break
    }
    return out
  }

  async function run(status: 'resolved' | 'ignored') {
    setError(null)
    setOutcome(null)
    setBusy(status === 'resolved' ? 'resolve' : 'ignore')
    setProgress(0)
    try {
      const groups = await allOpenMatching()
      const result: Outcome = { done: 0, failed: 0 }
      for (let i = 0; i < groups.length; i += CONCURRENCY) {
        await Promise.all(
          groups.slice(i, i + CONCURRENCY).map(async (g) => {
            try {
              await api.setGroupStatus(
                g.fingerprint,
                status,
                status === 'resolved' ? version.trim() || null : null,
              )
              result.done++
            } catch {
              result.failed++
            }
          }),
        )
        setProgress(Math.min(i + CONCURRENCY, groups.length))
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
        Bulk actions…
      </Button>
    )
  }

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <div className="cmd-head" style={{ marginBottom: 6 }}>
        <span className="strong">Act on every open fault matching the current search</span>
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Applies to all <b>{total}</b> open {total === 1 ? 'fault' : 'faults'} matching the search
        above — not just what is on this page.
      </p>

      {error && <Notice>{error}</Notice>}

      <div className="toolbar" style={{ gap: 8 }}>
        <input
          className="input"
          value={version}
          placeholder="Fixed in version (optional)"
          aria-label="Fixed in version"
          disabled={busy != null}
          onChange={(e) => setVersion(e.target.value)}
          style={{ maxWidth: 200 }}
        />
        <Button size="sm" variant="primary" busy={busy === 'resolve'} onClick={() => void run('resolved')}>
          Resolve all matching
        </Button>
        <Button size="sm" variant="danger" busy={busy === 'ignore'} onClick={() => void run('ignored')}>
          Ignore all matching
        </Button>
        <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      {busy && (
        <p className="hint" style={{ marginTop: 10 }}>
          Working… {progress} of {total}
        </p>
      )}

      {outcome && (
        <p className="hint" style={{ marginTop: 10 }}>
          Done for <b>{outcome.done}</b> {outcome.done === 1 ? 'fault' : 'faults'}.
          {outcome.failed > 0 && ` ${outcome.failed} failed.`}
        </p>
      )}
    </div>
  )
}
