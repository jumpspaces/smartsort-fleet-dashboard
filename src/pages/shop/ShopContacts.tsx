import { useState, type FormEvent } from 'react'
import * as api from '../../api/endpoints.ts'
import type { ContactKind } from '../../api/types.ts'
import { ActionError, ConfirmButton, Field } from '../../components/forms.tsx'
import { Card, Empty, Loadable, Segmented } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { ago, date, exact } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

const KIND_LABEL: Record<ContactKind, string> = { call: 'Call', visit: 'Visit', message: 'Message', note: 'Note' }
const FOLLOW: { value: string; label: string; days: number | null }[] = [
  { value: 'none', label: 'No follow-up', days: null },
  { value: '1', label: 'Tomorrow', days: 1 },
  { value: '3', label: 'In 3 days', days: 3 },
  { value: '7', label: 'In a week', days: 7 },
  { value: '30', label: 'In a month', days: 30 },
]

/** Our calls, visits and messages with this shop, and what we promised them. */
export function ShopContacts({ shopId }: { shopId: string }) {
  const { client, canAct, session } = useSession()
  const q = useApi(`contacts:${shopId}`, (c, s) => api.shopContacts(c, shopId, s))
  const [kind, setKind] = useState<ContactKind>('call')
  const [summary, setSummary] = useState('')
  const [follow, setFollow] = useState('none')
  const refresh = () => {
    invalidate('contacts')
    invalidate('accounts')
    invalidate('calendar')
  }
  const add = useAction(async () => {
    const days = FOLLOW.find((f) => f.value === follow)?.days ?? null
    // Due at 9:00 on the day, not at whatever time it was logged.
    const followUpAt = days == null ? null : (() => {
      const d = new Date(Date.now() + days * 86_400_000)
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    })()
    await api.addShopContact(client, shopId, { kind, summary: summary.trim(), followUpAt })
    setSummary('')
    setFollow('none')
    refresh()
  })
  const done = useAction(async (id: string) => {
    await api.completeFollowUp(client, id)
    refresh()
  })
  const remove = useAction(async (id: string) => {
    await api.deleteShopContact(client, shopId, id)
    refresh()
  })

  return (
    <div className="stack">
      {canAct && (
        <Card title="Log a contact" sub="So whoever speaks to them next knows what was said, and what we promised.">
          <form
            className="stack"
            style={{ gap: 10 }}
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (summary.trim()) void add.run()
            }}
          >
            <Segmented
              label="Kind"
              value={kind}
              onChange={setKind}
              options={(Object.keys(KIND_LABEL) as ContactKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
            <Field label="What happened" id="contact-summary">
              <textarea
                id="contact-summary"
                className="textarea"
                rows={3}
                maxLength={2000}
                placeholder="e.g. Owner says the receipt printer jams after lunch. Promised to send someone Thursday."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Field>
            <div className="row">
              <select className="select" aria-label="Follow up" value={follow} onChange={(e) => setFollow(e.target.value)}>
                {FOLLOW.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn sm primary" disabled={!summary.trim() || add.pending} style={{ marginLeft: 'auto' }}>
                Save
              </button>
            </div>
            <ActionError error={add.error} />
          </form>
        </Card>
      )}
      <Card title="Contact log" flush>
        <ActionError error={done.error ?? remove.error} />
        <Loadable q={q} rows={4}>
          {(list) =>
            list.length === 0 ? (
              <Empty title="Nothing logged yet">Calls, visits and promises to this shop show here.</Empty>
            ) : (
              <ul className="list">
                {list.map((c) => {
                  const open = c.followUpAt && !c.doneAt
                  const late = open && Date.parse(c.followUpAt!) < Date.now()
                  return (
                    <li key={c.id} style={{ padding: '10px 16px' }}>
                      <div className="spread" style={{ gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="small sub">
                            <span className="badge neutral">{KIND_LABEL[c.kind]}</span> {c.createdByLabel ?? '—'} ·{' '}
                            <span title={exact(c.createdAt)}>{ago(c.createdAt)}</span>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{c.summary}</div>
                          {c.followUpAt && (
                            <div className={`small ${c.doneAt ? 'muted' : late ? 'warn' : 'sub'}`} style={{ marginTop: 4 }}>
                              {c.doneAt
                                ? `Followed up ${date(c.doneAt)}${c.doneByLabel ? ` by ${c.doneByLabel}` : ''}`
                                : `${late ? 'Follow-up was due' : 'Follow up'} ${date(c.followUpAt)}`}
                            </div>
                          )}
                        </div>
                        {canAct && (
                          <span className="row" style={{ flex: 'none' }}>
                            {open && (
                              <button className="btn sm" disabled={done.pending} onClick={() => void done.run(c.id)}>
                                Done
                              </button>
                            )}
                            {(c.createdBy === session.operator.id || session.operator.role === 'admin') && (
                              <ConfirmButton confirm="Delete" danger onConfirm={() => void remove.run(c.id)}>
                                Delete
                              </ConfirmButton>
                            )}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}
