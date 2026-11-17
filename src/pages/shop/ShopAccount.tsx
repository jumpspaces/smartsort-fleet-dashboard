import { useState, type FormEvent } from 'react'
import * as api from '../../api/endpoints.ts'
import type { Shop, SubscriptionView } from '../../api/types.ts'
import { ActionError, Dialog, Field } from '../../components/forms.tsx'
import { Card, Empty, Loadable } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { saveFile } from '../../lib/csv.ts'
import { ago, date, money } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { href } from '../../lib/router.ts'
import { useSession } from '../../lib/session.tsx'
import { SUBSCRIPTION_LABEL, SUBSCRIPTION_TONE } from '../Accounts.tsx'

/** "150", "150.5", "150.50" → pesewas, exactly; null if it isn't an amount. Never through a float. */
export function toPesewas(text: string): number | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text.replace(/,/g, ''))
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}
const cedis = (pesewas: number) => `${Math.floor(pesewas / 100)}.${String(pesewas % 100).padStart(2, '0')}`
const day = (iso: string) => iso.slice(0, 10)

/** The shop as our customer: what it pays, its payments, a reminder, and its monthly report. */
export function ShopAccount({ shop }: { shop: Shop }) {
  const q = useApi(`subscription:${shop.id}`, (c, s) => api.shopSubscription(c, shop.id, s))
  return (
    <div className="stack">
      <Loadable q={q} rows={4}>
        {(view) => (
          <>
            <SubscriptionCard shop={shop} view={view} />
            <Payments shop={shop} view={view} />
          </>
        )}
      </Loadable>
      <MonthlyReport shop={shop} />
    </div>
  )
}

const refresh = () => {
  invalidate('subscription')
  invalidate('accounts')
  invalidate('calendar')
  invalidate('contacts')
}

function SubscriptionCard({ shop, view }: { shop: Shop; view: SubscriptionView }) {
  const { client, canAct } = useSession()
  const [editing, setEditing] = useState(false)
  const remind = useAction(async () => {
    await api.remindShopOwner(client, shop.id)
    refresh()
  })
  const s = view.subscription
  return (
    <Card
      title="Subscription"
      actions={
        canAct ? (
          <button className="btn sm" onClick={() => setEditing(true)}>
            {s ? 'Change' : 'Set up'}
          </button>
        ) : undefined
      }
    >
      {s ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className={`badge ${SUBSCRIPTION_TONE[view.state]}`}>{SUBSCRIPTION_LABEL[view.state]}</span>
            <strong>{s.plan}</strong>
            <span className="sub">
              {money(s.amountPesewas, shop.currency)} a {s.every}
            </span>
          </div>
          <div>
            Paid until <strong>{date(s.paidUntil)}</strong>
            <span className="small muted"> · reminders start {s.remindDays} days before</span>
          </div>
          <div className="small sub">
            Pays for:{' '}
            {view.features.length ? view.features.join(', ') : 'the basic till'} —{' '}
            <a href={href(`/shops/${encodeURIComponent(shop.id)}`, { tab: 'features' })}>features</a>
          </div>
          {s.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</div>}
          {canAct && view.state !== 'paid' && (
            <div className="row">
              <button className="btn sm" disabled={remind.pending} onClick={() => void remind.run()}>
                Remind the owner on their phone
              </button>
              {s.lastRemindedAt && <span className="small muted">Last reminded {ago(s.lastRemindedAt)}</span>}
            </div>
          )}
          <ActionError error={remind.error} />
        </div>
      ) : (
        <Empty title="No subscription set up">Set one up to track what this shop pays and when it's due.</Empty>
      )}
      <EditSubscription open={editing} onClose={() => setEditing(false)} shop={shop} view={view} />
    </Card>
  )
}

