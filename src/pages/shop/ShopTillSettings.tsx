import { useState } from 'react'
import * as api from '../../api/endpoints.ts'
import type { ConfigPatch, NoticeInput } from '../../api/types.ts'
import { belowOf, ConfigEditor, MessageEditor } from '../../components/TillLevelEditor.tsx'
import { Card, ErrorNote, Loadable } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { ago } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

/**
 * What every till in one shop keeps: a message on all their screens, how often
 * they check in and back up, and whether they take updates. Over the fleet's
 * settings, under each till's own. The tills take it up at their next check-in.
 */
export function ShopTillSettings({ shopId }: { shopId: string }) {
  const { client, canAct } = useSession()
  const q = useApi(`tillsettings:${shopId}`, (c, s) => api.shopTillSettings(c, shopId, s))
  const [reason, setReason] = useState('')
  const save = async (patch: { notice?: NoticeInput | null; config?: ConfigPatch; updateHold?: { reason: string | null } | null }) => {
    await api.updateShopTillSettings(client, shopId, patch)
    invalidate('tillsettings')
    // Each till's own page reads the result.
    invalidate('settings')
  }
  const hold = useAction(async (on: boolean) => {
    await save({ updateHold: on ? { reason: reason.trim() || null } : null })
    setReason('')
  })

  return (
    <Card title="Settings for this shop's tills" sub="Every till in the shop takes these up at its next check-in, over the fleet's. A till's own settings still win.">
      <Loadable q={q} rows={4}>
        {({ fleet, shop }) => (
          <div className="stack" style={{ gap: 18 }}>
            <MessageEditor
              id="shop-message"
              current={shop.notice}
              canAct={canAct}
              placeholder="e.g. The tills will restart at 10pm tonight for an update — please leave them switched on."
              hint="Shown on every till in this shop that has no message of its own."
              onShow={(notice) => save({ notice })}
              onClear={() => save({ notice: null })}
            />
            <div className="stack" style={{ gap: 6 }}>
              <div className="small" style={{ fontWeight: 550 }}>
                How often they check in and back up
              </div>
              <ConfigEditor
                own={shop.config ?? {}}
                below={belowOf([{ config: fleet.config, from: 'the fleet' }])}
                canAct={canAct}
                onApply={(config) => save({ config })}
              />
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="small" style={{ fontWeight: 550 }}>
                Updates
              </div>
              {shop.updateHold ? (
                <div className="notice info">
                  <span style={{ flex: 1 }}>
                    <strong>Kept out of updates</strong> {ago(shop.updateHold.since)}
                    {shop.updateHold.by ? ` by ${shop.updateHold.by}` : ''}
                    {shop.updateHold.reason ? ` — “${shop.updateHold.reason}”` : ''}. No rollout or operator can send any of its tills a new
                    version.
                  </span>
                  {canAct && (
                    <button className="btn sm" disabled={hold.pending} onClick={() => void hold.run(false)}>
                      Let them update
                    </button>
                  )}
                </div>
              ) : canAct ? (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void hold.run(true)
                  }}
                >
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 180 }}
                    aria-label="Why keep the shop out of updates"
                    placeholder="Why (optional) — a stocktake, a busy week…"
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button type="submit" className="btn sm" disabled={hold.pending}>
                    Keep the shop out of updates
                  </button>
                </form>
              ) : (
                <div className="small sub">Its tills take updates as they go out.</div>
              )}
              {hold.error && <ErrorNote error={hold.error} />}
            </div>
          </div>
        )}
      </Loadable>
    </Card>
  )
}
