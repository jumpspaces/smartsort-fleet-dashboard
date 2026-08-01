import { useCallback, useEffect, useState } from 'react'
import type { Api, CommandRow, CommandSpec, DeviceRow } from '../api.ts'
import { Button, Chip, Notice } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

/**
 * Remote actions on one terminal.
 *
 * The console was read-only, so every remedy meant telephoning a shop and
 * talking somebody through it. These four are the ones that actually come up,
 * and they are a fixed set on both ends — the buttons are rendered from the
 * SERVER's allowlist rather than a list typed here, so the UI cannot offer
 * something the terminal would refuse.
 *
 * Delivery is on the terminal's own next heartbeat, so this is honest about
 * latency: a command reads "waiting for the terminal" until it is collected,
 * rather than pretending to be instant and then appearing to hang.
 */
export function DeviceActions({
  api,
  device,
  canAct,
}: {
  api: Api
  device: DeviceRow
  /** Viewers can see the history but not issue anything. */
  canAct: boolean
}) {
  const [catalogue, setCatalogue] = useState<CommandSpec[] | null>(null)
  const [history, setHistory] = useState<CommandRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // Only app.bundle carries anything, and all it carries is a version number.
  const [version, setVersion] = useState('')

  const load = useCallback(async () => {
    const [specs, rows] = await Promise.all([
      api.commandCatalogue(),
      api.deviceCommands(device.deviceId),
    ])
    setCatalogue(specs)
    setHistory(rows)
  }, [api, device.deviceId])

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : 'Could not load actions'),
    )
  }, [load])

  async function issue(name: string) {
    if (name === 'app.bundle' && !/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(version.trim())) {
      setError('Enter a version number like 1.5.2.')
      return
    }
    setBusy(name)
    setError(null)
    try {
      const payload = name === 'app.bundle' ? { version: version.trim() } : undefined
      await api.issueCommand(device.deviceId, name, payload)
      setConfirming(null)
      setVersion('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue that action')
    } finally {
      setBusy(null)
    }
  }

  async function cancel(id: string) {
    setBusy(id)
    try {
      await api.cancelCommand(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel that action')
    } finally {
      setBusy(null)
    }
  }

  const waiting = history.filter((c) => c.state === 'pending' || c.state === 'sent')

  return (
    <>
      {error && <Notice>{error}</Notice>}

      {/* A terminal on the shared enrollment key has not proven who it is, and
          the server will not hand it commands. Saying so beats buttons that
          silently do nothing. */}
      {!device.keyVerified && (
        <p className="hint" style={{ marginBottom: 10 }}>
          This terminal reports on the shared enrollment key, so it cannot be sent actions. It
          will accept them once the shop claims it and it has a key of its own.
        </p>
      )}

      {catalogue == null ? (
        <div className="skeleton" style={{ width: '45%' }} />
      ) : (
        <div className="actions">
          {catalogue.map((spec) => {
            const pending = waiting.some((c) => c.command === spec.name)
            // A restart makes the till unusable for a few seconds, and undoing
            // an update throws away a patch the shop may be relying on. Both
            // deserve a second press, not a tooltip.
            const risky = spec.name === 'server.restart' || spec.name === 'app.revert'
            const isConfirming = confirming === spec.name
            // The one command with a payload. It gets a field rather than a
            // Run button, because "which version?" has no sensible default.
            const needsVersion = spec.name === 'app.bundle'

            return (
              <div key={spec.name} className="action">
                <div className="action-text">
                  <span className="action-label">{spec.label}</span>
                  <span className="action-desc">{spec.description}</span>
                </div>
                {pending ? (
                  <Chip tone="idle">Queued</Chip>
                ) : needsVersion ? (
                  <div className="action-confirm">
                    <input
                      className="input"
                      style={{ width: 96 }}
                      value={version}
                      placeholder="1.5.2"
                      aria-label="Version to install"
                      disabled={!canAct || !device.keyVerified}
                      onChange={(e) => setVersion(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={!canAct || !device.keyVerified}
                      busy={busy === spec.name}
                      title={canAct ? undefined : 'Your role is read-only'}
                      onClick={() => void issue(spec.name)}
                    >
                      Send
                    </Button>
                  </div>
                ) : isConfirming ? (
                  <div className="action-confirm">
                    <Button
                      size="sm"
                      variant="danger"
                      busy={busy === spec.name}
                      onClick={() => void issue(spec.name)}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    disabled={!canAct || !device.keyVerified}
                    busy={busy === spec.name}
                    title={canAct ? undefined : 'Your role is read-only'}
                    onClick={() => (risky ? setConfirming(spec.name) : void issue(spec.name))}
                  >
                    Run
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {history.length > 0 && (
        <ul className="plain-list" style={{ marginTop: 12 }}>
          {history.slice(0, 8).map((c) => (
            <li key={c.id} className="cmd">
              <div className="cmd-main">
                <div className="cmd-head">
                  <span className="strong">{c.command}</span>
                  <Chip tone={stateTone(c.state)}>{stateLabel(c.state)}</Chip>
                </div>
                <div className="muted small">
                  {c.issuedByLabel ?? 'unknown'} ·{' '}
                  <span title={exact(c.issuedAt)}>{timeAgo(c.issuedAt)}</span>
                  {c.completedAt && (
                    <>
                      {' '}
                      · finished <span title={exact(c.completedAt)}>{timeAgo(c.completedAt)}</span>
                    </>
                  )}
                </div>
                {c.error && <div className="bad-text small">{c.error}</div>}
                {c.result && <pre className="stack">{c.result}</pre>}
              </div>
              {c.state === 'pending' && canAct && (
                <Button size="sm" variant="ghost" busy={busy === c.id} onClick={() => void cancel(c.id)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function stateLabel(state: CommandRow['state']): string {
  switch (state) {
    case 'pending':
      return 'Waiting for the terminal'
    case 'sent':
      return 'Running'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'expired':
      return 'Expired'
  }
}

function stateTone(state: CommandRow['state']) {
  switch (state) {
    case 'done':
      return 'ok' as const
    case 'failed':
      return 'bad' as const
    case 'expired':
      return 'idle' as const
    default:
      return 'warn' as const
  }
}
