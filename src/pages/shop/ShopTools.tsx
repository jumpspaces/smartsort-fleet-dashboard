import { useRef, useState, type FormEvent } from 'react'
import * as api from '../../api/endpoints.ts'
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES, type BusinessType, type Shop, type ShopMachine } from '../../api/types.ts'
import { ActionError, CodeReveal, ConfirmButton, Dialog, Field, Toggle } from '../../components/forms.tsx'
import { Card, Empty, Loadable, When } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { date, until } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

/* ------------------------------------------------------- codes & silence */

/**
 * The phone-support buttons: a fresh setup code for a shop that never
 * finished, a reconnect code to attach another machine to a live shop, and
 * silencing alerts during planned work.
 */
export function ShopActions({ shop }: { shop: Shop }) {
  const { client, canAct } = useSession()
  const [code, setCode] = useState<{ label: string; code: string; expiresAt: string; note: string } | null>(null)
  const [muting, setMuting] = useState(false)
  const claim = useAction(async () => {
    const r = await api.reissueClaimCode(client, shop.id)
    invalidate('shops')
    setCode({
      label: 'Setup code',
      code: r.claimCode,
      expiresAt: r.expiresAt,
      note: 'The owner types this on the first till to set the shop up. Any earlier code stops working.',
    })
  })
  const reconnect = useAction(async () => {
    const r = await api.reconnectCode(client, shop.id)
    setCode({
      label: 'Reconnect code',
      code: r.reconnectCode,
      expiresAt: r.expiresAt,
      note: 'Attaches one more machine to this shop. It sets no password and signs nobody in.',
    })
  })
  if (!canAct) return null
  return (
    <>
      {!shop.activated && (
        <button className="btn sm primary" disabled={claim.pending} onClick={() => void claim.run()}>
          New setup code
        </button>
      )}
      {shop.activated && (
        <button className="btn sm" disabled={reconnect.pending} onClick={() => void reconnect.run()}>
          Reconnect code
        </button>
      )}
      <button className="btn sm" onClick={() => setMuting(true)}>
        Silence alerts
      </button>
      <Dialog open={!!code || !!claim.error || !!reconnect.error} onClose={() => setCode(null)} title={code?.label ?? 'Code'}>
        <div className="stack">
          <ActionError error={claim.error ?? reconnect.error} />
          {code && <CodeReveal label={`Expires ${until(code.expiresAt)}`} code={code.code} note={code.note} />}
          <div className="form-actions">
            <button className="btn" onClick={() => setCode(null)}>
              Done
            </button>
          </div>
        </div>
      </Dialog>
      <MuteDialog open={muting} onClose={() => setMuting(false)} target={{ scope: 'shop', shopId: shop.id }} name={shop.name} />
    </>
  )
}

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 24 * 60 },
  { label: '3 days', minutes: 3 * 24 * 60 },
  { label: '1 week', minutes: 7 * 24 * 60 },
]

