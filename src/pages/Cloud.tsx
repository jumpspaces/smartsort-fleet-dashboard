import * as api from '../api/endpoints.ts'
import type { CloudHealth } from '../api/types.ts'
import { Bars } from '../components/Bars.tsx'
import { Card, Empty, Live, Loadable, PageHeader, When } from '../components/ui.tsx'
import { useApi } from '../data.ts'
import { bytes, count, date, duration, exact } from '../lib/format.ts'

const LEVEL_TONE = { ok: 'healthy', warning: 'attention', critical: 'offline' } as const
const LEVEL_WORD = { ok: 'Fine', warning: 'Needs a look', critical: 'Act now' } as const
/** Figures two-up inside a card, rather than one tall column. */
const KV = { margin: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' } as const

/**
 * The cloud server itself — the one machine every till depends on and nothing
 * else on this console watches: its disk, its database, its nightly dumps and
 * whether they ever leave the box, which image it runs, its certificate.
 */
export function Cloud() {
  const q = useApi('cloud', (c, s) => api.cloudHealth(c, s), { every: 120_000 })
  return (
    <div className="stack">
      <PageHeader
        title="Cloud"
        sub="The server every till syncs to. The disk filling, a missed nightly backup and backups that never leave the server also raise alerts."
        actions={<Live updatedAt={q.updatedAt} busy={q.refreshing} />}
      />
      <Loadable q={q} rows={10}>
        {(h) => (
          <>
            <Warnings h={h} />
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              <Disk h={h} />
              <Backups h={h} />
              <Database h={h} />
              <Server h={h} />
            </div>
            <Growth h={h} />
          </>
        )}
      </Loadable>
    </div>
  )
}

function Warnings({ h }: { h: CloudHealth }) {
  if (h.warnings.length === 0) {
    return (
      <Card>
        <div className="row">
          <span className="badge healthy">All clear</span>
          <span className="small muted">
            Checked <When iso={h.checkedAt} />
          </span>
        </div>
      </Card>
    )
  }
  return (
    <Card title="Needs attention" flush>
      <ul className="list">
        {h.warnings.map((w) => (
          <li key={w.key} className="row" style={{ padding: '10px 16px', gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <span className={`badge ${LEVEL_TONE[w.level]}`} style={{ flex: 'none' }}>
              {LEVEL_WORD[w.level]}
            </span>
            <span style={{ minWidth: 0 }}>
              <strong>{w.title}</strong>
              <div className="small muted">{w.detail}</div>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Meter({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${pct}% used`}
      style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ink)' }} />
    </div>
  )
}

function Disk({ h }: { h: CloudHealth }) {
  const d = h.disk
  return (
    <Card title="Disk" actions={<span className={`badge ${LEVEL_TONE[h.diskLevel]}`}>{LEVEL_WORD[h.diskLevel]}</span>}>
      {!d ? (
        <Empty title="Couldn’t read the disk" />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <Meter used={d.totalBytes - d.freeBytes} total={d.totalBytes} />
          <dl className="kv" style={KV}>
            <div>
              <dt>Free</dt>
              <dd className="num">
                {bytes(d.freeBytes)} of {bytes(d.totalBytes)}
              </dd>
            </div>
            <div>
              <dt>Filling at</dt>
              <dd className="num">
                {h.runway.bytesPerDay == null ? 'Not enough days yet' : h.runway.bytesPerDay <= 0 ? 'Not filling' : `${bytes(h.runway.bytesPerDay)} a day`}
              </dd>
            </div>
            <div>
              <dt>Full in</dt>
              <dd className="num">{h.runway.fullInDays == null ? '—' : `about ${count(h.runway.fullInDays)} days`}</dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  )
}

function Backups({ h }: { h: CloudHealth }) {
  const b = h.backups
  return (
    <Card title="Database backups" sub={b.dir ? <span className="mono">{b.dir}</span> : 'Folder not mounted'}>
      {!b.visible ? (
        <Empty title="The server can’t see its backups">Mount the dump folder read-only and set CLOUD_BACKUP_DIR (server/DEPLOY.md §8).</Empty>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <dl className="kv" style={KV}>
            <div>
              <dt>Newest dump</dt>
              <dd>{b.newestAt ? <When iso={b.newestAt} /> : 'None'}</dd>
            </div>
            <div>
              <dt>Copied off the server</dt>
              <dd className={b.offsiteAt ? undefined : 'warn'}>{b.offsiteAt ? <When iso={b.offsiteAt} /> : 'Never marked'}</dd>
            </div>
            <div>
              <dt>Dumps kept</dt>
              <dd className="num">{b.files.length}</dd>
            </div>
          </dl>
          {b.files.length > 0 && (
            <details>
              <summary className="small">Every dump</summary>
              <table className="table">
                <tbody>
                  {b.files.map((f) => (
                    <tr key={f.name}>
                      <td className="mono small">{f.name}</td>
                      <td className="r num small">{bytes(f.bytes)}</td>
                      <td className="small sub" title={exact(f.modifiedAt)}>
                        {date(f.modifiedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </Card>
  )
}

function Database({ h }: { h: CloudHealth }) {
  const db = h.database
  const pending = db.migrations.shipped != null ? db.migrations.shipped - db.migrations.applied : 0
  return (
    <Card title="Database" sub={db.version ? `PostgreSQL ${db.version}` : undefined}>
      <div className="stack" style={{ gap: 10 }}>
        <dl className="kv" style={KV}>
          <div>
            <dt>Size</dt>
            <dd className="num">{bytes(db.bytes)}</dd>
          </div>
          <div>
            <dt>Connections</dt>
            <dd className="num">
              {db.connections} of {db.maxConnections}
            </dd>
          </div>
          <div>
            <dt>Migrations</dt>
            <dd className={pending > 0 ? 'warn' : undefined}>
              {db.migrations.applied} applied{pending > 0 ? `, ${pending} waiting` : ''}
              {db.migrations.lastAppliedAt && <div className="small muted">last {date(db.migrations.lastAppliedAt)}</div>}
            </dd>
          </div>
        </dl>
        <details>
          <summary className="small">Largest tables</summary>
          <table className="table">
            <tbody>
              {db.largest.map((t) => (
                <tr key={t.name}>
                  <td className="mono small">{t.name}</td>
                  <td className="r num small">{count(t.rows)} rows</td>
                  <td className="r num small">{bytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Card>
  )
}

function Server({ h }: { h: CloudHealth }) {
  const s = h.server
  const passAge = s.lastAlertPassAt ? Date.now() - Date.parse(s.lastAlertPassAt) : null
  return (
    <Card title="Server">
      <dl className="kv" style={KV}>
        <div>
          <dt>Image</dt>
          <dd className="mono">{s.imageTag ?? 'not set'}</dd>
        </div>
        <div>
          <dt>Up since</dt>
          <dd title={exact(s.startedAt)}>{date(s.startedAt)}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd className="num">{bytes(s.rssBytes)}</dd>
        </div>
        <div>
          <dt>Alert checks</dt>
          <dd className={passAge == null || passAge > 5 * 60_000 ? 'warn' : undefined}>
            {passAge == null ? 'Not run since start' : `last ${duration(passAge)} ago`}
          </dd>
        </div>
        <div>
          <dt>Node</dt>
          <dd className="mono">{s.node}</dd>
        </div>
        <div>
          <dt>Certificate</dt>
          <dd>
            {!h.cert ? (
              <span className="muted">Not checked here</span>
            ) : h.cert.validTo ? (
              <span title={exact(h.cert.validTo)}>Valid until {date(h.cert.validTo)}</span>
            ) : (
              <span className="warn">Couldn’t check: {h.cert.error}</span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  )
}

function Growth({ h }: { h: CloudHealth }) {
  const days = [...h.history].reverse()
  if (days.length < 2) return null
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      <Card title="Database size, by day">
        <Bars label="Database size by day" points={days.map((d) => ({ key: d.day, value: d.dbBytes, label: d.day }))} format={(n) => bytes(n)} />
      </Card>
      <Card title="Free disk, by day">
        <Bars label="Free disk by day" points={days.map((d) => ({ key: d.day, value: d.diskFreeBytes, label: d.day }))} format={(n) => bytes(n)} />
      </Card>
    </div>
  )
}
