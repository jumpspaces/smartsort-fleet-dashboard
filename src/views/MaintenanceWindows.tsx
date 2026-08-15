/**
 * Every silence currently in force, in one list.
 *
 * A mute is opened from the terminal it covers, which is the right place to do
 * it and the wrong place to audit it: nobody finds a forgotten fleet-wide
 * window by opening terminals one at a time. This is the register — what is
 * quiet, why, until when, and who decided.
 *
 * It also carries the fleet-wide switch, which belongs here and nowhere else:
 * silencing everything is a deliberate act taken during an incident somebody
 * already knows about, not something to put a button for on a device page.
 */
import { useCallback, useEffect, useState } from 'react'
import { Forbidden, type Api, type MuteRow } from '../api.ts'
import { Button, Card, Chip, Notice } from '../components/ui.tsx'
import { exact, timeAgo, timeUntil } from '../lib/format.ts'

export function MaintenanceWindows({ api }: { api: Api }) {
  const [rows, setRows] = useState<MuteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(60)
  const canAct = api.operator.role !== 'viewer'

  const load = useCallback(async () => {
    try {
      setRows(await api.mutes())
      setError(null)
    } catch (err) {
      if (err instanceof Forbidden) return setForbidden(true)
      setError(err instanceof Error ? err.message : 'Could not load maintenance windows')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) return null

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  const fleetWide = rows?.find((m) => m.scope === 'fleet')

  return (
    <Card title={rows?.length ? `Silenced (${rows.length})` : 'Silenced'}>
      {error && <Notice>{error}</Notice>}

      {rows?.length === 0 && (
        <p className="muted small">
          Nothing is silenced. Windows are opened from a terminal's own page, or fleet-wide below
          during an incident everybody already knows about.
        </p>
      )}

      {rows?.map((m) => (
        <div key={m.id} className="note-item">
          <div className="cell-stack">
            <Chip tone={m.scope === 'fleet' ? 'bad' : 'idle'}>
              {m.scope === 'fleet' ? 'Whole fleet' : m.scope === 'shop' ? 'Shop' : 'Terminal'}
            </Chip>
            <span className="strong">
              {m.shopName ?? (m.deviceId ? m.deviceId.slice(0, 12) : 'Everything')}
            </span>
          </div>
          <div className="note-body">{m.reason}</div>
          <div className="note-meta">
            <span title={exact(m.endsAt)}>Lifts {timeUntil(m.endsAt)}</span>
            <span title={exact(m.startsAt)}>opened {timeAgo(m.startsAt)}</span>
            <span>{m.createdByLabel ?? 'unknown'}</span>
            {canAct && (
              <Button
                size="sm"
                variant="ghost"
                busy={busy === m.id}
                onClick={() => void run(m.id, () => api.cancelMute(m.id))}
              >
                Lift now
              </Button>
            )}
          </div>
        </div>
      ))}

      {canAct && !fleetWide && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <p className="hint" style={{ marginBottom: 8 }}>
            Silence the whole fleet — for an incident you already know about, where one page per
            terminal is a hundred pages about one thing.
          </p>
          <div className="toolbar" style={{ gap: 8 }}>
            <input
              className="input"
              value={reason}
              placeholder="Why — cloud migration, upstream outage…"
              aria-label="Reason"
              onChange={(e) => setReason(e.target.value)}
            />
            <select
              className="input"
              value={minutes}
              aria-label="How long"
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
              <option value={720}>12 hours</option>
            </select>
            <Button
              size="sm"
              variant="danger"
              busy={busy === 'fleet'}
              disabled={!reason.trim()}
              onClick={() =>
                void run('fleet', async () => {
                  await api.openMute({ scope: 'fleet', reason: reason.trim(), minutes })
                  setReason('')
                })
              }
            >
              Silence everything
            </Button>
          </div>
        </div>
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        Silencing holds pages; it changes nothing else. Terminals still report their real state,
        still fail their availability, and anything still wrong when a window closes pages then.
      </p>
    </Card>
  )
}
