import { useEffect, useState } from 'react'
import { Unauthorized, type Api, type DeviceRow, type ShopRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import {
  Button,
  Chip,
  Drawer,
  DrawerSection,
  Empty,
  KV,
  Notice,
  Status,
} from '../components/ui.tsx'
import { exact, timeAgo, timeUntil } from '../lib/format.ts'
import { primaryReason, STATE_LABEL, TONE } from '../lib/state.ts'

export function ShopDrawer({
  api,
  shop,
  onClose,
  onChanged,
  onUnauthorized,
  onReissued,
  onNavigate,
}: {
  api: Api
  shop: ShopRow
  onClose: () => void
  onChanged: () => void
  onUnauthorized: () => void
  /**
   * A freshly minted one-time code to show once. `kind` decides the wording,
   * because the two grant very different things: an activation code sets the
   * owner's password, a reconnect code only attaches a machine.
   */
  onReissued: (r: { code: string; expiresAt: string; kind: 'claim' | 'reconnect' }) => void
  onNavigate: Navigate
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // The shop's terminals and how they are actually doing. Both tables carry
  // shopId and neither view used to read the other's, so diagnosing "Kumasi is
  // down" meant searching twice with no guarantee the names matched.
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)

  useEffect(() => {
    let live = true
    api
      .devices({ shopId: shop.id, limit: 50 })
      .then((page) => live && setDevices(page.devices))
      .catch(() => live && setDevices([]))
    return () => {
      live = false
    }
  }, [api, shop.id])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'That action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Drawer title={shop.name} subtitle={shop.location ?? 'No location set'} onClose={onClose}>
      {error && <Notice>{error}</Notice>}

      <DrawerSection title="Shop">
        <div style={{ marginBottom: 12 }}>
          <Status
            tone={shop.activated ? 'ok' : 'warn'}
            label={shop.activated ? 'Active' : 'Pending first connection'}
          />
        </div>
        <dl className="kv-list">
          <KV k="Shop code" v={<span className="mono">{shop.code ?? '—'}</span>} />
          <KV k="Owner" v={shop.owner?.name ?? '—'} />
          <KV k="Owner login" v={<span className="mono">{shop.owner?.staffId ?? '—'}</span>} />
          <KV k="Currency" v={shop.currency} />
          <KV k="Phone" v={shop.phone ?? '—'} />
          <KV k="Onboarded" v={timeAgo(shop.createdAt)} title={exact(shop.createdAt)} />
        </dl>
      </DrawerSection>

      {!shop.activated && (
        <DrawerSection title="Claim code">
          <p className="hint" style={{ marginBottom: 10 }}>
            {shop.hasLiveClaimCode && shop.claimCodeExpiresAt
              ? `The current code is still live and expires ${timeUntil(shop.claimCodeExpiresAt)}. Issue a new one only if the shop has lost it — the previous code stops working immediately.`
              : 'This shop has no working claim code. Issue one to let them connect their machine.'}
          </p>
          <Button
            variant={shop.hasLiveClaimCode ? 'default' : 'primary'}
            busy={busy === 'code'}
            busyLabel="Issuing…"
            onClick={() =>
              void run('code', async () => {
                const r = await api.reissueClaimCode(shop.id)
                onReissued({ code: r.claimCode, expiresAt: r.expiresAt, kind: 'claim' })
              })
            }
          >
            {shop.hasLiveClaimCode ? 'Replace the claim code' : 'Issue a claim code'}
          </Button>
        </DrawerSection>
      )}

      {/* The counterpart for a shop that is already trading. A claim code can't
          serve here — it would reset the owner's password on a live shop, which
          the claim flow refuses outright — so until now an owner who was away or
          locked out left their shop unable to bring up a till at all. */}
      {shop.activated && (
        <DrawerSection title="Connect a machine">
          <p className="hint" style={{ marginBottom: 10 }}>
            Normally the owner connects a new machine by signing in on it. Issue a code
            only when they can't — away, unreachable, or locked out. It attaches the
            machine and nothing else: no password is set, nobody is signed in, and staff
            still need their own login to sell.
          </p>
          <Button
            busy={busy === 'reconnect'}
            busyLabel="Issuing…"
            onClick={() =>
              void run('reconnect', async () => {
                const r = await api.issueReconnectCode(shop.id)
                onReissued({ code: r.reconnectCode, expiresAt: r.expiresAt, kind: 'reconnect' })
              })
            }
          >
            Issue a connect code
          </Button>
        </DrawerSection>
      )}

      {/* Health, not just inventory. A machine row says a key exists; this says
          whether the till behind it is actually working right now. */}
      <DrawerSection title="Terminals">
        {devices == null ? (
          <div className="skeleton" style={{ width: '55%' }} />
        ) : devices.length === 0 ? (
          <p className="muted small">
            No terminal from this shop has reported to the fleet yet.
          </p>
        ) : (
          <>
            <ul className="plain-list">
              {devices.map((d) => (
                <li key={d.deviceId}>
                  <button
                    type="button"
                    className="row-open"
                    onClick={() => {
                      onClose()
                      onNavigate('terminals', { deviceId: d.deviceId })
                    }}
                  >
                    <Status tone={TONE[d.state]} label={STATE_LABEL[d.state]} />
                  </button>
                  <span className="muted small">
                    <span className="mono">{d.appVersion ?? '—'}</span> ·{' '}
                    {d.state === 'healthy'
                      ? `last seen ${timeAgo(d.lastReportAt)}`
                      : (primaryReason(d.reasons) ?? timeAgo(d.lastReportAt))}
                  </span>
                  {d.recentOpenErrorGroups > 0 && (
                    <Chip tone="warn">{d.recentOpenErrorGroups} errors</Chip>
                  )}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onClose()
                onNavigate('terminals', { shopId: shop.id })
              }}
            >
              <Icon name="link" size={14} />
              See these in Terminals
            </Button>
          </>
        )}
      </DrawerSection>

      <DrawerSection title={`Machines${shop.machines.length ? ` (${shop.machines.length})` : ''}`}>
        {shop.machines.length === 0 ? (
          <Empty icon="terminals" title="No machine connected yet">
            The shop connects one by entering its claim code on the desktop app.
          </Empty>
        ) : (
          shop.machines.map((m) => (
            <div key={m.keyId} className="machine">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="code-chip" data-revoked={m.revokedAt ? 'true' : undefined}>
                    {m.terminalCode}
                  </span>
                  <span className="strong">{m.machineName ?? 'Unnamed machine'}</span>
                </div>
                <div className="row-sub mono">{m.keyPrefix}…</div>
                <div className="row-sub">
                  {m.revokedAt ? (
                    <span title={exact(m.revokedAt)}>Revoked {timeAgo(m.revokedAt)}</span>
                  ) : m.lastSeenAt ? (
                    <span title={exact(m.lastSeenAt)}>Last synced {timeAgo(m.lastSeenAt)}</span>
                  ) : (
                    'Never synced'
                  )}
                </div>
              </div>

              {!m.revokedAt &&
                (confirming === m.keyId ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      variant="danger"
                      size="sm"
                      busy={busy === m.keyId}
                      busyLabel="Revoking…"
                      onClick={() =>
                        void run(m.keyId, async () => {
                          await api.revokeStoreKey(m.keyId)
                          setConfirming(null)
                        })
                      }
                    >
                      Confirm revoke
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button variant="danger" size="sm" onClick={() => setConfirming(m.keyId)}>
                    Revoke
                  </Button>
                ))}
            </div>
          ))
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          Revoking stops a machine syncing. It keeps selling offline and its data is kept —
          reconnect it by claiming again with the owner’s sign-in.
        </p>
      </DrawerSection>
    </Drawer>
  )
}
