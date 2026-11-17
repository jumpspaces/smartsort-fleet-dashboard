import { useState } from 'react'
import * as api from '../../api/endpoints.ts'
import type { ClosureView, Shop } from '../../api/types.ts'
import { Field } from '../../components/forms.tsx'
import { StepUpDialog } from '../../components/StepUpDialog.tsx'
import { Card, ErrorNote, Loadable } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { saveFile } from '../../lib/csv.ts'
import { count, date, exact, plural, until } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

/**
 * When we stop working with a shop: hand the owner their data, close it, and —
 * after 30 days and a second operator's yes — delete it from the server.
 */
export function ShopClosure({ shop }: { shop: Shop }) {
  const q = useApi(`closure:${shop.id}`, (c, s) => api.shopClosure(c, shop.id, s))
  return (
    <Loadable q={q} rows={4}>
      {(view) => (
        <div className="stack">
          <ExportCard shop={shop} view={view} />
          {view.status === 'closed' ? <ClosedCard shop={shop} view={view} /> : <CloseCard shop={shop} view={view} />}
        </div>
      )}
    </Loadable>
  )
}

const refresh = () => {
  invalidate('closure')
  invalidate('closures')
  invalidate('shops')
  invalidate('devices')
}

function ExportCard({ shop, view }: { shop: Shop; view: ClosureView }) {
  const { client, canAct } = useSession()
  const [open, setOpen] = useState(false)
  const exported = view.closure?.status === 'closed' ? view.closure.exportedAt : null
  return (
    <Card
      title="All of this shop's data"
      sub="Every product, sale, customer, shift and record the cloud holds for the shop, as spreadsheets in one zip file — for the owner when we stop working with them, or whenever they ask. Passwords and PINs are left out."
    >
      <div className="row">
        {canAct && (
          <button className="btn sm" onClick={() => setOpen(true)}>
            Download all data
          </button>
        )}
        {exported && (
          <span className="small sub" title={exact(exported)}>
            Last downloaded {date(exported)}
            {view.closure?.exportedByLabel ? ` by ${view.closure.exportedByLabel}` : ''}.
          </span>
        )}
      </div>
      <Unsent view={view} />
      <StepUpDialog
        open={open}
        title={`Download all of ${shop.name}'s data`}
        confirm="Download"
        hint="Asked again because this file holds every customer's details and every sale."
        onClose={() => setOpen(false)}
        onConfirm={async (password) => {
          const file = await api.shopAllData(client, shop.id, password)
          saveFile(file.filename, file.blob)
          invalidate('closure')
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          A zip of spreadsheets, one per kind of record. Money is in pesewas; the file includes a note explaining it.
        </p>
      </StepUpDialog>
    </Card>
  )
}

/** Sales still on a till: neither the export nor the cloud has them yet. */
function Unsent({ view }: { view: ClosureView }) {
  if (!view.unsent.length) return null
  const total = view.unsent.reduce((n, u) => n + u.syncPending, 0)
  return (
    <div className="notice warn" style={{ marginTop: 10 }}>
      {plural(view.unsent.length, 'till')} still {view.unsent.length === 1 ? 'has' : 'have'} {count(total)}{' '}
      {total === 1 ? 'record' : 'records'} it hasn't sent ({view.unsent.map((u) => u.deviceId).join(', ')}). They won't be in
      the download until the till sends them — and once the shop is closed, it can't.
    </div>
  )
}

function CloseCard({ shop, view }: { shop: Shop; view: ClosureView }) {
  const { client, canAct } = useSession()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const days = view.purgeAfterDays
  return (
    <Card title="Stop working with this shop">
      <div className="stack" style={{ gap: 10 }}>
        {view.status === 'reopened' && view.closure?.reopenedAt && (
          <div className="small sub">
            Closed {date(view.closure.closedAt)}, reopened {date(view.closure.reopenedAt)}
            {view.closure.reopenedByLabel ? ` by ${view.closure.reopenedByLabel}` : ''}.
          </div>
        )}
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Its tills stop syncing and checking in, and its staff can't sign in to the cloud. The tills keep selling on their own.</li>
          <li>It leaves the console's lists and alerts. Nothing is deleted, and you can reopen it at any time.</li>
          <li>
            Its data is deleted from the server {days} days later — only if another operator agrees. Download it for the owner first.
          </li>
        </ul>
        {canAct && (
          <div>
            <button className="btn sm danger" onClick={() => setOpen(true)}>
              Close shop…
            </button>
          </div>
        )}
      </div>
      <StepUpDialog
        open={open}
        title={`Close ${shop.name}`}
        confirm="Close shop"
        danger
        hint="Asked again because this cuts the shop off the cloud."
        onClose={() => setOpen(false)}
        onConfirm={async (password) => {
          await api.closeShop(client, shop.id, { password, reason: reason.trim() || undefined })
          setReason('')
          refresh()
        }}
      >
        <Field label="Why (optional)" id="close-reason" hint="Kept with the record of the closure.">
          <input
            id="close-reason"
            className="input"
            maxLength={300}
            placeholder="e.g. Stopped trading; moved to another system"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Unsent view={view} />
      </StepUpDialog>
    </Card>
  )
}

function ClosedCard({ shop, view }: { shop: Shop; view: ClosureView }) {
  const { client, canAct, session } = useSession()
  const c = view.closure!
  const [dialog, setDialog] = useState<'reopen' | 'approve' | null>(null)
  const withdraw = useAction(async () => {
    await api.withdrawShopPurge(client, shop.id)
    refresh()
  })
  const closedByMe = c.closedBy === session.operator.id
  return (
    <Card title="Closed">
      <div className="stack" style={{ gap: 10 }}>
        <div>
          Closed <span title={exact(c.closedAt)}>{date(c.closedAt)}</span>
          {c.closedByLabel ? ` by ${c.closedByLabel}` : ''}
          {c.reason ? ` — “${c.reason}”` : ''}.
        </div>
        {c.purgeApprovedAt ? (
          <div className="notice warn">
            <span style={{ flex: 1 }}>
              <strong>Its data will be deleted {date(view.purgeOn)}</strong> ({until(view.purgeOn)}). {c.purgeApprovedByLabel ?? 'An operator'}{' '}
              agreed on {date(c.purgeApprovedAt)}. Reopening the shop or withdrawing the agreement stops it.
            </span>
            {canAct && (
              <button className="btn sm" disabled={withdraw.pending} onClick={() => void withdraw.run()}>
                Withdraw
              </button>
            )}
          </div>
        ) : (
          <div className="notice info">
            <span style={{ flex: 1 }}>
              Its data stays until a second operator agrees to delete it; then it goes on or after{' '}
              <span title={exact(c.purgeAfter)}>{date(c.purgeAfter)}</span>.
              {closedByMe && ' You closed it, so someone else has to agree.'}
            </span>
            {canAct && !closedByMe && (
              <button className="btn sm danger" onClick={() => setDialog('approve')}>
                Agree to delete…
              </button>
            )}
          </div>
        )}
        {c.purgeError && <div className="notice warn">The last attempt to delete it failed and will be retried: {c.purgeError}</div>}
        {!c.exportedAt && <div className="small warn">Nobody has downloaded its data yet.</div>}
        {canAct && (
          <div>
            <button className="btn sm" onClick={() => setDialog('reopen')}>
              Reopen shop…
            </button>
          </div>
        )}
        {withdraw.error && <ErrorNote error={withdraw.error} />}
      </div>
      <StepUpDialog
        open={dialog === 'reopen'}
        title={`Reopen ${shop.name}`}
        confirm="Reopen"
        hint="Its tills and staff are let back in straight away."
        onClose={() => setDialog(null)}
        onConfirm={async (password) => {
          await api.reopenShop(client, shop.id, password)
          refresh()
        }}
      >
        <p className="small" style={{ margin: 0 }}>Any agreement to delete its data is taken back.</p>
      </StepUpDialog>
      <StepUpDialog
        open={dialog === 'approve'}
        title={`Delete ${shop.name}'s data`}
        confirm="Agree to delete"
        danger
        hint="Your password, as the second operator. This can't be undone once it runs."
        onClose={() => setDialog(null)}
        onConfirm={async (password) => {
          await api.approveShopPurge(client, shop.id, password)
          refresh()
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          Everything the server holds for this shop is deleted on or after {date(c.purgeAfter)}: products, sales, customers, staff,
          its tills' records. {c.exportedAt ? `Its data was downloaded ${date(c.exportedAt)}.` : 'Nobody has downloaded its data yet.'}
        </p>
      </StepUpDialog>
    </Card>
  )
}

/** On the overview: a closed shop says so before anything else. */
export function ClosedBanner({ shop, href }: { shop: Shop; href: string }) {
  const c = shop.closure
  if (!c) return null
  return (
    <div className="notice warn">
      <span style={{ flex: 1 }}>
        <strong>Closed {date(c.closedAt)}.</strong> Its tills and staff are cut off from the cloud.{' '}
        {c.purgeApprovedAt ? `Its data will be deleted ${date(c.purgeAfter)}.` : 'Its data is kept until a second operator agrees to delete it.'}
      </span>
      <a className="btn sm" href={href}>
        Data &amp; closing
      </a>
    </div>
  )
}