export function MuteDialog({
  open,
  onClose,
  target,
  name,
}: {
  open: boolean
  onClose: () => void
  target: { scope: 'shop'; shopId: string } | { scope: 'device'; deviceId: string }
  name: string
}) {
  const { client } = useSession()
  const [minutes, setMinutes] = useState(240)
  const [reason, setReason] = useState('')
  const save = useAction(async () => {
    await api.openMute(client, { ...target, minutes, reason: reason.trim() })
    invalidate('mutes')
    invalidate('device')
    setReason('')
    onClose()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  return (
    <Dialog open={open} onClose={onClose} title={`Silence alerts for ${name}`}>
      <form className="form" onSubmit={submit}>
        <Field label="How long" id="dm">
          <select id="dm" className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Why" id="dr" hint="Shown to whoever looks at it next.">
          <input id="dr" className="input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Power cut in the area" />
        </Field>
        <div className="small muted">Problems still show on the page; nobody is notified until it ends.</div>
        <ActionError error={save.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={save.pending || !reason.trim()}>
            Silence
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* -------------------------------------------------------------- machines */

export function Machines({ machines }: { machines: ShopMachine[] }) {
  const [showRemoved, setShowRemoved] = useState(false)
  const current = machines.filter((m) => !m.removedAt)
  const removed = machines.filter((m) => m.removedAt)
  const shown = showRemoved ? machines : current
  return (
    <Card
      title="Machines"
      sub="Every computer connected to this shop, including ones that never reported."
      flush
      actions={
        removed.length > 0 && (
          <button className="btn sm ghost" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? 'Hide removed' : `Show ${removed.length} removed`}
          </button>
        )
      }
    >
      {shown.length === 0 ? (
        <Empty title="No machines connected" />
      ) : (
        <ul className="list">
          {shown.map((m) => (
            <MachineItem key={m.keyId} m={m} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function MachineItem({ m }: { m: ShopMachine }) {
  const { client, canAct } = useSession()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(m.machineName ?? '')
  const act = useAction(async (fn: () => Promise<unknown>) => {
    await fn()
    invalidate('shops')
    invalidate('device')
    setRenaming(false)
  })
  return (
    <li>
      <div className="spread">
        {renaming ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              void act.run(() => api.renameMachine(client, m.keyId, name.trim()))
            }}
          >
            <input
              className="input"
              autoFocus
              aria-label="Till name"
              placeholder={m.terminalCode}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn sm primary" type="submit" disabled={act.pending}>
              Save
            </button>
            <button className="btn sm ghost" type="button" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <span style={{ fontWeight: 550 }}>
            {m.machineName || m.terminalCode}
            {m.machineName && <span className="muted"> · {m.terminalCode}</span>}
          </span>
        )}
        <span className="row" style={{ gap: 6 }}>
          {m.mode === 'peer' && <span className="tag">extra till</span>}
          {m.removedAt ? (
            <span className="badge neutral">Removed</span>
          ) : m.revokedAt ? (
            <span className="badge offline">Link revoked</span>
          ) : null}
        </span>
      </div>
      <div className="spread small">
        <span className="muted">
          Connected {date(m.createdAt)} · last seen <When iso={m.lastReportAt ?? m.lastSeenAt} /> · key {m.keyPrefix}…
        </span>
        {canAct && !renaming && (
          <span className="row" style={{ gap: 4 }}>
            {!m.removedAt && (
              <button className="btn sm ghost" onClick={() => setRenaming(true)}>
                Rename
              </button>
            )}
            {!m.revokedAt && !m.removedAt && (
              <ConfirmButton danger confirm="Revoke link" disabled={act.pending} onConfirm={() => void act.run(() => api.revokeKey(client, m.keyId))}>
                Revoke
              </ConfirmButton>
            )}
            {!m.removedAt ? (
              <ConfirmButton danger confirm="Remove from shop" disabled={act.pending} onConfirm={() => void act.run(() => api.removeMachine(client, m.keyId))}>
                Remove
              </ConfirmButton>
            ) : (
              <button className="btn sm" disabled={act.pending} onClick={() => void act.run(() => api.restoreMachine(client, m.keyId))}>
                Put back
              </button>
            )}
          </span>
        )}
      </div>
      {m.removedAt && <div className="small muted">Putting it back makes it visible again; it stays unlinked until it reconnects.</div>}
      <ActionError error={act.error} />
    </li>
  )
}

/* --------------------------------------------------------------- edition */

/** Which major features the shop has, decided by its kind of business. */
export function Edition({ shopId }: { shopId: string }) {
  const { client, canAct } = useSession()
  const ed = useApi(`edition:${shopId}`, (c, s) => api.shopEdition(c, shopId, s))
  const [type, setType] = useState<BusinessType | ''>('')
  const [reason, setReason] = useState('')
  const reasonRef = useRef<HTMLInputElement>(null)
  const save = useAction(async (change: { businessType?: BusinessType; features?: Record<string, boolean> }) => {
    // The server refuses to switch a feature off without a reason; ask first
    // rather than let the click fail.
    if (change.features && Object.values(change.features).includes(false) && !reason.trim()) {
      reasonRef.current?.focus()
      throw new Error('Say why you’re switching it off — the shop may already rely on it.')
    }
    await api.setShopEdition(client, shopId, { ...change, reason: reason.trim() || undefined })
    setReason('')
    invalidate(`edition:${shopId}`)
    setType('')
  })
  return (
    <Card title="Features" sub="What this shop's SmartSort includes. Changes reach its tills on their next check-in." flush>
      <Loadable q={ed} rows={4}>
        {(e) => (
          <>
            <div style={{ padding: 16 }} className="stack">
              <div className="row">
                <label htmlFor="bt" style={{ fontWeight: 550 }}>
                  Kind of business
                </label>
                <select
                  id="bt"
                  className="select"
                  disabled={!canAct || save.pending}
                  value={type || e.businessType || ''}
                  onChange={(ev) => setType(ev.target.value as BusinessType)}
                >
                  {!e.businessType && <option value="">Not set</option>}
                  {(e.businessTypes.length ? e.businessTypes : BUSINESS_TYPES).map((t) => (
                    <option key={t} value={t}>
                      {BUSINESS_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                {type && type !== e.businessType && (
                  <button className="btn sm primary" disabled={save.pending} onClick={() => void save.run({ businessType: type })}>
                    Change
                  </button>
                )}
              </div>
              {canAct && (
                <input
                  ref={reasonRef}
                  className="input"
                  aria-label="Reason for the change"
                  placeholder="Reason — needed to switch a feature off, kept on record"
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                />
              )}
              <ActionError error={save.error} />
            </div>
            <ul className="list" style={{ borderTop: '1px solid var(--line)' }}>
              {e.features.map((f) => (
                <li key={f.key} style={f.built ? undefined : { opacity: 0.55 }}>
                  <div className="spread" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 260px' }}>
                      <div style={{ fontWeight: 550 }}>
                        {f.label} {!f.built && <span className="tag">coming</span>}
                      </div>
                      <div className="small sub">{f.description}</div>
                      {(f.changedBy || f.minAppVersion) && (
                        <div className="small muted">
                          {f.changedBy && (
                            <>
                              {f.enabled ? 'On' : 'Off'} by {f.changedBy}
                              {f.changedAt && `, ${date(f.changedAt)}`}
                              {f.reason && ` — “${f.reason}”`}
                            </>
                          )}
                          {f.minAppVersion && `${f.changedBy ? ' · ' : ''}needs SmartSort ${f.minAppVersion}+`}
                        </div>
                      )}
                    </div>
                    <Toggle
                      label={f.label}
                      checked={f.enabled}
                      disabled={!canAct || !f.built || save.pending}
                      onChange={(v) => void save.run({ features: { [f.key]: v } })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Loadable>
    </Card>
  )
}
