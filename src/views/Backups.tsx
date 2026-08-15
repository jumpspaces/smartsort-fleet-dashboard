/**
 * The backup register.
 *
 * A shop's entire trading history lives in one embedded database, on one machine
 * under a counter. The cloud holds a replica of what has SYNCED, which is not
 * the same thing: a till offline since Thursday has three days of takings that
 * exist in exactly one place. Until this page there was no answer to "when did
 * that machine last take a copy of itself", for any terminal in the field.
 *
 * Sorted worst first — never backed up, then oldest — because the list exists to
 * be read from the top and stopped at, not browsed.
 */
import { useEffect, useState } from 'react'
import type { Api, BackupTerminal } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Button, Card, Chip, Empty, Notice, TableSkeleton } from '../components/ui.tsx'
import { ageMs, bytes, exact, timeAgo } from '../lib/format.ts'

/** Past this, a backup is old enough to be worth saying so. */
const STALE_MS = 48 * 60 * 60 * 1000

export function Backups({
  api,
  reloadKey,
  onNavigate,
}: {
  api: Api
  reloadKey: number
  onNavigate: Navigate
}) {
  const [rows, setRows] = useState<BackupTerminal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const canAct = api.operator.role !== 'viewer'

  useEffect(() => {
    void api
      .backups()
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load the register'),
      )
  }, [api, reloadKey])

  async function backupNow(deviceId: string) {
    setBusy(deviceId)
    setError(null)
    try {
      await api.issueCommand(deviceId, 'backup.now', {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue that backup')
    } finally {
      setBusy(null)
    }
  }

  const never = rows?.filter((r) => !r.lastBackupAt).length ?? 0
  const stale = rows?.filter((r) => r.lastBackupAt && ageMs(r.lastBackupAt) > STALE_MS).length ?? 0
  const failing = rows?.filter((r) => r.backupError).length ?? 0

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Backups</h1>
          <p className="view-sub">
            Every terminal that keeps its own database, and when it last took a copy of itself.
          </p>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {rows && rows.length > 0 && (
        <div className="kpis">
          <div className="kpi">
            <span className="kpi-label">Never backed up</span>
            <span className="kpi-value">{never}</span>
            <span className="kpi-note">
              {never === 0 ? 'Every till has a copy' : 'These have one copy of their history'}
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Older than 48h</span>
            <span className="kpi-value">{stale}</span>
            <span className="kpi-note">Machines that have been off, or are failing quietly</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Failing</span>
            <span className="kpi-value">{failing}</span>
            <span className="kpi-note">The terminal tried and could not</span>
          </div>
        </div>
      )}

      <Card title="Register">
        {rows == null ? (
          <TableSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <Empty icon="shield" title="No terminals keep their own database">
            Only the machines running the bundled build have something to back up. An extra till on
            a shop's network sells through the host and has no database of its own.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Last backup</th>
                  <th className="col-num">Backup size</th>
                  <th className="col-num">Database</th>
                  <th className="col-num">Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const age = r.lastBackupAt ? ageMs(r.lastBackupAt) : null
                  return (
                    <tr
                      key={r.deviceId}
                      data-clickable="true"
                      onClick={() => onNavigate('device', { id: r.deviceId })}
                    >
                      <td>
                        <span className="strong">{r.shopName ?? 'Unclaimed terminal'}</span>
                        <div className="row-sub mono">{r.deviceId.slice(0, 12)}</div>
                      </td>
                      <td>
                        {r.backupError ? (
                          <>
                            <Chip tone="bad">Failing</Chip>
                            <div className="row-sub">{r.backupError}</div>
                          </>
                        ) : !r.lastBackupAt ? (
                          <Chip tone="bad">Never</Chip>
                        ) : age! > STALE_MS ? (
                          <>
                            <Chip tone="warn">{timeAgo(r.lastBackupAt)}</Chip>
                            <div className="row-sub" title={exact(r.lastBackupAt)}>
                              {exact(r.lastBackupAt)}
                            </div>
                          </>
                        ) : (
                          <span title={exact(r.lastBackupAt)}>{timeAgo(r.lastBackupAt)}</span>
                        )}
                      </td>
                      <td className="col-num muted">{bytes(r.backupSizeBytes)}</td>
                      <td className="col-num muted">{bytes(r.dbSizeBytes)}</td>
                      <td className="col-num muted" title={exact(r.lastReportAt)}>
                        {timeAgo(r.lastReportAt)}
                      </td>
                      <td style={{ width: 1 }}>
                        {canAct && (
                          <Button
                            size="sm"
                            variant="ghost"
                            busy={busy === r.deviceId}
                            onClick={(e) => {
                              e.stopPropagation()
                              void backupNow(r.deviceId)
                            }}
                          >
                            Back up now
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Terminals snapshot themselves twice a day and keep the last seven. “Back up now” rides the
          next check-in, so allow about three minutes.
        </p>
      </Card>
    </>
  )
}