function EditSubscription({ open, onClose, shop, view }: { open: boolean; onClose: () => void; shop: Shop; view: SubscriptionView }) {
  const { client } = useSession()
  const s = view.subscription
  const [plan, setPlan] = useState(s?.plan ?? 'Standard')
  const [amount, setAmount] = useState(s ? cedis(s.amountPesewas) : '')
  const [every, setEvery] = useState<'month' | 'year'>(s?.every ?? 'month')
  const [paidUntil, setPaidUntil] = useState(s ? day(s.paidUntil) : day(new Date().toISOString()))
  const [remindDays, setRemindDays] = useState(String(s?.remindDays ?? 7))
  const [notes, setNotes] = useState(s?.notes ?? '')
  const pesewas = toPesewas(amount)
  const save = useAction(async () => {
    await api.setShopSubscription(client, shop.id, {
      plan: plan.trim(),
      amountPesewas: pesewas!,
      every,
      paidUntil: new Date(`${paidUntil}T23:59:59`).toISOString(),
      remindDays: Number(remindDays),
      notes: notes.trim() || null,
    })
    refresh()
    onClose()
  })
  return (
    <Dialog open={open} onClose={onClose} title={s ? 'Change the subscription' : 'Set up a subscription'}>
      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (plan.trim() && pesewas != null) void save.run()
        }}
      >
        <Field label="Plan" id="sub-plan">
          <input id="sub-plan" className="input" maxLength={80} value={plan} onChange={(e) => setPlan(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={`Amount (${shop.currency})`} id="sub-amount">
            <input id="sub-amount" className="input" inputMode="decimal" placeholder="150.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Every" id="sub-every">
            <select id="sub-every" className="select" value={every} onChange={(e) => setEvery(e.target.value as 'month' | 'year')}>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Paid until" id="sub-until">
            <input id="sub-until" className="input" type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
          </Field>
          <Field label="Remind this many days before" id="sub-remind">
            <input id="sub-remind" className="input" inputMode="numeric" value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Field label="Notes (optional)" id="sub-notes">
          <textarea id="sub-notes" className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {amount && pesewas == null && <div className="small warn">Enter the amount in {shop.currency}, like 150 or 150.50.</div>}
        <ActionError error={save.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={!plan.trim() || pesewas == null || save.pending}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function Payments({ shop, view }: { shop: Shop; view: SubscriptionView }) {
  const { client, canAct } = useSession()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('MoMo')
  const [reference, setReference] = useState('')
  const pesewas = toPesewas(amount)
  const record = useAction(async () => {
    await api.recordShopPayment(client, shop.id, { amountPesewas: pesewas!, method, reference: reference.trim() || null })
    setReference('')
    setOpen(false)
    refresh()
  })
  if (!view.subscription) return null
  return (
    <Card
      title="Payments"
      flush
      actions={
        canAct ? (
          <button
            className="btn sm primary"
            onClick={() => {
              // What they usually pay, as it stands now — not as it stood when this card first drew.
              setAmount(cedis(view.subscription!.amountPesewas))
              setOpen(true)
            }}
          >
            Record a payment
          </button>
        ) : undefined
      }
    >
      {view.payments.length === 0 ? (
        <Empty title="No payments recorded" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Paid</th>
                <th className="r">Amount</th>
                <th>How</th>
                <th>Covers until</th>
              </tr>
            </thead>
            <tbody>
              {view.payments.map((p) => (
                <tr key={p.id}>
                  <td className="sub">{date(p.paidAt)}</td>
                  <td className="r num">{money(p.amountPesewas, shop.currency)}</td>
                  <td>
                    {p.method ?? '—'}
                    {p.reference && <div className="small muted mono">{p.reference}</div>}
                  </td>
                  <td className="sub">{date(p.coversUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a payment">
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (pesewas) void record.run()
          }}
        >
          <Field label={`Amount (${shop.currency})`} id="pay-amount" hint={`Pays for one more ${view.subscription.every} on from ${date(view.subscription.paidUntil)}.`}>
            <input id="pay-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="grid-2">
            <Field label="How" id="pay-method">
              <select id="pay-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                {['MoMo', 'Cash', 'Bank transfer', 'Cheque'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Reference (optional)" id="pay-ref">
              <input id="pay-ref" className="input" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
          {amount && !pesewas && <div className="small warn">Enter the amount in {shop.currency}, like 150 or 150.50.</div>}
          <ActionError error={record.error} />
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={!pesewas || record.pending}>
              Record
            </button>
          </div>
        </form>
      </Dialog>
    </Card>
  )
}

/** Last month's, by default: the one an owner would ask about. */
function lastMonth(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthlyReport({ shop }: { shop: Shop }) {
  const { client } = useSession()
  const [month, setMonth] = useState(lastMonth)
  const get = useAction(async () => {
    const file = await api.monthlyReport(client, shop.id, month)
    saveFile(file.filename, file.blob)
  })
  return (
    <Card title="Monthly report" sub="A month of this shop's tills for the owner, as a PDF: how much they were online, whether sales reached the cloud the same day, backups and sales seen.">
      <div className="row">
        <input className="input" type="month" aria-label="Month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
        <button className="btn sm" disabled={!month || get.pending} onClick={() => void get.run()}>
          {get.pending ? 'Making…' : 'Download PDF'}
        </button>
      </div>
      <ActionError error={get.error} />
    </Card>
  )
}
