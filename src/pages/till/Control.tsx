import { useEffect, useState } from 'react'
import * as api from '../../api/endpoints.ts'
import { LOCK_REASONS } from '../../api/types.ts'
import type { Command, CommandSpec, Device, DeviceSettingsView, IssueOptions, LockReason, SettingSource, StuckRow } from '../../api/types.ts'
import { ConfirmButton, Field } from '../../components/forms.tsx'
import { StepUpDialog } from '../../components/StepUpDialog.tsx'
import { belowOf, ConfigEditor, MessageEditor } from '../../components/TillLevelEditor.tsx'
import { Card, ErrorNote, Loadable, Segmented, When } from '../../components/ui.tsx'
import { useCommandCatalogue, useDeviceCommands, useDeviceSettings } from '../../data.ts'
import {
  COMMAND_STATE,
  holdLine,
  isOpen,
  liveState,
  LOCK_REASON_LABEL,
  outcomeLine,
  parseDbCheck,
  parseStuckRows,
  supportedCommands,
  timingFields,
  toLocalInput,
  type Timing,
} from '../../lib/commands.ts'
import { ago, count, exact, plural, until } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { href } from '../../lib/router.ts'
import { useSession } from '../../lib/session.tsx'

/**
 * A till's remote control: what the console can make it do, and what it has
 * been made to do. Everything here rides the till's own heartbeat (see
 * server/src/services/fleet-commands.service.ts), so the page also keeps the
 * till in LIVE mode while it is open — checking in every few seconds — which
 * is what makes these feel like controls rather than requests.
 */

/* ------------------------------------------------------------------ live --- */

/** Hold this till in live mode for as long as its page is open and visible. */
export function useLiveLease(d: Device) {
  const { client } = useSession()
  // Commands only reach a till on its own key, so that is when live is worth it.
  const eligible = d.keyVerified && !d.removedAt
  useEffect(() => {
    if (!eligible) return
    let stopped = false
    const renew = () => {
      if (stopped || document.visibilityState !== 'visible') return
      void api
        .goLive(client, d.deviceId)
        .then(() => invalidate(`device:${d.deviceId}`))
        .catch(() => undefined) // The line below says whether it took.
    }
    renew()
    // The lease is five minutes; renew well inside it.
    const timer = window.setInterval(renew, 120_000)
    document.addEventListener('visibilitychange', renew)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', renew)
    }
  }, [client, d.deviceId, eligible])
}

function LiveLine({ d }: { d: Device }) {
  const state = liveState(d)
  // Dot and words as one inline run, so a long line wraps under its words
  // rather than leaving the dot alone on a line of its own.
  const dot = (tone: 'healthy' | 'attention') => (
    <span className={`dot ${tone}`} style={{ marginRight: 6, verticalAlign: 'middle' }} aria-hidden="true" />
  )
  if (state === 'live') {
    return (
      <div className="small">
        {dot('healthy')}Live — the till is checking in every few seconds while this page is open.
      </div>
    )
  }
  if (state === 'connecting') {
    const due = Date.parse(d.lastReportAt) + 3 * 60_000
    return (
      <div className="small sub">
        {dot('attention')}Going live at the till's next check-in
        {due > Date.now() ? `, due ${until(new Date(due).toISOString())}` : ' — it is late, so it may be off'}.
      </div>
    )
  }
  return <div className="small sub">Commands reach the till the next time it checks in, within about 3 minutes.</div>
}

/* ----------------------------------------------------------- shared hook --- */

