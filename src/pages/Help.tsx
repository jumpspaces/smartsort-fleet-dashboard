import { useState, type ReactNode } from 'react'
import * as api from '../api/endpoints.ts'
import type { HelpRequest, HelpRequestDetail, HelpStatus } from '../api/types.ts'
import { ActionError, ConfirmButton, Field } from '../components/forms.tsx'
import { Card, Empty, Live, Loadable, PageHeader, Segmented, When } from '../components/ui.tsx'
import { useApi, useShopIndex } from '../data.ts'
import { bytes, date, exact } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { helpHref, href, shopHref, tillHref, useSetParams } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'

const STATUS_LABEL: Record<HelpStatus, string> = { open: 'Waiting', answered: 'Answered', closed: 'Closed' }
const STATUS_TONE: Record<HelpStatus, string> = { open: 'attention', answered: 'healthy', closed: 'neutral' }
const TABS = ['open', 'answered', 'closed', 'all'] as const
type Tab = (typeof TABS)[number]

const who = (r: HelpRequest) =>
  [r.requesterName ?? 'Someone', r.requesterRole === 'owner' ? 'owner' : r.requesterRole === 'cashier' ? 'cashier' : null]
    .filter(Boolean)
    .join(', ')

/**
 * Help requests sent from a till or the phone app. Waiting ones first, the
 * longest-waiting at the top. A request from a till arrives with that till's
 * state and its logs on the way.
 */
