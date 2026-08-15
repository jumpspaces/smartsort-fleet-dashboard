/**
 * One terminal, as a page of its own.
 *
 * This was a drawer over the list, which made the deepest thing in the console
 * the most cramped: the health reasons, the 48-hour trends, the remote actions
 * and the terminal's whole error history had to share 600px with a scrollbar,
 * and the list behind it was inert the entire time. It is the page an operator
 * sits on while they are on the phone to a shop, so it gets the room.
 *
 * It loads itself from `deviceId` rather than being handed a row, so a link
 * pasted into a chat opens the same page as a click from the table.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  Api,
  DeviceHistory,
  DeviceRow,
  ErrorRow,
  NoteRow,
  ShopRow,
  TimelineEvent,
} from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { Timeline } from '../components/Timeline.tsx'
import {
  Button,
  Card,
  Chip,
  Columns,
  CopyButton,
  Empty,
  KV,
  Notice,
  PageHead,
  Status,
  TableSkeleton,
} from '../components/ui.tsx'
import { bytes, cedis, duration, exact, timeAgo, timeUntil } from '../lib/format.ts'
import { severityTone, STATE_LABEL, TONE } from '../lib/state.ts'
import { DeviceActions } from './DeviceActions.tsx'

export function Device({
  api,
  deviceId,
  reloadKey,
  onNavigate,
  onBack,
}: {
  api: Api
  deviceId: string
  reloadKey: number
  onNavigate: Navigate
  onBack: () => void
}) {
  const [device, setDevice] = useState<DeviceRow | null>(null)
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)
  const [history, setHistory] = useState<DeviceHistory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [d, e, h] = await Promise.all([
        api.device(deviceId),
        api.deviceErrors(deviceId),
        api.deviceHistory(deviceId, 48),
      ])
      setDevice(d)
      setErrors(e)
      setHistory(h)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this terminal')
    }
  }, [api, deviceId])

  // The shell's poll drives this too, so a page left open on the phone keeps
  // telling the truth about the terminal being discussed.
  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const back = { label: 'Terminals', onClick: onBack }

  if (!device) {
    return (
      <>
        <PageHead back={back} title={loadError ? 'Terminal' : 'Loading…'} />
        {loadError ? <Notice>{loadError}</Notice> : <TableSkeleton rows={4} />}
      </>
    )
  }

  return (
    <>
      <PageHead
        back={back}
        title={device.shopName ?? 'Unclaimed terminal'}
        // The machine's own name leads the subtitle, because "Ressy Collections"
        // is three machines and this page is about one of them. The device id
        // still follows it — it is what the logs and the CLI speak.
        subtitle={
          <span className="cell-stack">
            {device.terminalCode && <span className="code-chip">{device.terminalCode}</span>}
            {device.machineName && <span className="strong">{device.machineName}</span>}
            <span className="mono">{device.deviceId}</span>
          </span>
        }
        actions={
          <>
            <CopyButton value={device.deviceId} label="Copy device ID" size="md" />
            {device.shopId && (
              <Button onClick={() => onNavigate('shop', { id: device.shopId! })}>
                <Icon name="link" size={14} />
                Open shop
              </Button>
            )}
          </>
        }
      />

      {loadError && <Notice>{loadError}</Notice>}

      <Columns
        main={
          <>
            <Card title="Status">
              <div className="card-status">
                <Status tone={TONE[device.state]} label={STATE_LABEL[device.state]} />
                <span className="muted small" title={exact(device.lastReportAt)}>
                  Last seen {timeAgo(device.lastReportAt)}
                </span>
              </div>

              {/* The full list, worst first. The table shows only the head of it. */}
              {device.reasons.length > 0 ? (
                <ul className="reasons">
                  {device.reasons.map((r) => (
                    <li key={r.code}>
                      <span className="dot" data-tone={severityTone(r.severity)} />
                      {r.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">
                  Nothing is wrong with this terminal: it is checking in, its queues are clear and
                  its local server is answering.
                </p>
              )}

              <dl className="kv-list">
                <KV k="First seen" v={timeAgo(device.firstReportAt)} title={exact(device.firstReportAt)} />
                <KV
                  k="App uptime"
                  v={device.appUptimeSec != null ? duration(device.appUptimeSec * 1000) : '—'}
                />
                <KV
                  k="Availability"
                  v={
                    history?.uptimeBps == null ? (
                      <span className="muted">Collecting</span>
                    ) : (
                      `${(history.uptimeBps / 100).toFixed(1)}% over ${history.days.length} day(s)`
                    )
                  }
                />
                <KV
                  k="Local server"
                  v={
                    device.serverHealthy == null ? (
                      '—'
                    ) : device.serverHealthy ? (
                      <Chip tone="ok">Healthy</Chip>
                    ) : (
                      <Chip tone="bad">Down</Chip>
                    )
                  }
                />
                <KV
                  k="Clock"
                  v={
                    device.clockSkewMs == null ? (
                      <span className="muted">Not reported</span>
                    ) : Math.abs(device.clockSkewMs) < 60_000 ? (
                      <Chip tone="ok">In step</Chip>
                    ) : (
                      <Chip tone="warn">
                        {duration(Math.abs(device.clockSkewMs))}{' '}
                        {device.clockSkewMs > 0 ? 'ahead' : 'behind'}
                      </Chip>
                    )
                  }
                />
                <KV
                  k="Reporting key"
                  v={
                    device.keyVerified ? (
                      <Chip tone="ok">Own store key</Chip>
                    ) : (
                      <Chip tone="warn">Shared enrollment key</Chip>
                    )
                  }
                />
              </dl>
            </Card>

            {/* Trends are the whole point of keeping history: a queue of 12 means
                nothing until you can see whether it was 3 an hour ago. */}
            <Card title="Last 48 hours">
              {history == null ? (
                <div className="skeleton" style={{ width: '60%' }} />
              ) : history.beats.length < 2 ? (
                <p className="muted small">
                  Not enough beats yet — a terminal checks in about every three minutes, so trends
                  fill in within the hour.
                </p>
              ) : (
                <div className="trends">
                  <Trend
                    label="Sync queue"
                    values={history.beats.map((b) => b.syncPending)}
                    current={device.syncPending}
                  />
                  <Trend
                    label="Sales today"
                    values={history.beats.map((b) => b.salesTodayCount)}
                    current={device.salesTodayCount}
                  />
                  <Trend
                    label="Errors per beat"
                    values={history.beats.map((b) => b.errorGroups)}
                    current={null}
                  />
                </div>
              )}

              {history != null && history.days.length > 0 && (
                <div className="days">
                  {history.days.slice(0, 30).map((d) => (
                    <span
                      key={d.day}
                      className="day-cell"
                      data-tone={d.uptimeBps >= 9500 ? 'ok' : d.uptimeBps >= 7000 ? 'warn' : 'bad'}
                      title={`${new Date(d.day).toLocaleDateString()} — ${(d.uptimeBps / 100).toFixed(
                        0,
                      )}% up, ${d.beats} of ${d.expectedBeats} beats`}
                    />
                  ))}
                  <span className="muted small">Daily availability, most recent first</span>
                </div>
              )}
            </Card>

            <Card title={errors?.length ? `Errors (${errors.length})` : 'Errors'}>
              {errors == null && !loadError && (
                <div className="skeleton-rows">
                  {[0, 1].map((i) => (
                    <div key={i} style={{ padding: '10px 0' }}>
                      <div className="skeleton" style={{ width: `${70 - i * 18}%` }} />
                    </div>
                  ))}
                </div>
              )}
              {errors?.length === 0 && (
                <Empty icon="check" title="No errors reported">
                  This terminal has sent no client errors. Anything it does hit gets buffered and
                  uploaded with the next check-in.
                </Empty>
              )}
              {errors?.map((e) => (
                <article key={e.id} className="err">
                  <div className="err-head">
                    <Chip tone="warn">×{e.count}</Chip>
                    {/* The message opens the fleet-wide fault: one terminal
                        hitting something is rarely the whole story. */}
                    <button
                      type="button"
                      className="row-open err-msg"
                      onClick={() => onNavigate('error', { id: e.fingerprint })}
                    >
                      {e.message}
                    </button>
                    {/* Triage state lives on the fleet-wide group, so a fault fixed
                        for everyone reads as fixed here too. */}
                    {e.status && e.status !== 'open' && <Chip tone="idle">{e.status}</Chip>}
                  </div>
                  <div className="err-meta">
                    {e.source ?? 'unknown source'} · v{e.appVersion ?? '?'} · first{' '}
                    <span title={exact(e.firstSeen)}>{timeAgo(e.firstSeen)}</span> · last{' '}
                    <span title={exact(e.lastSeen)}>{timeAgo(e.lastSeen)}</span>
                  </div>
                  {e.stack && <pre className="stack">{e.stack}</pre>}
                </article>
              ))}
            </Card>

            <History api={api} deviceId={deviceId} reloadKey={reloadKey} />

            <Notes api={api} deviceId={deviceId} reloadKey={reloadKey} />
          </>
        }
        side={
          <>
            <Card title="Actions">
              <DeviceActions api={api} device={device} canAct={api.operator.role !== 'viewer'} />
            </Card>

            <ShopContact api={api} shopId={device.shopId} />

            <MuteCard api={api} device={device} onChanged={() => void load()} />

            <TagCard api={api} device={device} onChanged={() => void load()} />

            {/* Two facts about this machine that nothing else on the page can
                stand in for: how long before its disk stops it selling, and
                whether the shop's own history exists anywhere but here. */}
            <Card title="Storage">
              <dl className="kv-list">
                <KV
                  k="Disk free"
                  v={
                    device.diskFreeBytes == null ? (
                      <span className="muted">Not reported</span>
                    ) : device.reasons.some((r) => r.code === 'disk_low') ? (
                      <Chip tone="bad">{bytes(device.diskFreeBytes)}</Chip>
                    ) : (
                      bytes(device.diskFreeBytes)
                    )
                  }
                />
                <KV
                  k="Disk size"
                  v={device.diskTotalBytes != null ? bytes(device.diskTotalBytes) : '—'}
                />
                <KV k="Database" v={device.dbSizeBytes != null ? bytes(device.dbSizeBytes) : '—'} />
                <KV
                  k="Last backup"
                  v={
                    device.backupError ? (
                      <Chip tone="bad">Failing</Chip>
                    ) : device.lastBackupAt ? (
                      <span title={exact(device.lastBackupAt)}>{timeAgo(device.lastBackupAt)}</span>
                    ) : (
                      <span className="muted">Never reported</span>
                    )
                  }
                />
                {device.backupSizeBytes != null && (
                  <KV k="Backup size" v={bytes(device.backupSizeBytes)} />
                )}
              </dl>
              {device.backupError && (
                <p className="bad-text small" style={{ marginTop: 8 }}>
                  {device.backupError}
                </p>
              )}
            </Card>

            <Card title="Sync">
              <dl className="kv-list">
                <KV
                  k="Queued"
                  v={
                    (device.syncPending ?? 0) > 0 ? (
                      <Chip tone="warn">{device.syncPending}</Chip>
                    ) : (
                      String(device.syncPending ?? '—')
                    )
                  }
                />
                <KV
                  k="Failed"
                  v={
                    (device.syncFailed ?? 0) > 0 ? (
                      <Chip tone="bad">{device.syncFailed}</Chip>
                    ) : (
                      String(device.syncFailed ?? '—')
                    )
                  }
                />
                <KV
                  k="Oldest queued"
                  v={device.oldestPendingAgeMs != null ? duration(device.oldestPendingAgeMs) : '—'}
                />
                <KV k="Last sync" v={timeAgo(device.lastSyncAt)} title={exact(device.lastSyncAt)} />
                {/* The inbound half. A till that cannot receive is in worse
                    trouble than one with rows queued to send, and nothing else
                    on this page says so. */}
                <KV
                  k="Last received"
                  v={timeAgo(device.lastPulledAt)}
                  title={exact(device.lastPulledAt)}
                />
                <KV
                  k="Rejected on arrival"
                  v={
                    (device.pullQuarantined ?? 0) > 0 ? (
                      <Chip tone="warn">{device.pullQuarantined}</Chip>
                    ) : (
                      String(device.pullQuarantined ?? '—')
                    )
                  }
                />
              </dl>
            </Card>

            <Card title="Install">
              <dl className="kv-list">
                <KV k="Installed" v={<span className="mono">{device.appVersion ?? '—'}</span>} />
                {/* Only worth a row when there is one: most terminals run what their
                    installer shipped, and an "App update: none" line on every page
                    would be noise. */}
                {device.bundleVersion && (
                  <KV k="App update" v={<span className="mono">{device.bundleVersion}</span>} />
                )}
                <KV k="Platform" v={`${device.platform ?? '—'} ${device.osVersion ?? ''}`.trim()} />
                <KV k="Mode" v={device.mode ?? '—'} />
                <KV
                  k="Sales today"
                  v={
                    device.salesTodayCount == null
                      ? '—'
                      : `${cedis(device.salesTodayPesewas ?? 0)} · ${device.salesTodayCount}`
                  }
                />
              </dl>
            </Card>
          </>
        }
      />
    </>
  )
}

/* ------------------------------------------------------------- who to ring */

/**
 * The owner's name and telephone number, on the page somebody is looking at
 * while they decide to telephone them.
 *
 * It exists two clicks away on the shop page. Two clicks is the difference
 * between ringing the shop and writing "will call them tomorrow" — and this is
 * the one card here whose content is a person rather than a machine.
 */
function ShopContact({ api, shopId }: { api: Api; shopId: string | null }) {
  const [shop, setShop] = useState<ShopRow | null>(null)

  useEffect(() => {
    if (!shopId) return
    void api
      .shop(shopId)
      .then(setShop)
      .catch(() => setShop(null))
  }, [api, shopId])

  if (!shopId || !shop) return null

  return (
    <Card title="Who to ring">
      <dl className="kv-list">
        <KV k="Owner" v={shop.owner?.name ?? '—'} />
        <KV
          k="Phone"
          v={
            shop.phone ? (
              // A real link: on a laptop with a soft phone this dials, and on
              // everything else it is still the number, selectable.
              <a href={`tel:${shop.phone.replace(/\s+/g, '')}`}>{shop.phone}</a>
            ) : (
              <span className="muted">Not recorded</span>
            )
          }
        />
        <KV k="Shop code" v={<span className="mono">{shop.code ?? '—'}</span>} />
        <KV k="Location" v={shop.location ?? '—'} />
        <KV
          k="Terminals"
          v={`${shop.health.healthy} healthy · ${shop.health.attention} attention · ${shop.health.offline} offline`}
        />
      </dl>
    </Card>
  )
}

/* ----------------------------------------------------------------- history */

/** The interleaved story. Fourteen days by default — a support call's memory. */
function History({ api, deviceId, reloadKey }: { api: Api; deviceId: string; reloadKey: number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [days, setDays] = useState(14)

  useEffect(() => {
    void api
      .timeline(deviceId, days)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [api, deviceId, days, reloadKey])

  return (
    <Card
      title="What happened"
      actions={
        <div className="filters" role="group" aria-label="Window">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              className="key"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {events == null ? (
        <div className="skeleton" style={{ width: '60%' }} />
      ) : (
        <Timeline events={events} />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------- notes */

/**
 * The support diary for this terminal.
 *
 * Deliberately plain: a box, a button, and a list. Everything else on this page
 * is a measurement, and the one thing measurements cannot hold is the sentence
 * that decides what to do — "owner away until Tuesday", "third visit for this
 * router". Pinning lifts a standing fact above the running commentary; there is
 * no edit, because a diary quietly rewritten afterwards reads exactly as
 * trustworthy as one that was not.
 */
function Notes({
  api,
  deviceId,
  reloadKey,
}: {
  api: Api
  deviceId: string
  reloadKey: number
}) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [draft, setDraft] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canAct = api.operator.role !== 'viewer'

  const load = useCallback(() => {
    void api
      .notes(deviceId)
      .then(setNotes)
      .catch(() => setNotes([]))
  }, [api, deviceId])

  useEffect(load, [load, reloadKey])

  async function add() {
    if (!draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.addNote(deviceId, draft.trim(), pinned)
      setDraft('')
      setPinned(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that note')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={notes?.length ? `Notes (${notes.length})` : 'Notes'}>
      {error && <Notice>{error}</Notice>}

      {canAct && (
        <div style={{ marginBottom: 12 }}>
          <textarea
            className="input"
            rows={2}
            value={draft}
            placeholder="What does the next person need to know about this terminal?"
            aria-label="New note"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line. A diary entry is
              // usually one sentence typed while on the phone.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void add()
              }
            }}
          />
          <div className="toolbar" style={{ gap: 8, marginTop: 8 }}>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Standing fact — keep it at the top and on the list row
            </label>
            <Button size="sm" busy={busy} disabled={!draft.trim()} onClick={() => void add()}>
              Add note
            </Button>
          </div>
        </div>
      )}

      {notes == null ? (
        <div className="skeleton" style={{ width: '55%' }} />
      ) : notes.length === 0 ? (
        <p className="muted small">
          Nothing written down yet. Anything here shows on the terminals list, so the next person
          starts where you left off rather than from the beginning.
        </p>
      ) : (
        notes.map((n) => (
          <div key={n.id} className="note-item">
            {n.pinned && <Chip tone="idle">Pinned</Chip>}
            <div className="note-body">{n.body}</div>
            <div className="note-meta">
              <span>{n.authorLabel ?? 'unknown'}</span>
              <span title={exact(n.createdAt)}>{timeAgo(n.createdAt)}</span>
              {canAct && (
                <>
                  <button
                    type="button"
                    className="row-open"
                    onClick={() => void api.pinNote(n.id, !n.pinned).then(load)}
                  >
                    {n.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    className="row-open"
                    onClick={() => void api.deleteNote(n.id).then(load)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------- mutes */

/** Preset windows. Anything longer is a decision, not a click. */
const MUTE_PRESETS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Today', minutes: 12 * 60 },
  { label: '3 days', minutes: 3 * 24 * 60 },
  { label: '2 weeks', minutes: 14 * 24 * 60 },
]

/**
 * Silence this terminal for a while — and say why.
 *
 * The reason is required, and the card says out loud what a mute does NOT do:
 * the terminal keeps reporting, keeps failing its uptime, keeps counting. If
 * silencing something also made it look well, the quickest route to a green
 * console would be to stop listening.
 */
function MuteCard({
  api,
  device,
  onChanged,
}: {
  api: Api
  device: DeviceRow
  onChanged: () => void
}) {
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(MUTE_PRESETS[1]!.minutes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canAct = api.operator.role !== 'viewer'

  if (device.mute) {
    const scopedElsewhere = device.mute.scope !== 'device'
    return (
      <Card title="Silenced">
        <p className="small">{device.mute.reason}</p>
        <dl className="kv-list">
          <KV k="Until" v={<span title={exact(device.mute.endsAt)}>{timeUntil(device.mute.endsAt)}</span>} />
          <KV k="Set by" v={device.mute.createdByLabel ?? '—'} />
          {scopedElsewhere && <KV k="Scope" v={`Whole ${device.mute.scope}`} />}
        </dl>
        <p className="hint" style={{ marginTop: 8 }}>
          Alerts for this terminal are being held, not dropped: anything still wrong when the window
          closes pages then.
        </p>
        {canAct && (
          <Button
            size="sm"
            variant="ghost"
            busy={busy}
            onClick={() => {
              setBusy(true)
              void api
                .cancelMute(device.mute!.id)
                .then(onChanged)
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : 'Could not lift it'),
                )
                .finally(() => setBusy(false))
            }}
          >
            Lift now
          </Button>
        )}
        {error && <Notice>{error}</Notice>}
      </Card>
    )
  }

  if (!canAct) return null

  return (
    <Card title="Silence alerts">
      {error && <Notice>{error}</Notice>}
      <input
        className="input"
        value={reason}
        placeholder="Why — shop closed, machine being replaced…"
        aria-label="Reason for silencing"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="toolbar" style={{ gap: 8, marginTop: 8 }}>
        <select
          className="input"
          value={minutes}
          aria-label="How long"
          onChange={(e) => setMinutes(Number(e.target.value))}
        >
          {MUTE_PRESETS.map((p) => (
            <option key={p.minutes} value={p.minutes}>
              {p.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          busy={busy}
          disabled={!reason.trim()}
          onClick={() => {
            setBusy(true)
            setError(null)
            void api
              .openMute({ scope: 'device', deviceId: device.deviceId, reason: reason.trim(), minutes })
              .then(() => {
                setReason('')
                onChanged()
              })
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : 'Could not silence it'),
              )
              .finally(() => setBusy(false))
          }}
        >
          Silence
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Stops the paging, changes nothing else: this terminal still shows its real state here and
        still counts against availability.
      </p>
    </Card>
  )
}

/* -------------------------------------------------------------------- tags */

function TagCard({
  api,
  device,
  onChanged,
}: {
  api: Api
  device: DeviceRow
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canAct = api.operator.role !== 'viewer'
  if (!canAct && device.tags.length === 0) return null

  return (
    <Card title="Tags">
      {error && <Notice>{error}</Notice>}
      <div className="cell-stack">
        {device.tags.length === 0 && <span className="muted small">No tags</span>}
        {device.tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            {canAct && (
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => void api.removeTag(device.deviceId, t).then(onChanged)}
              >
                <Icon name="close" size={10} />
              </button>
            )}
          </span>
        ))}
      </div>
      {canAct && (
        <div className="toolbar" style={{ gap: 8, marginTop: 10 }}>
          <input
            className="input"
            value={draft}
            placeholder="canary, ring-1, flaky-router…"
            aria-label="New tag"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !draft.trim()) return
              void api
                .addTag(device.deviceId, draft.trim())
                .then(() => {
                  setDraft('')
                  onChanged()
                })
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : 'Could not add that tag'),
                )
            }}
          />
        </div>
      )}
      {/* The one tag that does something rather than only describing something. */}
      <p className="hint" style={{ marginTop: 8 }}>
        A terminal tagged <b>canary</b> goes in the first wave of every rollout.
      </p>
    </Card>
  )
}

function Trend({
  label,
  values,
  current,
}: {
  label: string
  values: (number | null)[]
  current: number | null
}) {
  return (
    <div className="trend">
      <div className="trend-head">
        <span className="trend-label">{label}</span>
        {current != null && <span className="trend-now">{current}</span>}
      </div>
      <Sparkline values={values} label={label} />
    </div>
  )
}

