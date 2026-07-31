import { useState } from 'react'
import { reissueClaimCode, revokeStoreKey, Unauthorized, type ShopRow } from '../api.ts'
import {
  Button,
  Drawer,
  DrawerSection,
  Empty,
  KV,
  Notice,
  Status,
} from '../components/ui.tsx'
import { exact, timeAgo, timeUntil } from '../lib/format.ts'

export function ShopDrawer({
  apiBase,
  token,
  shop,
  onClose,
  onChanged,
  onUnauthorized,
  onReissued,
}: {
  apiBase: string
  token: string
  shop: ShopRow
  onClose: () => void
  onChanged: () => void
  onUnauthorized: () => void
  onReissued: (r: { claimCode: string; expiresAt: string }) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

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
                const r = await reissueClaimCode(apiBase, token, shop.id)
                onReissued(r)
              })
            }
          >
            {shop.hasLiveClaimCode ? 'Replace the claim code' : 'Issue a claim code'}
          </Button>
        </DrawerSection>
      )}

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
                          await revokeStoreKey(apiBase, token, m.keyId)
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
