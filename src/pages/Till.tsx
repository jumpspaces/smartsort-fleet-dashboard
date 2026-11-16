import { useState, type FormEvent, type ReactNode } from 'react'
import * as api from '../api/endpoints.ts'
import type { Command, Device } from '../api/types.ts'
import { HttpError } from '../api/client.ts'
import { Card, Empty, ErrorNote, Live, Loadable, PageHeader, StateBadge, Strip, When } from '../components/ui.tsx'
import {
  useCommandCatalogue,
  useDevice,
  useDeviceCommands,
  useDeviceErrors,
  useHeartbeats,
  useNotes,
  useShopIndex,
} from '../data.ts'
import { ago, bytes, count, duration, exact, money, plural, until } from '../lib/format.ts'
import { reasonPlain, tillName } from '../lib/plain.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { href, shopHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'
import { ConfirmButton } from '../components/forms.tsx'
import { Fortnight, Tags, Timeline, TillActions, TwoDays } from './till/TillExtras.tsx'

export function Till({ id }: { id: string }) {
  const device = useDevice(id)
  const back = { href: href('/tills'), label: 'Tills' }

  if (!device.data) {
    if (device.error instanceof HttpError && device.error.status === 404) {
      return (
        <>
          <PageHeader title="Till not found" back={back} />
          <Card>
            <Empty title="No till with this id">It may have been removed, or the link is wrong.</Empty>
          </Card>
        </>
      )
    }
    return (
      <>
        <PageHeader title="Till" back={back} />
        <Card flush>
          <Loadable q={device} rows={6}>
            {() => null}
          </Loadable>
        </Card>
      </>
    )
  }

  const d = device.data
  return (
    <div className="stack">
      <PageHeader
        back={back}
        title={
          <span className="row" style={{ gap: 12 }}>
            {tillName(d)} <StateBadge state={d.state} muted={!!d.mute} />
          </span>
        }
        sub={
          <>
            {d.shopId ? <a href={shopHref(d.shopId)}>{d.shopName ?? 'Unnamed shop'}</a> : 'Not linked to a shop'}
            {d.terminalCode && d.machineName && ` · ${d.terminalCode}`}
            {' · '}
            <span className="mono">{d.deviceId}</span>
          </>
        }
        actions={
          <>
            <Live updatedAt={device.updatedAt} busy={device.refreshing} />
            <TillActions d={d} />
          </>
        }
      />

      {device.error && <ErrorNote error={device.error} onRetry={device.reload} />}
      {d.removedAt && (
        <div className="notice warn">
          This till was taken off its shop {ago(d.removedAt)}. It no longer counts towards the shop's health or alerts.
        </div>
      )}
      {d.mute && (
        <div className="notice info">
          Alerts muted {until(d.mute.endsAt)} — “{d.mute.reason}”
          {d.mute.createdByLabel && ` (${d.mute.createdByLabel})`}
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <Problems d={d} />
          <Vitals d={d} />
          <Timeline id={d.deviceId} />
          <Errors id={d.deviceId} />
        </div>
        <div className="stack">
          <Uptime id={d.deviceId} />
          <Actions d={d} />
          <Notes id={d.deviceId} />
          <Tags d={d} />
          <TwoDays d={d} />
          <Fortnight d={d} />
        </div>
      </div>
    </div>
  )
}

function Problems({ d }: { d: Device }) {
  if (d.reasons.length === 0) {
    return (
      <Card title="What's wrong">
        <div className="sub">Nothing — this till is working normally.</div>
      </Card>
    )
  }
  return (
    <Card title="What's wrong" sub={plural(d.reasons.length, 'problem')} flush>
      <ul className="list">
        {d.reasons.map((r) => {
          const p = reasonPlain(r.code)
          return (
            <li key={r.code}>
              <div className="issue-title row" style={{ gap: 8 }}>
                <span className={`dot ${r.severity === 'critical' ? 'offline' : 'attention'}`} />
                {p.title}
              </div>
              <div className="issue-hint">{p.hint}</div>
              <div className="small muted" style={{ marginTop: 2 }}>
                Till reported: {r.label}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Fact({ label, children, tone, title }: { label: string; children: ReactNode; tone?: 'warn' | 'bad'; title?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone} title={title}>
        {children}
      </dd>
    </div>
  )
}

function Vitals({ d }: { d: Device }) {
  const shops = useShopIndex()
  const currency = (d.shopId && shops.get(d.shopId)?.currency) || 'GHS'
  const diskPct = d.diskFreeBytes != null && d.diskTotalBytes ? d.diskFreeBytes / d.diskTotalBytes : null
  const skew = d.clockSkewMs
  // Tone follows the server's reasons; the console never re-judges thresholds.
  const has = (...codes: string[]) => d.reasons.some((r) => codes.includes(r.code))
  const tone = (bad: boolean, warn: boolean) => (bad ? 'bad' : warn ? 'warn' : undefined)

  return (
    <Card title="Details" flush>
      <dl className="kv" style={{ margin: 0 }}>
        <Fact label="Last check-in" title={exact(d.lastReportAt)}>
          {ago(d.lastReportAt)}
        </Fact>
        <Fact label="SmartSort running" tone={tone(has('server_down'), false)}>
          {d.serverHealthy == null ? '—' : d.serverHealthy ? 'Yes' : 'No'}
          {d.appUptimeSec != null && <span className="small muted"> · up {duration(d.appUptimeSec * 1000)}</span>}
        </Fact>
        <Fact label="Sales today">
          {money(d.salesTodayPesewas, currency)}
          <span className="small muted"> · {count(d.salesTodayCount)}</span>
        </Fact>
        <Fact label="Waiting to send" tone={tone(has('sync_failed'), has('sync_stuck', 'sync_deep'))}>
          {count(d.syncPending)}
          {!!d.syncFailed && <span className="small"> · {count(d.syncFailed)} failed</span>}
          {d.oldestPendingAgeMs != null && d.oldestPendingAgeMs > 0 && (
            <span className="small muted"> · oldest {duration(d.oldestPendingAgeMs)}</span>
          )}
        </Fact>
        <Fact label="Last sent up" title={exact(d.lastSyncAt)}>
          {ago(d.lastSyncAt)}
        </Fact>
        <Fact label="Last received" title={exact(d.lastPulledAt)} tone={tone(false, has('pull_stale', 'pull_quarantined'))}>
          {ago(d.lastPulledAt)}
          {!!d.pullQuarantined && <span className="small"> · {count(d.pullQuarantined)} refused</span>}
        </Fact>
        <Fact label="Version">
          <span className="mono">{d.appVersion ?? '—'}</span>
          {d.bundleVersion && <span className="small muted"> · patch {d.bundleVersion}</span>}
        </Fact>
        <Fact label="Computer">
          {d.platform ?? '—'}
          {d.osVersion && <span className="small muted"> {d.osVersion}</span>}
        </Fact>
        <Fact label="Disk free" tone={tone(false, has('disk_low'))}>
          {bytes(d.diskFreeBytes)}
          {diskPct != null && <span className="small muted"> · {Math.round(diskPct * 100)}%</span>}
        </Fact>
        <Fact label="Last backup" title={exact(d.lastBackupAt)} tone={tone(false, has('backup_stale'))}>
          {ago(d.lastBackupAt)}
          {d.backupSizeBytes != null && <span className="small muted"> · {bytes(d.backupSizeBytes)}</span>}
          {d.backupError && <div className="small">{d.backupError}</div>}
        </Fact>
        <Fact label="Clock" tone={tone(false, has('clock_skew'))}>
          {skew == null
            ? '—'
            : Math.abs(skew) < 5_000
              ? 'Correct'
              : `${duration(skew)} ${skew > 0 ? 'fast' : 'slow'}`}
        </Fact>
        <Fact label="Linked to shop" tone={tone(has('key_rejected'), has('unverified_key'))}>
          {d.keyVerified ? 'Yes' : 'Not yet'}
        </Fact>
        <Fact label="Database">{bytes(d.dbSizeBytes)}</Fact>
        <Fact label="First seen" title={exact(d.firstReportAt)}>
          {ago(d.firstReportAt)}
        </Fact>
      </dl>
    </Card>
  )
}

function Uptime({ id }: { id: string }) {
  const strips = useHeartbeats([id])
  const strip = strips.data?.[0]
  const total = strip ? strip.buckets.length * strip.expectedPerBucket : 0
  const got = strip ? strip.buckets.reduce((s, b) => s + Math.min(b, strip.expectedPerBucket), 0) : 0
  return (
    <Card title="Last 24 hours" sub={strip && total ? `${Math.round((got / total) * 100)}% of check-ins arrived` : undefined}>
      {strips.error && !strip ? (
        <ErrorNote error={strips.error} onRetry={strips.reload} />
      ) : (
        <>
          <Strip strip={strip} large />
          <div className="strip-axis">
            <span>24h ago</span>
            <span>now</span>
          </div>
        </>
      )}
    </Card>
  )
}

/** Installing or reverting a version needs one named — that's the Updates page. */
const NEEDS_PAYLOAD = new Set(['app.bundle', 'app.revert'])

const COMMAND_STATE: Record<Command['state'], string> = {
  pending: 'Waiting for the till',
  sent: 'Sent to the till',
  done: 'Done',
  failed: 'Failed',
  expired: 'Till never picked it up',
}

function Actions({ d }: { d: Device }) {
  const { client, canAct } = useSession()
  const catalogue = useCommandCatalogue()
  const history = useDeviceCommands(d.deviceId)
  const issue = useAction(async (name: string) => {
    await api.issueCommand(client, d.deviceId, name)
    invalidate(`commands:${d.deviceId}`)
  })
  const cancel = useAction(async (cmdId: string) => {
    await api.cancelCommand(client, cmdId)
    invalidate(`commands:${d.deviceId}`)
  })
  const outstanding = new Set(
    (history.data ?? []).filter((c) => c.state === 'pending' || c.state === 'sent').map((c) => c.command),
  )
  // A till on the shared enrollment key never gets commands — its identity is
  // only claimed, not proven — so don't offer buttons that can't work.
  const blocked = !d.keyVerified

  return (
    <Card title="Remote fixes" sub="Delivered the next time the till checks in, within about 3 minutes.">
      <div className="stack" style={{ gap: 12 }}>
        {blocked ? (
          <div className="notice info">Remote fixes become available once this till is linked to its shop.</div>
        ) : !canAct ? (
          <div className="notice info">Your account can view tills but not send fixes.</div>
        ) : (
          <Loadable q={catalogue} rows={2}>
            {(specs) => (
              <div className="row">
                {specs.filter((s) => !NEEDS_PAYLOAD.has(s.name)).map((s) => (
                  <button
                    key={s.name}
                    className="btn sm"
                    title={s.description}
                    disabled={issue.pending || outstanding.has(s.name)}
                    onClick={() => void issue.run(s.name)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </Loadable>
        )}
        {issue.error && <ErrorNote error={issue.error} />}
        {cancel.error && <ErrorNote error={cancel.error} />}
        {(history.data ?? []).length > 0 && (
          <ul className="list" style={{ margin: '0 -16px -16px', borderTop: '1px solid var(--line)' }}>
            {(history.data ?? []).slice(0, 6).map((c) => {
              const label = catalogue.data?.find((s) => s.name === c.command)?.label ?? c.command
              const open = c.state === 'pending' || c.state === 'sent'
              return (
                <li key={c.id}>
                  <div className="spread">
                    <span style={{ fontWeight: 550 }}>{label}</span>
                    <span className="small muted">
                      <When iso={c.issuedAt} />
                    </span>
                  </div>
                  <div className="spread small">
                    <span className={c.state === 'failed' ? '' : 'sub'} style={c.state === 'failed' ? { color: 'var(--bad)' } : undefined}>
                      {COMMAND_STATE[c.state]}
                      {c.error ? ` — ${c.error}` : c.result ? ` — ${c.result}` : ''}
                    </span>
                    {open && canAct && c.state === 'pending' && (
                      <button className="btn sm ghost" disabled={cancel.pending} onClick={() => void cancel.run(c.id)}>
                        Cancel
                      </button>
                    )}
                  </div>
                  {c.issuedByLabel && <div className="small muted">by {c.issuedByLabel}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}

function Errors({ id }: { id: string }) {
  const errors = useDeviceErrors(id)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <Card title="App problems" sub="Errors this till has reported." flush>
      <Loadable q={errors} rows={3}>
        {(list) =>
          list.length === 0 ? (
            <Empty title="No app problems reported" />
          ) : (
            <ul className="list">
              {list.slice(0, 20).map((e) => (
                <li key={e.id}>
                  <div className="spread" style={{ alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 550, overflowWrap: 'anywhere', flex: '1 1 240px' }}>{e.message}</span>
                    <span className="small muted nowrap">
                      {plural(e.count, 'time')} · <When iso={e.lastSeen} />
                    </span>
                  </div>
                  <div className="row small sub">
                    {e.status && <span className="tag">{e.status}</span>}
                    {e.source && <span>{e.source}</span>}
                    {e.appVersion && <span className="mono">{e.appVersion}</span>}
                    {e.stack && (
                      <button className="btn sm ghost" onClick={() => setOpenId(openId === e.id ? null : e.id)}>
                        {openId === e.id ? 'Hide details' : 'Details'}
                      </button>
                    )}
                  </div>
                  {openId === e.id && e.stack && <pre className="stack">{e.stack}</pre>}
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </Card>
  )
}

function Notes({ id }: { id: string }) {
  const { client, canAct } = useSession()
  const notes = useNotes(id)
  const [body, setBody] = useState('')
  const add = useAction(async (text: string) => {
    await api.addNote(client, id, text)
    setBody('')
    invalidate(`notes:${id}`)
    invalidate(`device:${id}`)
  })
  const edit = useAction(async (fn: () => Promise<unknown>) => {
    await fn()
    invalidate(`notes:${id}`)
    invalidate(`device:${id}`)
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim()) void add.run(body.trim())
  }
  return (
    <Card title="Notes" sub="For whoever looks at this till next.">
      <div className="stack" style={{ gap: 12 }}>
        {canAct && (
          <form onSubmit={submit} className="stack" style={{ gap: 8 }}>
            <label htmlFor="note" className="sr-only">
              Add a note
            </label>
            <textarea
              id="note"
              className="textarea"
              rows={2}
              placeholder="e.g. Owner says the router is being replaced Friday"
              value={body}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm primary" type="submit" disabled={add.pending || !body.trim()}>
                {add.pending ? 'Saving…' : 'Add note'}
              </button>
            </div>
            {add.error && <ErrorNote error={add.error} />}
            {edit.error && <ErrorNote error={edit.error} />}
          </form>
        )}
        <Loadable q={notes} rows={2}>
          {(list) =>
            list.length === 0 ? (
              <div className="small muted">No notes yet.</div>
            ) : (
              <ul className="list" style={{ margin: '0 -16px -16px', borderTop: '1px solid var(--line)' }}>
                {[...list]
                  .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                  .map((n) => (
                    <li key={n.id}>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
                      <div className="spread small">
                        <span className="muted">
                          {n.pinned && 'Pinned · '}
                          {n.authorLabel ?? 'Unknown'} · <When iso={n.createdAt} />
                        </span>
                        {canAct && (
                          <span className="row" style={{ gap: 2 }}>
                            <button className="btn sm ghost" disabled={edit.pending} onClick={() => void edit.run(() => api.pinNote(client, n.id, !n.pinned))}>
                              {n.pinned ? 'Unpin' : 'Pin'}
                            </button>
                            <ConfirmButton danger confirm="Delete" disabled={edit.pending} onConfirm={() => void edit.run(() => api.deleteNote(client, n.id))}>
                              Delete
                            </ConfirmButton>
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            )
          }
        </Loadable>
      </div>
    </Card>
  )
}
