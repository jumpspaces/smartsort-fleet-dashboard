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
import type { Api, DeviceHistory, DeviceRow, ErrorRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
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
import { cedis, duration, exact, timeAgo } from '../lib/format.ts'
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
        subtitle={<span className="mono">{device.deviceId}</span>}
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
          </>
        }
        side={
          <>
            <Card title="Actions">
              <DeviceActions api={api} device={device} canAct={api.operator.role !== 'viewer'} />
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
                <KV k="Database" v={device.dbSizeBytes != null ? bytes(device.dbSizeBytes) : '—'} />
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

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}
