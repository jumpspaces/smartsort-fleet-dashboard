import { useEffect, useState } from 'react'
import { getErrors, Unauthorized, type DeviceRow, type ErrorRow } from '../api.ts'
import {
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
import { attentionReason, fleetState, STATE_LABEL, TONE } from '../lib/state.ts'

export function DeviceDrawer({
  apiBase,
  token,
  device,
  errorCount,
  onClose,
  onUnauthorized,
}: {
  apiBase: string
  token: string
  device: DeviceRow
  errorCount: number
  onClose: () => void
  onUnauthorized: () => void
}) {
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getErrors(apiBase, token, device.deviceId)
      .then((r) => live && setErrors(r.errors))
      .catch((e) => {
        if (!live) return
        if (e instanceof Unauthorized) return onUnauthorized()
        setLoadError(e instanceof Error ? e.message : 'Could not load this terminal’s errors')
      })
    return () => {
      live = false
    }
  }, [apiBase, token, device.deviceId, onUnauthorized])

  const state = fleetState(device, errorCount)
  const reason = attentionReason(device, errorCount)

  return (
    <Drawer
      title={device.shopName ?? 'Unclaimed terminal'}
      subtitle={<span className="mono">{device.deviceId}</span>}
      onClose={onClose}
    >
      <DrawerSection title="Status">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Status tone={TONE[state]} label={STATE_LABEL[state]} />
          {reason && <span className="muted small">· {reason}</span>}
          <CopyButton value={device.deviceId} label="Copy device ID" />
        </div>
        <dl className="kv-list">
          <KV k="Last seen" v={timeAgo(device.lastReportAt)} title={exact(device.lastReportAt)} />
          <KV k="First seen" v={timeAgo(device.firstReportAt)} title={exact(device.firstReportAt)} />
          <KV
            k="App uptime"
            v={device.appUptimeSec != null ? duration(device.appUptimeSec * 1000) : '—'}
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
        </dl>
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