function useTillCommands(d: Device) {
  const { client, canAct } = useSession()
  const catalogue = useCommandCatalogue()
  const history = useDeviceCommands(d.deviceId, liveState(d) === 'off' ? 15_000 : 5_000)
  const settings = useDeviceSettings(d.deviceId, liveState(d) === 'off' ? 15_000 : 5_000)
  const specs = catalogue.data ?? []
  const supported = supportedCommands(d, specs)
  const commands = history.data ?? []
  const outstanding = new Set(commands.filter(isOpen).map((c) => c.command))
  const spec = (name: string) => specs.find((s) => s.name === name)
  const label = (name: string) => spec(name)?.label ?? name
  const refresh = () => {
    invalidate(`commands:${d.deviceId}`)
    invalidate(`device:${d.deviceId}`)
    invalidate(`settings:${d.deviceId}`)
  }
  const send = useAction(async (name: string, opts?: IssueOptions) => {
    await api.issueCommand(client, d.deviceId, name, opts)
    refresh()
  })
  // A till on the shared enrollment key never gets commands — its identity is
  // only claimed, not proven — so nothing here is offered to it.
  const blocked = !d.keyVerified
  const can = (name: string) => canAct && !blocked && supported.has(name)
  return { catalogue, history, settings, specs, supported, commands, outstanding, spec, label, send, refresh, can, blocked, canAct }
}

type TillCommands = ReturnType<typeof useTillCommands>

/** The latest finished run of a command, for showing its result. */
const latestDone = (commands: Command[], name: string) => commands.find((c) => c.command === name && c.state === 'done')

/* -------------------------------------------------------- remote fixes ---- */

/** Commands set from elsewhere: a version is chosen on the Updates page. */
const ELSEWHERE = new Set(['app.bundle', 'app.revert'])
/** No payload, nothing to lose: one press. */
const QUICK = ['sync.now', 'report.now', 'backup.now', 'logs.collect', 'pull.retry']
/** Interrupt or slow the till: can be timed. */
const MAINTENANCE = ['server.restart', 'db.check', 'disk.cleanup']

function TimingPicker({ timing, onChange }: { timing: Timing; onChange: (t: Timing) => void }) {
  const tonight = () => {
    const d = new Date()
    d.setHours(21, 0, 0, 0)
    if (d.getTime() < Date.now() + 5 * 60_000) d.setTime(Date.now() + 60 * 60_000)
    return toLocalInput(d)
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Segmented
        label="When"
        value={timing.kind}
        options={[
          { value: 'now', label: 'Now' },
          { value: 'quiet', label: 'When quiet' },
          { value: 'at', label: 'At a time' },
        ]}
        onChange={(kind) => onChange(kind === 'at' ? { kind, at: timing.kind === 'at' ? timing.at : tonight() } : { kind })}
      />
      {timing.kind === 'quiet' && (
        <div className="hint">Held until the shop has gone 10 minutes without a sale — on any of its tills — then sent.</div>
      )}
      {timing.kind === 'at' && (
        <input
          type="datetime-local"
          className="input"
          aria-label="Send at"
          value={timing.at}
          min={toLocalInput(new Date())}
          onChange={(e) => onChange({ kind: 'at', at: e.target.value })}
        />
      )}
    </div>
  )
}

/** Long output (a log tail, a table) opens on demand instead of filling the card. */
function Output({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn sm ghost" onClick={() => setOpen(!open)}>
        {open ? 'Hide output' : 'Show output'}
      </button>
      {open && <pre className="stack">{text}</pre>}
    </>
  )
}

