/**
 * One shop, as a page of its own.
 *
 * This carried the most in the drawer and suffered most from it: identity,
 * one-time codes, terminal health, connected machines, and the shop's entire
 * catalogue with import and export on top. A 600px column made the inventory
 * table — the part with the most rows and the widest cells — the narrowest
 * thing on screen.
 *
 * It loads itself from `shopId`, so a link to a shop opens the same page a
 * click from the table does.
 */
import { useCallback, useEffect, useState } from 'react'
import { Unauthorized, type Api, type DeviceRow, type ShopRow } from '../api.ts'
import type { Navigate } from '../App.tsx'
import { Icon } from '../components/Icon.tsx'
import {
  Button,
  Card,
  Chip,
  Columns,
  Empty,
  KV,
  Notice,
  PageHead,
  Status,
  TableSkeleton,
} from '../components/ui.tsx'
import { exact, timeAgo, timeUntil } from '../lib/format.ts'
import { primaryReason, STATE_LABEL, TONE } from '../lib/state.ts'
import { ClaimPanel, type ClaimResult, type CodeKind } from './ClaimCode.tsx'
import { ShopInventoryPanels } from './ShopInventory.tsx'

export function Shop({
  api,
  shopId,
  reloadKey,
  onNavigate,
  onBack,
  onUnauthorized,
}: {
  api: Api
  shopId: string
  reloadKey: number
  onNavigate: Navigate
  onBack: () => void
  onUnauthorized: () => void
}) {
  const [shop, setShop] = useState<ShopRow | null>(null)
  // A freshly minted one-time code, shown once and on this page — the button
  // that mints it is here, so this is where the operator is looking.
  const [code, setCode] = useState<(ClaimResult & { kind: CodeKind }) | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // The shop's terminals and how they are actually doing. Both tables carry
  // shopId and neither view used to read the other's, so diagnosing "Kumasi is
  // down" meant searching twice with no guarantee the names matched.
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)

  const load = useCallback(async () => {
    try {
      const found = await api.shop(shopId)
      setShop(found)
      setLoadError(found ? null : 'That shop no longer exists.')
    } catch (err) {
      if (err instanceof Unauthorized) return
      setLoadError(err instanceof Error ? err.message : 'Could not load this shop')
    }
  }, [api, shopId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    let live = true
    api
      .devices({ shopId, limit: 50 })
      .then((page) => live && setDevices(page.devices))
      .catch(() => live && setDevices([]))
    return () => {
      live = false
    }
  }, [api, shopId, reloadKey])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'That action failed')
    } finally {
      setBusy(null)
    }
  }

  const back = { label: 'Shops', onClick: onBack }

  if (!shop) {
    return (
      <>
        <PageHead back={back} title={loadError ? 'Shop' : 'Loading…'} />
        {loadError ? <Notice>{loadError}</Notice> : <TableSkeleton rows={4} />}
      </>
    )
  }

  return (
    <>
      <PageHead
        back={back}
        title={shop.name}
        subtitle={shop.location ?? 'No location set'}
        actions={
          <Button onClick={() => onNavigate('terminals', { shopId: shop.id })}>
            <Icon name="link" size={14} />
            See in Terminals
          </Button>
        }
      />

      {error && <Notice>{error}</Notice>}

      {code && (
        <section className="panel">
          <ClaimPanel result={code} onDismiss={() => setCode(null)} />
        </section>
      )}

      <Columns
        main={
          <>
            {/* Health, not just inventory. A machine row says a key exists; this
                says whether the till behind it is actually working right now. */}
            <Card title="Terminals">
              {devices == null ? (
                <div className="skeleton" style={{ width: '55%' }} />
              ) : devices.length === 0 ? (
                <p className="muted small">
                  No terminal from this shop has reported to the fleet yet.
                </p>
              ) : (
                <ul className="plain-list">
                  {devices.map((d) => (
                    <li key={d.deviceId}>
                      <button
                        type="button"
                        className="row-open"
                        onClick={() => onNavigate('device', { id: d.deviceId })}
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
              )}
            </Card>

            <Card title={`Machines${shop.machines.length ? ` (${shop.machines.length})` : ''}`}>
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
                        {m.mode === 'peer' && <Chip tone="idle">Peer till</Chip>}
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
                      {/* A separate clock from "Last synced" above: that's normal data sync,
                          this is the fleet health heartbeat (also shown in Terminals). The two
                          can diverge — a machine can sync fine while offline from the fleet's
                          point of view, or vice versa — so show both rather than let one imply
                          the other. */}
                      {!m.revokedAt && (
                        <div className="row-sub">
                          {m.lastReportAt ? (
                            <span title={exact(m.lastReportAt)}>
                              Fleet check-in {timeAgo(m.lastReportAt)}
                            </span>
                          ) : (
                            'No fleet check-in yet'
                          )}
                        </div>
                      )}
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
            </Card>

            {/* Last, and deliberately below the identity sections: this is the part
                that reaches into the shop's own books rather than describing their
                machines, so it comes after everything that only reports. */}
            <ShopInventoryPanels api={api} shop={shop} onUnauthorized={onUnauthorized} />
          </>
        }
        side={
          <>
            {!shop.activated && (
              <Card title="Claim code">
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
                      setCode({
                        claimCode: r.claimCode,
                        expiresAt: r.expiresAt,
                        kind: 'claim',
                        shopId: shop.id,
                        shopCode: shop.code ?? '',
                        ownerId: '',
                        shopName: shop.name,
                      })
                    })
                  }
                >
                  {shop.hasLiveClaimCode ? 'Replace the claim code' : 'Issue a claim code'}
                </Button>
              </Card>
            )}

            {/* The counterpart for a shop that is already trading. A claim code can't
                serve here — it would reset the owner's password on a live shop, which
                the claim flow refuses outright — so until now an owner who was away or
                locked out left their shop unable to bring up a till at all. */}
            {shop.activated && (
              <Card title="Connect a machine">
                <p className="hint" style={{ marginBottom: 10 }}>
                  Normally the owner connects a new machine by signing in on it. Issue a code only
                  when they can’t — away, unreachable, or locked out. It attaches the machine and
                  nothing else: no password is set, nobody is signed in, and staff still need their
                  own login to sell.
                </p>
                <Button
                  busy={busy === 'reconnect'}
                  busyLabel="Issuing…"
                  onClick={() =>
                    void run('reconnect', async () => {
                      const r = await api.issueReconnectCode(shop.id)
                      setCode({
                        claimCode: r.reconnectCode,
                        expiresAt: r.expiresAt,
                        kind: 'reconnect',
                        shopId: shop.id,
                        shopCode: shop.code ?? '',
                        ownerId: '',
                        shopName: shop.name,
                      })
                    })
                  }
                >
                  Issue a connect code
                </Button>
              </Card>
            )}

            <Card title="Shop">
              <div className="card-status">
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
            </Card>
          </>
        }
      />
    </>
  )
}
