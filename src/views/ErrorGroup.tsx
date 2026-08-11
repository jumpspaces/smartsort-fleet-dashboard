/**
 * One fault across the whole fleet, as a page of its own.
 *
 * The thing an operator reads here is a stack trace, which is the single widest
 * piece of content in the console and was being folded into a 600px drawer. The
 * page also loads the group by fingerprint rather than picking it out of the
 * list behind it — a link to a fault has to open whether or not the current
 * filter would have listed it, which the drawer silently could not do.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Api, ErrorGroupRow, GroupDevice, GroupStatus } from '../api.ts'
import type { Navigate } from '../App.tsx'
import {
  Button,
  Card,
  Chip,
  Columns,
  CopyButton,
  KV,
  Notice,
  PageHead,
  TableSkeleton,
} from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'
import { GROUP_STATUS_LABEL, GROUP_STATUS_TONE } from '../lib/state.ts'

export function ErrorGroup({
  api,
  fingerprint,
  reloadKey,
  onNavigate,
  onBack,
}: {
  api: Api
  fingerprint: string
  reloadKey: number
  onNavigate: Navigate
  onBack: () => void
}) {
  const [group, setGroup] = useState<ErrorGroupRow | null>(null)
  const [devices, setDevices] = useState<GroupDevice[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fixVersion, setFixVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const g = await api.errorGroup(fingerprint)
      setGroup(g)
      // Only seed the field the first time: re-seeding on every poll would
      // overwrite a version being typed.
      setFixVersion((cur) => cur ?? g.lastVersion ?? '')
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this error')
    }
  }, [api, fingerprint])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    let live = true
    api
      .groupDevices(fingerprint)
      .then((d) => live && setDevices(d))
      .catch(() => live && setDevices([]))
    return () => {
      live = false
    }
  }, [api, fingerprint, reloadKey])

  async function act(next: GroupStatus) {
    setBusy(true)
    setError(null)
    try {
      await api.setGroupStatus(
        fingerprint,
        next,
        next === 'resolved' ? (fixVersion ?? '').trim() || null : null,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this error')
    } finally {
      setBusy(false)
    }
  }

  const back = { label: 'Errors', onClick: onBack }

  if (!group) {
    return (
      <>
        <PageHead back={back} title={loadError ? 'Error' : 'Loading…'} />
        {loadError ? <Notice>{loadError}</Notice> : <TableSkeleton rows={4} />}
      </>
    )
  }

  return (
    <>
      <PageHead
        back={back}
        title={group.message}
        subtitle={<span className="mono">{group.fingerprint.slice(0, 16)}</span>}
        actions={<CopyButton value={group.message} label="Copy message" size="md" />}
      />

      {loadError && <Notice>{loadError}</Notice>}

      <Columns
        main={
          <>
            <Card title="Triage">
              <div className="card-status">
                <Chip tone={GROUP_STATUS_TONE[group.status]}>
                  {GROUP_STATUS_LABEL[group.status]}
                </Chip>
                {group.regressedAt && <Chip tone="bad">Regressed {timeAgo(group.regressedAt)}</Chip>}
              </div>

              {error && <Notice>{error}</Notice>}

              {group.status === 'open' ? (
                <div className="triage">
                  <label className="field">
                    <span>Fixed in version</span>
                    <input
                      className="input mono"
                      value={fixVersion ?? ''}
                      onChange={(e) => setFixVersion(e.target.value)}
                      placeholder="1.5.2"
                    />
                    <span className="hint">
                      A terminal on this build or newer hitting it again re-opens this as a
                      regression. Older builds still hitting it are expected, and stay quiet.
                    </span>
                  </label>
                  <div className="form-actions">
                    <Button variant="primary" busy={busy} onClick={() => void act('resolved')}>
                      Mark resolved
                    </Button>
                    <Button variant="ghost" busy={busy} onClick={() => void act('ignored')}>
                      Ignore
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="form-actions">
                  <Button variant="primary" busy={busy} onClick={() => void act('open')}>
                    Re-open
                  </Button>
                  <span className="hint">
                    {group.status === 'resolved'
                      ? `Marked fixed${group.resolvedInVersion ? ` in ${group.resolvedInVersion}` : ''} ${timeAgo(group.resolvedAt)}` +
                        `${group.resolvedByLabel ? ` by ${group.resolvedByLabel}` : ''}.`
                      : 'Ignored errors never count against terminal health.'}
                  </span>
                </div>
              )}
            </Card>

            {group.stack && (
              <Card title="Stack" actions={<CopyButton value={group.stack} label="Copy stack" />}>
                <pre className="stack">{group.stack}</pre>
              </Card>
            )}

            <Card title={devices?.length ? `Terminals (${devices.length})` : 'Terminals'}>
              {devices == null ? (
                <div className="skeleton" style={{ width: '50%' }} />
              ) : devices.length === 0 ? (
                <p className="muted small">
                  No terminal rows — this fault’s devices have been pruned.
                </p>
              ) : (
                <ul className="plain-list">
                  {devices.map((d) => (
                    <li key={d.deviceId}>
                      <button
                        type="button"
                        className="row-open mono"
                        onClick={() => onNavigate('device', { id: d.deviceId })}
                      >
                        {d.deviceId.slice(0, 16)}
                      </button>
                      <span className="muted small">
                        ×{d.count} · v{d.appVersion ?? '?'} · last{' '}
                        <span title={exact(d.lastSeen)}>{timeAgo(d.lastSeen)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        }
        side={
          <Card title="Detail">
            <dl className="kv-list">
              <KV k="Source" v={group.source ?? '—'} />
              <KV k="Terminals affected" v={String(group.deviceCount)} />
              <KV k="Total events" v={group.totalCount.toLocaleString()} />
              <KV k="First seen" v={timeAgo(group.firstSeen)} title={exact(group.firstSeen)} />
              <KV k="Last seen" v={timeAgo(group.lastSeen)} title={exact(group.lastSeen)} />
              <KV k="First build" v={<span className="mono">{group.firstVersion ?? '—'}</span>} />
              <KV k="Latest build" v={<span className="mono">{group.lastVersion ?? '—'}</span>} />
            </dl>
          </Card>
        }
      />
    </>
  )
}