function CommandRow({ c, t }: { c: Command; t: TillCommands }) {
  const { client, canAct, session } = useSession()
  const [approving, setApproving] = useState(false)
  const cancel = useAction(async () => {
    await api.cancelCommand(client, c.id)
    t.refresh()
  })
  const line = outcomeLine(c)
  const hold = holdLine(c)
  const structured = c.command === 'pull.inspect' || c.command === 'db.check'
  const long = !structured && !!c.result && c.result.length > 140
  const mine = c.issuedBy === session.operator.id
  return (
    <li>
      <div className="spread">
        <span style={{ fontWeight: 550 }}>{t.label(c.command)}</span>
        <span className="small muted">
          <When iso={c.issuedAt} />
        </span>
      </div>
      <div className="spread small">
        <span className={c.state === 'failed' ? '' : 'sub'} style={c.state === 'failed' ? { color: 'var(--bad)' } : undefined}>
          {COMMAND_STATE[c.state]}
          {line && !long ? ` — ${line}` : ''}
        </span>
        {canAct && (c.state === 'pending' || c.state === 'awaiting_approval') && (
          <span className="row" style={{ gap: 2 }}>
            {c.state === 'awaiting_approval' && !mine && (
              <button className="btn sm primary" onClick={() => setApproving(true)}>
                Approve
              </button>
            )}
            <button className="btn sm ghost" disabled={cancel.pending} onClick={() => void cancel.run()}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {hold && <div className="small sub">{hold}</div>}
      {c.state === 'awaiting_approval' && mine && (
        <div className="small sub">Another operator has to approve this before it is sent.</div>
      )}
      {long && <Output text={c.result!} />}
      {c.command === 'db.check' && <DbCheckDetail result={c.result} />}
      <div className="small muted">
        {c.issuedByLabel && `by ${c.issuedByLabel}`}
        {c.approvedByLabel && ` · approved by ${c.approvedByLabel}`}
      </div>
      {cancel.error && <ErrorNote error={cancel.error} />}
      <StepUpDialog
        open={approving}
        title={`Approve “${t.label(c.command)}”?`}
        confirm="Approve and send"
        danger
        onClose={() => setApproving(false)}
        onConfirm={async (pw) => {
          await api.approveCommand(client, c.id, pw)
          t.refresh()
        }}
      >
        <p>
          {c.issuedByLabel ?? 'Another operator'} asked for this <When iso={c.issuedAt} />. It goes to the till as soon as you
          approve it.
        </p>
        {c.payload && Object.keys(c.payload).length > 0 && <pre className="stack">{JSON.stringify(c.payload, null, 2)}</pre>}
      </StepUpDialog>
    </li>
  )
}

function DbCheckDetail({ result }: { result: string | null }) {
  const check = parseDbCheck(result)
  if (!check) return null
  const bad = check.tables.filter((x) => x.error)
  if (bad.length === 0) return null
  return (
    <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
      {bad.map((x) => (
        <li key={x.table} style={{ padding: 0, border: 0 }}>
          <span className="mono">{x.table}</span> — {x.error}
        </li>
      ))}
    </ul>
  )
}

export function RemoteFixes({ d }: { d: Device }) {
  const t = useTillCommands(d)
  const [timing, setTiming] = useState<Timing>({ kind: 'now' })
  const [keepBackups, setKeepBackups] = useState(3)

  const issue = (s: CommandSpec) => {
    const payload = s.name === 'disk.cleanup' ? { keepBackups } : undefined
    void t.send.run(s.name, { payload, ...(s.quietable || timing.kind !== 'quiet' ? timingFields(timing) : {}) })
  }
  const timedOk = (s: CommandSpec) => !(timing.kind === 'quiet' && !s.quietable)
  const badAt = timing.kind === 'at' && !(Date.parse(timing.at) > Date.now())

  return (
    <Card title="Remote fixes" sub={<LiveLine d={d} />}>
      <div className="stack" style={{ gap: 14 }}>
        {t.blocked ? (
          <div className="notice info">Remote fixes become available once this till is linked to its shop.</div>
        ) : !t.canAct ? (
          <div className="notice info">Your account can view tills but not send fixes.</div>
        ) : (
          <Loadable q={t.catalogue} rows={2}>
            {(specs) => {
              const pick = (names: string[]) =>
                names.map((n) => specs.find((s) => s.name === n)).filter((s): s is CommandSpec => !!s && t.supported.has(s.name))
              const others = specs.filter(
                (s) =>
                  !ELSEWHERE.has(s.name) &&
                  !QUICK.includes(s.name) &&
                  !MAINTENANCE.includes(s.name) &&
                  s.risk !== 'destructive' &&
                  !s.name.startsWith('notice.') &&
                  !s.name.startsWith('till.') &&
                  s.name !== 'config.set' &&
                  s.name !== 'pull.inspect' &&
                  t.supported.has(s.name),
              )
              const quick = [...pick(QUICK), ...others]
              const maintenance = pick(MAINTENANCE)
              const unsupported = specs.filter((s) => !t.supported.has(s.name) && !ELSEWHERE.has(s.name)).length
              return (
                <>
                  <div className="row">
                    {quick.map((s) => (
                      <button
                        key={s.name}
                        className="btn sm"
                        title={s.description}
                        disabled={t.send.pending || t.outstanding.has(s.name)}
                        onClick={() => void t.send.run(s.name)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {maintenance.length > 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <div className="small" style={{ fontWeight: 550 }}>
                        Maintenance
                      </div>
                      <TimingPicker timing={timing} onChange={setTiming} />
                      <div className="row">
                        {maintenance.map((s) =>
                          s.name === 'server.restart' ? (
                            <ConfirmButton
                              key={s.name}
                              confirm={timing.kind === 'now' ? 'Restart now' : 'Book the restart'}
                              disabled={t.send.pending || t.outstanding.has(s.name) || !timedOk(s) || badAt}
                              onConfirm={() => issue(s)}
                            >
                              {s.label}
                            </ConfirmButton>
                          ) : (
                            <button
                              key={s.name}
                              className="btn sm"
                              title={timedOk(s) ? s.description : `${s.label} doesn't interrupt sales, so it can't wait for a quiet till.`}
                              disabled={t.send.pending || t.outstanding.has(s.name) || !timedOk(s) || badAt}
                              onClick={() => issue(s)}
                            >
                              {s.label}
                            </button>
                          ),
                        )}
                        {t.supported.has('disk.cleanup') && (
                          <select
                            className="select"
                            aria-label="Backups to keep"
                            value={keepBackups}
                            onChange={(e) => setKeepBackups(Number(e.target.value))}
                          >
                            {[2, 3, 4, 5, 7].map((n) => (
                              <option key={n} value={n}>
                                Keep {n} backups
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {badAt && <div className="hint">Pick a time in the future.</div>}
                    </div>
                  )}
                  {unsupported > 0 && (
                    <div className="small sub">
                      {plural(unsupported, 'newer control')} need a newer app on this till
                      {d.appVersion ? ` (it runs ${d.appVersion})` : ''}.
                    </div>
                  )}
                </>
              )
            }}
          </Loadable>
        )}
        {t.send.error && <ErrorNote error={t.send.error} />}
        {t.commands.length > 0 && (
          <ul className="list" style={{ margin: '0 -16px -16px', borderTop: '1px solid var(--line)' }}>
            {t.commands.slice(0, 8).map((c) => (
              <CommandRow key={c.id} c={c} t={t} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------- the till screen -- */

/**
 * Whether the till has taken up what the console keeps for it. Kept settings
 * have no expiry, so "not yet" only ever means "at its next check-in".
 */
function OnTillLine({ d, view }: { d: Device; view: DeviceSettingsView | undefined }) {
  if (!view || view.onTill === null) return null
  if (view.onTill) return <div className="small sub">The till has these — it took them up when it last checked in, <When iso={d.lastReportAt} />.</div>
  const due = Date.parse(d.lastReportAt) + 3 * 60_000
  return (
    <div className="small sub">
      Saved. The till takes them up at its next check-in
      {due > Date.now() ? `, due ${until(new Date(due).toISOString())}` : ' — it is late, so it may be off; it will the moment it is back'}.
    </div>
  )
}

const FROM_WORDS: Record<SettingSource, string> = { device: 'this till', shop: 'its whole shop', fleet: 'every till' }

export function TillScreen({ d }: { d: Device }) {
  const { client } = useSession()
  const t = useTillCommands(d)
  const view = t.settings.data
  // What the console keeps; before that loads, what the till says it has.
  const lock = view ? view.effective.lock : (d.controlState?.lock ?? null)
  const inherited = view?.effective.notice && view.effective.notice.from !== 'device' ? view.effective.notice : null
  const own = view ? view.layers.device.notice : d.controlState?.notice ? { ...d.controlState.notice, since: '', by: null } : null
  const [reason, setReason] = useState<LockReason>('support_hold')
  const [lockMessage, setLockMessage] = useState('')
  const [lockQuiet, setLockQuiet] = useState(true)
  const [locking, setLocking] = useState(false)

  if (!t.can('notice.show') && !t.can('till.lock') && !lock && !own && !inherited) {
    if (t.blocked || !t.canAct) return null
    return (
      <Card title="Till screen">
        <div className="small sub">Putting a message on this till, or locking it, needs a newer app on it.</div>
      </Card>
    )
  }

  const lockWaiting = t.commands.find((c) => c.command === 'till.lock' && isOpen(c))

  return (
    <Card title="Till screen" sub="What the shop sees on this till, from here. Kept until changed — a till that is off takes it up when it is back.">
      <div className="stack" style={{ gap: 14 }}>
        {lock ? (
          <div className="notice warn">
            <span style={{ flex: 1 }}>
              <strong>Locked</strong> {ago(lock.since)} — {LOCK_REASON_LABEL[lock.reason].label}.
              {lock.message && ` “${lock.message}”`}
            </span>
            {t.can('till.unlock') && (
              <ConfirmButton confirm="Unlock" disabled={t.send.pending || t.outstanding.has('till.unlock')} onConfirm={() => void t.send.run('till.unlock')}>
                Unlock
              </ConfirmButton>
            )}
          </div>
        ) : lockWaiting ? (
          <div className="notice info">A lock is on its way — {COMMAND_STATE[lockWaiting.state].toLowerCase()}.</div>
        ) : null}

        {inherited && (
          <div className={`notice ${inherited.tone === 'warn' ? 'warn' : 'info'}`}>
            <span style={{ flex: 1 }}>
              Showing the message for {FROM_WORDS[inherited.from]}, until {until(inherited.until)}: “{inherited.text}”.{' '}
              <a href={inherited.from === 'shop' && d.shopId ? href(`/shops/${encodeURIComponent(d.shopId)}`, { tab: 'tills' }) : href('/settings', { tab: 'tills' })}>
                Change it there
              </a>
              , or give this till its own below.
            </span>
          </div>
        )}

        {(t.can('notice.show') || own) && (
          <MessageEditor
            id="till-message"
            current={own}
            canAct={t.can('notice.show')}
            placeholder="e.g. We're updating this till after closing tonight — please leave it switched on."
            hint="Shown as plain text in a corner of every screen; staff can tuck it away."
            submitLabel="Show on till"
            onShow={async (n) => {
              await api.issueCommand(client, d.deviceId, 'notice.show', { payload: { ...n } })
              t.refresh()
            }}
            onClear={async () => {
              await api.issueCommand(client, d.deviceId, 'notice.clear')
              t.refresh()
            }}
          />
        )}

        {t.can('till.lock') && !lock && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="small" style={{ fontWeight: 550 }}>
              Lock this till
            </div>
            <div className="row">
              <select className="select" aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value as LockReason)}>
                {LOCK_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {LOCK_REASON_LABEL[r].label}
                  </option>
                ))}
              </select>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={lockQuiet} onChange={(e) => setLockQuiet(e.target.checked)} />
                Wait for a quiet moment
              </label>
              <button className="btn sm danger" disabled={t.send.pending || t.outstanding.has('till.lock')} onClick={() => setLocking(true)} style={{ marginLeft: 'auto' }}>
                Lock…
              </button>
            </div>
            <div className="hint">
              {LOCK_REASON_LABEL[reason].hint} The till's server keeps running and syncing; only its screen is covered. The lock is kept in the
              cloud, so a till that is switched off locks the moment it next checks in — however long that is.
            </div>
          </div>
        )}

        <OnTillLine d={d} view={view} />
        {t.send.error && <ErrorNote error={t.send.error} />}
      </div>

      <StepUpDialog
        open={locking}
        title="Lock this till?"
        confirm="Lock the till"
        danger
        onClose={() => setLocking(false)}
        onConfirm={async (pw) => {
          await api.issueCommand(client, d.deviceId, 'till.lock', {
            payload: { reason, message: lockMessage.trim() || null },
            whenQuiet: lockQuiet,
            password: pw,
          })
          setLockMessage('')
          t.refresh()
        }}
      >
        <p>
          Nobody can sell on it until it is unlocked from here.
          {lockQuiet ? ' It waits until the shop has gone 10 minutes without a sale.' : ' Anything on its screen now is lost.'}
        </p>
        <Field label="Message on the lock screen (optional)" id="lock-message" hint="Plain text, up to 200 characters — a number to call, say.">
          <input
            id="lock-message"
            className="input"
            maxLength={200}
            value={lockMessage}
            onChange={(e) => setLockMessage(e.target.value)}
          />
        </Field>
      </StepUpDialog>
    </Card>
  )
}

/* ------------------------------------------------------------ stuck rows --- */

export function StuckRows({ d }: { d: Device }) {
  const { client } = useSession()
  const t = useTillCommands(d)
  const [discarding, setDiscarding] = useState<StuckRow | null>(null)
  const latest = latestDone(t.commands, 'pull.inspect')
  const rows = parseStuckRows(latest?.result)
  const stuck = (d.pullQuarantined ?? 0) + (d.syncFailed ?? 0)

  if (!t.can('pull.inspect') && stuck === 0) return null

  return (
    <Card
      title="Stuck rows"
      sub={
        stuck === 0
          ? 'Nothing stuck at the last check-in.'
          : `${plural(d.pullQuarantined ?? 0, 'received row')} not applied · ${plural(d.syncFailed ?? 0, 'row')} not sent`
      }
      actions={
        t.can('pull.inspect') ? (
          <button className="btn sm" disabled={t.send.pending || t.outstanding.has('pull.inspect')} onClick={() => void t.send.run('pull.inspect')}>
            {t.outstanding.has('pull.inspect') ? 'Asking…' : latest ? 'List again' : 'List them'}
          </button>
        ) : undefined
      }
      flush={!!rows}
    >
      {!rows ? (
        <div className="small sub">
          {t.can('pull.inspect')
            ? 'Ask the till which rows it is holding and why. It answers with the reason for each.'
            : 'Listing them needs a newer app on this till.'}
        </div>
      ) : rows.receivedTotal === 0 && rows.sendingTotal === 0 ? (
        <div className="card-body small sub">Nothing stuck when the till last listed them, <When iso={latest!.completedAt} />.</div>
      ) : (
        <>
          {rows.received.length > 0 && (
            <>
              <div className="card-body small" style={{ paddingBottom: 0, fontWeight: 550 }}>
                Received from the shop's other tills, not applied here
              </div>
              <ul className="list">
                {rows.received.map((r) => (
                  <li key={r.ref}>
                    <div className="spread">
                      <span>
                        <span className="mono">{r.table}</span> <span className="small muted">#{r.rowRef}</span>
                      </span>
                      <span className="small muted">
                        {plural(r.attempts, 'try', 'tries')} · since {ago(r.since)}
                      </span>
                    </div>
                    <div className="spread small">
                      <span className="sub" style={{ overflowWrap: 'anywhere' }}>
                        {r.error ?? 'No reason recorded.'}
                      </span>
                      {t.can('pull.skip') && (
                        <button className="btn sm ghost" disabled={t.outstanding.has('pull.skip')} onClick={() => setDiscarding(r)}>
                          Discard…
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {rows.sending.length > 0 && (
            <>
              <div className="card-body small" style={{ paddingBottom: 0, fontWeight: 550 }}>
                Written here, refused by the cloud
              </div>
              <ul className="list">
                {rows.sending.map((r) => (
                  <li key={r.ref}>
                    <div className="spread">
                      <span className="mono">{r.table}</span>
                      <span className="small muted">
                        {plural(r.attempts, 'try', 'tries')} · since {ago(r.since)}
                      </span>
                    </div>
                    <div className="small sub" style={{ overflowWrap: 'anywhere' }}>
                      {r.error ?? 'No reason recorded.'}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="card-body small sub" style={{ paddingTop: 0 }}>
                These may be the only copy of a sale or a count, so they are never discarded from here. Force sync retries them.
              </div>
            </>
          )}
          {(rows.receivedTotal > rows.received.length || rows.sendingTotal > rows.sending.length) && (
            <div className="card-body small muted" style={{ paddingTop: 0 }}>
              Showing {count(rows.received.length + rows.sending.length)} of {count(rows.receivedTotal + rows.sendingTotal)}.
            </div>
          )}
          <div className="card-body small muted" style={{ paddingTop: 0 }} title={exact(latest!.completedAt)}>
            Listed <When iso={latest!.completedAt} />.
          </div>
        </>
      )}
      {t.send.error && <div className="card-body"><ErrorNote error={t.send.error} /></div>}

      <StepUpDialog
        open={!!discarding}
        title={`Discard this ${discarding?.table ?? ''} row?`}
        confirm="Discard it"
        danger
        onClose={() => setDiscarding(null)}
        onConfirm={async (pw) => {
          await api.issueCommand(client, d.deviceId, 'pull.skip', { payload: { ref: discarding!.ref }, password: pw })
          t.refresh()
        }}
      >
        <p>
          The till backs itself up, then stops trying to apply it. The row is still in the cloud and on the till that wrote it; this till's copy
          will differ until someone edits that row again.
        </p>
        {discarding?.error && <p className="small sub">Refused because: {discarding.error}</p>}
      </StepUpDialog>
    </Card>
  )
}

/* -------------------------------------------------------------- settings --- */

export function TillSettings({ d }: { d: Device }) {
  const { client } = useSession()
  const t = useTillCommands(d)
  const view = t.settings.data
  if (!view || (!t.can('config.set') && !view.layers.device.config)) return null
  const below = belowOf([
    { config: view.layers.shop.config, from: 'its shop' },
    { config: view.layers.fleet.config, from: 'the fleet' },
  ])

  return (
    <Card title="Till settings" sub="This till's own, over its shop's and the fleet's.">
      <div className="stack" style={{ gap: 10 }}>
        <ConfigEditor
          own={view.layers.device.config ?? {}}
          below={below}
          canAct={t.can('config.set')}
          hint="A slower check-in saves a shop's mobile data, and makes the till slower to notice a fix. While this page is open the till checks in every few seconds whatever is set here."
          onApply={async (patch) => {
            await api.issueCommand(client, d.deviceId, 'config.set', { payload: patch })
            t.refresh()
          }}
        />
        <OnTillLine d={d} view={view} />
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------- cloud holds --- */

/**
 * The two controls the CLOUD enforces, so they hold even on a till that cannot
 * be trusted to obey one: its sync turned away, and no updates.
 */
export function CloudHolds({ d }: { d: Device }) {
  const { client, canAct } = useSession()
  const t = useTillCommands(d)
  const view = t.settings.data
  const [pausing, setPausing] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [updatesReason, setUpdatesReason] = useState('')
  const lift = useAction(async (kind: 'sync' | 'updates') => {
    await api.setHold(client, d.deviceId, kind, false)
    t.refresh()
  })
  const holdUpdates = useAction(async () => {
    await api.setHold(client, d.deviceId, 'updates', true, { reason: updatesReason.trim() || null })
    setUpdatesReason('')
    t.refresh()
  })
  if (!view || d.removedAt) return null
  const { syncHold, updateHold } = view.effective
  if (!syncHold && !updateHold && (t.blocked || !canAct)) return null
  const who = (h: { since: string; by: string | null; reason: string | null }) =>
    `${ago(h.since)}${h.by ? ` by ${h.by}` : ''}${h.reason ? ` — “${h.reason}”` : ''}`

  return (
    <Card title="Held in the cloud" sub="Enforced by the cloud rather than the till, so they hold even on a till that is not to be trusted.">
      <div className="stack" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="small" style={{ fontWeight: 550 }}>
            Sync
          </div>
          {syncHold ? (
            <div className="notice warn">
              <span style={{ flex: 1 }}>
                <strong>Paused</strong> {who(syncHold)}. The cloud turns away what this till sends and stops sending it the shop's changes.
                Everything it rings stays queued on it, and sends when the pause is lifted.
              </span>
              {canAct && (
                <ConfirmButton confirm="Let it sync" disabled={lift.pending} onConfirm={() => void lift.run('sync')}>
                  Lift
                </ConfirmButton>
              )}
            </div>
          ) : (
            <div className="row">
              <span className="small sub" style={{ flex: 1 }}>
                Syncing normally.
              </span>
              {canAct && !t.blocked && (
                <button className="btn sm danger" onClick={() => setPausing(true)}>
                  Pause sync…
                </button>
              )}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <div className="small" style={{ fontWeight: 550 }}>
            Updates
          </div>
          {updateHold ? (
            <div className="notice info">
              <span style={{ flex: 1 }}>
                <strong>Kept out of updates</strong> {who(updateHold)}
                {updateHold.from === 'shop' ? ', with the rest of its shop' : ''}. No rollout or operator can send it a new version.
              </span>
              {canAct &&
                (updateHold.from === 'shop' && d.shopId ? (
                  <a className="btn sm" href={href(`/shops/${encodeURIComponent(d.shopId)}`, { tab: 'tills' })}>
                    On the shop
                  </a>
                ) : (
                  <button className="btn sm" disabled={lift.pending} onClick={() => void lift.run('updates')}>
                    Let it update
                  </button>
                ))}
            </div>
          ) : canAct ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                void holdUpdates.run()
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                aria-label="Why keep it out of updates"
                placeholder="Why (optional) — a printer quirk, a stocktake…"
                maxLength={200}
                value={updatesReason}
                onChange={(e) => setUpdatesReason(e.target.value)}
              />
              <button type="submit" className="btn sm" disabled={holdUpdates.pending}>
                Keep out of updates
              </button>
            </form>
          ) : (
            <div className="small sub">Takes updates as they go out.</div>
          )}
        </div>
        {(lift.error || holdUpdates.error) && <ErrorNote error={(lift.error ?? holdUpdates.error)!} />}
      </div>

      <StepUpDialog
        open={pausing}
        title="Pause this till's sync?"
        confirm="Pause sync"
        danger
        onClose={() => setPausing(false)}
        onConfirm={async (pw) => {
          await api.setHold(client, d.deviceId, 'sync', true, { reason: pauseReason.trim() || null, password: pw })
          setPauseReason('')
          t.refresh()
        }}
      >
        <p>
          The cloud will turn away everything this till sends, and stop sending it the shop's changes, until you lift the pause. Nothing is
          lost: what it rings stays queued on it and sends afterwards. It keeps checking in, so it can still be locked or sent a message.
        </p>
        <Field label="Why (optional)" id="pause-reason" hint="Shown here and in the audit log.">
          <input id="pause-reason" className="input" maxLength={200} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} />
        </Field>
      </StepUpDialog>
    </Card>
  )
}
