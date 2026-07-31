import { useEffect, useState } from 'react'
import type { Api, DeviceHistory, DeviceRow, ErrorRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import {
  Button,
  Chip,
  CopyButton,
  Drawer,
  DrawerSection,
  Empty,
  KV,
  Notice,
  Status,
} from '../components/ui.tsx'
import { cedis, duration, exact, timeAgo } from '../lib/format.ts'
import { severityTone, STATE_LABEL, TONE } from '../lib/state.ts'

export function DeviceDrawer({
  api,
  device,
  onClose,
  onNavigate,
}: {
  api: Api
  device: DeviceRow
  onClose: () => void
  onNavigate: Navigate
}) {
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)
  const [history, setHistory] = useState<DeviceHistory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.deviceErrors(device.deviceId), api.deviceHistory(device.deviceId, 48)])
      .then(([e, h]) => {
        if (!live) return
        setErrors(e)
        setHistory(h)
      })
      .catch((err) => {
        if (!live) return
        setLoadError(err instanceof Error ? err.message : 'Could not load this terminal')
      })
    return () => {
      live = false
    }
  }, [api, device.deviceId])

  return (
    <Drawer
      title={device.shopName ?? 'Unclaimed terminal'}
      subtitle={<span className="mono">{device.deviceId}</span>}
      onClose={onClose}
    >
      <DrawerSection title="Status">
        <div className="drawer-status">
          <Status tone={TONE[device.state]} label={STATE_LABEL[device.state]} />
          <CopyButton value={device.deviceId} label="Copy device ID" />
          {device.shopId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onClose()
                onNavigate('shops')
              }}
            >
              <Icon name="link" size={14} />
              Open shop
            </Button>
          )}
        </div>

        {/* The full list, worst first. The table shows only the head of it. */}
        {device.reasons.length > 0 && (
          <ul className="reasons">
            {device.reasons.map((r) => (
              <li key={r.code}>
                <span className="dot" data-tone={severityTone(r.severity)} />
                {r.label}
              </li>
            ))}
          </ul>
        )}

        <dl className="kv-list">
          <KV k="Last seen" v={timeAgo(device.lastReportAt)} title={exact(device.lastReportAt)} />
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
      </DrawerSection>

      {/* Trends are the whole point of keeping history: a queue of 12 means
          nothing until you can see whether it was 3 an hour ago. */}
      <DrawerSection title="Last 48 hours">
        {history == null ? (
          <div className="skeleton" style={{ width: '60%' }} />
        ) : history.beats.length < 2 ? (
          <p className="muted small">
            Not enough beats yet — a terminal checks in about every three minutes, so trends fill in
            within the hour.
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
            {history.days.slice(0, 14).map((d) => (
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
      </DrawerSection>

      <DrawerSection title="Sync">
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
        </dl>
      </DrawerSection>

      <DrawerSection title="Install">
        <dl className="kv-list">
          <KV k="Version" v={<span className="mono">{device.appVersion ?? '—'}</span>} />
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
      </DrawerSection>

      <DrawerSection title={errors?.length ? `Errors (${errors.length})` : 'Errors'}>
        {loadError && <Notice>{loadError}</Notice>}
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
              <span className="err-msg">{e.message}</span>
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
      </DrawerSection>
    </Drawer>
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
