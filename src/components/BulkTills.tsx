import { useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { Device, DeviceQuery } from '../api/types.ts'
import { useCommandCatalogue } from '../data.ts'
import { supportedCommands } from '../lib/commands.ts'
import { plural } from '../lib/format.ts'
import { tillName } from '../lib/plain.ts'
import { pool } from '../lib/pool.ts'
import { invalidate } from '../lib/query.ts'
import { useSession } from '../lib/session.tsx'
import { ActionError, Dialog, Field } from './forms.tsx'

/**
 * Do one safe thing to every till the current filter matches — all pages, not
 * just the one on screen. The filter IS the selection: checkboxes across pages
 * would let someone act on rows they never saw.
 *
 * Only harmless fixes are offered. Restarting forty shops' tills from one
 * button is an outage, so that stays on a single till's page — as does
 * anything the server calls destructive, which it refuses in bulk anyway by
 * asking for a password per till.
 *
 * A message is the one screen change that makes sense fleet-wide ("we're
 * updating every till tonight"), so it is here; a lock is not.
 */
const SAFE_COMMANDS = ['sync.now', 'report.now', 'backup.now', 'pull.retry', 'notice.clear']

type Action =
  | { kind: 'command'; name: string }
  | { kind: 'notice' }
  | { kind: 'silence' }
  | { kind: 'label' }

const NOTICE_HOURS = [1, 4, 8, 24, 48, 72, 168]

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 24 * 60 },
  { label: '3 days', minutes: 3 * 24 * 60 },
]

export function BulkTills({ query, total }: { query: DeviceQuery; total: number }) {
  const { client, canAct } = useSession()
  const catalogue = useCommandCatalogue()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<string>('')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(240)
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')
  const [tone, setTone] = useState<'info' | 'warn'>('info')
  const [hours, setHours] = useState(24)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [result, setResult] = useState<{ ok: number; skipped: number; failed: { item: Device; error: string }[] } | null>(null)
  const [error, setError] = useState<Error | null>(null)

  if (!canAct) return null
  const specs = catalogue.data ?? []
  const commands = specs.filter((c) => SAFE_COMMANDS.includes(c.name))
  const parsed: Action | null = action.startsWith('cmd:')
    ? { kind: 'command', name: action.slice(4) }
    : action === 'notice'
      ? { kind: 'notice' }
      : action === 'silence'
        ? { kind: 'silence' }
        : action === 'label'
          ? { kind: 'label' }
          : null
  const commandName = parsed?.kind === 'command' ? parsed.name : parsed?.kind === 'notice' ? 'notice.show' : null

  async function run() {
    if (!parsed) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const all = await api.allDevices(client, query)
      // Commands only reach tills that proved who they are, and only ones
      // whose app knows the command — the server would refuse the rest.
      const targets = commandName
        ? all.filter((d) => d.keyVerified && !d.removedAt && supportedCommands(d, specs).has(commandName))
        : all
      setProgress({ done: 0, of: targets.length })
      const r = await pool(
        targets,
        5,
        (d) => {
          if (parsed.kind === 'command') return api.issueCommand(client, d.deviceId, parsed.name)
          if (parsed.kind === 'notice') {
            return api.issueCommand(client, d.deviceId, 'notice.show', { payload: { text: text.trim(), tone, hours } })
          }
          if (parsed.kind === 'silence') return api.openMute(client, { scope: 'device', deviceId: d.deviceId, minutes, reason: reason.trim() })
          return api.addTag(client, d.deviceId, label.trim().toLowerCase())
        },
        (done) => setProgress({ done, of: targets.length }),
      )
      setResult({ ok: r.ok.length, skipped: all.length - targets.length, failed: r.failed })
      invalidate('device')
      invalidate('commands')
      invalidate('mutes')
      invalidate('tags')
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    setOpen(false)
    setResult(null)
    setProgress(null)
    setError(null)
  }
  const ready =
    parsed &&
    (parsed.kind !== 'silence' || reason.trim()) &&
    (parsed.kind !== 'label' || label.trim()) &&
    (parsed.kind !== 'notice' || text.trim())

  return (
    <>
      <button className="btn sm" disabled={total === 0} onClick={() => setOpen(true)}>
        Act on {plural(total, 'till')}
      </button>
      <Dialog open={open} onClose={close} title={`Act on all ${plural(total, 'matching till')}`}>
        <div className="form">
          <div className="small sub">Applies to every till the current filter matches, across all pages.</div>
          <Field label="What to do" id="ba">
            <select id="ba" className="select" value={action} disabled={busy} onChange={(e) => setAction(e.target.value)}>
              <option value="">Choose…</option>
              <optgroup label="Remote fixes">
                {commands.map((c) => (
                  <option key={c.name} value={`cmd:${c.name}`}>
                    {c.label}
                  </option>
                ))}
                {specs.some((c) => c.name === 'notice.show') && <option value="notice">Show a message</option>}
              </optgroup>
              <optgroup label="Console">
                <option value="silence">Silence alerts</option>
                <option value="label">Add a label</option>
              </optgroup>
            </select>
          </Field>
          {parsed?.kind === 'command' && (
            <div className="hint">
              {commands.find((c) => c.name === parsed.name)?.description} Tills not yet linked to their shop, or on an app too old for it, are
              skipped.
            </div>
          )}
          {parsed?.kind === 'notice' && (
            <>
              <Field label="Message" id="bn" hint={`Plain text, shown in a corner of every screen. ${280 - text.length} characters left.`}>
                <textarea
                  id="bn"
                  className="textarea"
                  rows={2}
                  maxLength={280}
                  value={text}
                  onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
                  placeholder="e.g. We're updating every till after closing tonight — please leave them switched on."
                />
              </Field>
              <div className="form-grid">
                <Field label="Tone" id="bt">
                  <select id="bt" className="select" value={tone} onChange={(e) => setTone(e.target.value as 'info' | 'warn')}>
                    <option value="info">Note</option>
                    <option value="warn">Warning</option>
                  </select>
                </Field>
                <Field label="For" id="bh">
                  <select id="bh" className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                    {NOTICE_HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h < 24 ? plural(h, 'hour') : plural(h / 24, 'day')}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="hint">Replaces any message already waiting for a till. Tills on an app too old for messages are skipped.</div>
            </>
          )}
          {parsed?.kind === 'silence' && (
            <div className="form-grid">
              <Field label="How long" id="bm">
                <select id="bm" className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {DURATIONS.map((d) => (
                    <option key={d.minutes} value={d.minutes}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Why" id="br">
                <input id="br" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          )}
          {parsed?.kind === 'label' && (
            <Field label="Label" id="bl">
              <input id="bl" className="input" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. pilot" />
            </Field>
          )}
          {progress && busy && (
            <div className="small sub">
              Working… {progress.done} of {progress.of}
            </div>
          )}
          <ActionError error={error} />
          {result && (
            <div className={`notice ${result.failed.length ? 'warn' : 'info'}`} style={{ display: 'block' }}>
              Done for {plural(result.ok, 'till')}.
              {result.skipped > 0 && ` Skipped ${result.skipped} not linked to their shop or on an app too old for it.`}
              {result.failed.length > 0 && (
                <>
                  {' '}
                  {result.failed.length} failed:
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {result.failed.slice(0, 10).map((f) => (
                      <li key={f.item.deviceId}>
                        {tillName(f.item)} — {f.error}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy} onClick={close}>
              {result ? 'Done' : 'Cancel'}
            </button>
            {!result && (
              <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void run()}>
                {busy ? 'Working…' : 'Go'}
              </button>
            )}
          </div>
        </div>
      </Dialog>
    </>
  )
}