export function Help({ params }: { params: URLSearchParams }) {
  const setParams = useSetParams()
  const raw = params.get('status') ?? 'open'
  const status: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'open'
  const shopId = params.get('shopId') ?? undefined
  const shops = useShopIndex()
  const q = useApi(`help:${status}:${shopId ?? ''}`, (c, s) => api.helpRequests(c, { status, shopId }, s), { every: 30_000 })

  return (
    <div className="stack">
      <PageHeader
        title="Help requests"
        sub="Sent from a till or the phone app. Reply here and they see it in the app; a till's request brings its state and logs."
        actions={<Live updatedAt={q.updatedAt} busy={q.refreshing} />}
      />
      <div className="spread">
        <Segmented
          label="Status"
          value={status}
          onChange={(v) => setParams({ status: v === 'open' ? null : v })}
          options={[
            { value: 'open', label: 'Waiting', n: q.data?.counts.open },
            { value: 'answered', label: 'Answered', n: q.data?.counts.answered },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        {shopId && (
          <span className="row small">
            Only {shops.get(shopId)?.name ?? 'one shop'}
            <button className="btn sm ghost" onClick={() => setParams({ shopId: null })}>
              Show every shop
            </button>
          </span>
        )}
      </div>
      <Card flush>
        <Loadable q={q} rows={6}>
          {({ requests }) =>
            requests.length === 0 ? (
              <Empty title={status === 'open' ? 'Nobody is waiting on us' : 'No requests here'} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asked</th>
                      <th>Shop</th>
                      <th>Who</th>
                      <th>Message</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} data-nav className="link" onClick={() => (location.hash = helpHref(r.id))}>
                        <td className="sub nowrap">
                          <When iso={r.createdAt} />
                        </td>
                        <td className="nowrap">{r.shopName ?? '—'}</td>
                        <td className="nowrap">
                          {who(r)}
                          <div className="small muted">{r.source === 'till' ? 'From a till' : 'From the phone app'}</div>
                        </td>
                        <td className="primary-cell" style={{ maxWidth: 480 }}>
                          <a href={helpHref(r.id)} style={{ overflowWrap: 'anywhere' }}>
                            {r.message.length > 140 ? `${r.message.slice(0, 137)}…` : r.message}
                          </a>
                        </td>
                        <td>
                          <span className={`badge ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}

export function HelpRequestPage({ id }: { id: string }) {
  const q = useApi(`help:detail:${id}`, (c, s) => api.helpRequest(c, id, s), { every: 10_000 })
  const back = { href: href('/help'), label: 'Help requests' }
  return (
    <Loadable q={q} rows={8}>
      {(r) => (
        <div className="stack">
          <PageHeader
            back={back}
            title={`${r.shopName ?? 'A shop'} asked for help`}
            sub={
              <>
                {who(r)} · {r.source === 'till' ? `from ${r.tillName ?? 'a till'}` : 'from the phone app'} ·{' '}
                <span title={exact(r.createdAt)}>{date(r.createdAt)}</span>
              </>
            }
            actions={<span className={`badge ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>}
          />
          <Card title="What they said">
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.message}</p>
            <dl className="kv" style={{ marginTop: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              <div>
                <dt>Shop</dt>
                <dd>
                  <a href={shopHref(r.shopId)}>{r.shopName ?? r.shopId}</a>
                  {r.shopCode && <div className="small muted mono">{r.shopCode}</div>}
                </dd>
              </div>
              <div>
                <dt>Call back on</dt>
                <dd>{r.callbackPhone ? <a href={`tel:${r.callbackPhone}`}>{r.callbackPhone}</a> : '—'}</dd>
              </div>
              <div>
                <dt>Where in the app</dt>
                <dd>{r.screen ?? '—'}</dd>
              </div>
              {r.deviceId && (
                <div>
                  <dt>Till</dt>
                  <dd>
                    <a href={tillHref(r.deviceId)}>{r.tillName ?? r.deviceId.slice(0, 12)}</a>
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          <Reply r={r} />
          {r.snapshot && <Snapshot r={r} />}
          {(r.logs || r.logsNote) && <Logs r={r} />}
        </div>
      )}
    </Loadable>
  )
}

function Reply({ r }: { r: HelpRequestDetail }) {
  const { client, canAct } = useSession()
  const [text, setText] = useState('')
  const [pushed, setPushed] = useState<boolean | null>(null)
  const send = useAction(async () => {
    const res = await api.replyToHelp(client, r.id, text.trim())
    setText('')
    setPushed(res.pushed ?? null)
    invalidate('help')
    invalidate('overview')
  })
  const status = useAction(async (next: 'open' | 'closed') => {
    await api.setHelpStatus(client, r.id, next)
    invalidate('help')
    invalidate('overview')
  })
  return (
    <Card
      title="Our reply"
      sub="Shown to them in the app they asked from. An owner who asked from the phone also gets a notification."
      actions={
        canAct &&
        (r.status === 'closed' ? (
          <button className="btn sm" disabled={status.pending} onClick={() => void status.run('open')}>
            Reopen
          </button>
        ) : (
          <ConfirmButton confirm="Close it" onConfirm={() => void status.run('closed')}>
            Close without replying
          </ConfirmButton>
        ))
      }
    >
      <div className="stack">
        {r.reply && (
          <div className="notice" style={{ display: 'block' }}>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.reply}</p>
            <div className="small muted" style={{ marginTop: 6 }}>
              {r.repliedByLabel ?? 'Someone'} · <When iso={r.repliedAt} />
            </div>
          </div>
        )}
        {r.closedAt && (
          <div className="small muted">
            Closed by {r.closedByLabel ?? 'someone'} <When iso={r.closedAt} />
          </div>
        )}
        {pushed === false && r.source === 'phone' && (
          <div className="small muted">Saved. Their phone didn’t take a notification, so they’ll see it next time they open Help.</div>
        )}
        {canAct && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) void send.run()
            }}
          >
            <Field label={r.reply ? 'Replace the reply' : 'Reply'} id="help-reply">
              <textarea
                id="help-reply"
                className="input"
                rows={4}
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Plain words — they read this at the counter."
              />
            </Field>
            <ActionError error={send.error ?? status.error} />
            <div className="form-actions">
              <button className="btn primary" disabled={!text.trim() || send.pending}>
                {send.pending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}

function Snapshot({ r }: { r: HelpRequestDetail }) {
  const s = r.snapshot!
  const items: [string, ReactNode][] = [
    ['Version', s.appVersion ?? '—'],
    ['Last check-in', <When key="c" iso={s.lastReportAt} />],
    ['Local server', s.serverHealthy == null ? '—' : s.serverHealthy ? 'Running' : 'Down'],
    ['Sales waiting to send', s.syncPending ?? '—'],
    ['Failed to send', s.syncFailed ?? '—'],
    ['Last sent', <When key="s" iso={s.lastSyncAt} />],
    ['Last received', <When key="p" iso={s.lastPulledAt} />],
    ['Disk free', bytes(s.diskFreeBytes)],
    ['Last backup', <When key="b" iso={s.lastBackupAt} />],
    ['Locked by us', s.locked ? 'Yes' : 'No'],
  ]
  return (
    <Card title="The till when they asked" sub={r.deviceId ? <a href={tillHref(r.deviceId)}>Open the till as it is now</a> : undefined}>
      <dl className="kv" style={{ margin: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function Logs({ r }: { r: HelpRequestDetail }) {
  const l = r.logs
  return (
    <Card title="Its logs" sub="Asked for when the request arrived.">
      {!l ? (
        <div className="small muted">Not collected: {r.logsNote}</div>
      ) : l.state === 'pending' || l.state === 'sent' ? (
        <div className="small muted">Waiting for the till to send them — it does at its next check-in.</div>
      ) : l.ok ? (
        <pre className="mono small" style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>
          {l.result || '(empty)'}
        </pre>
      ) : (
        <div className="small muted">
          The till couldn’t send them{l.error ? `: ${l.error}` : ''} ({l.state}).
        </div>
      )}
    </Card>
  )
}
