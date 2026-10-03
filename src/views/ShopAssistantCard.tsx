import { useCallback, useEffect, useState } from 'react'
import { Forbidden, Unauthorized, type Api, type AssistantSwitches } from '../api.ts'
import { Button, Card, Notice, Status } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

/**
 * One shop's assistant switch, on its page. The reason is for whoever picks up
 * this shop's call next — it's kept on the console and never shown to the shop,
 * which only learns the assistant was switched off and to contact support.
 */
export function ShopAssistantCard({
  api,
  shopId,
  onUnauthorized,
}: {
  api: Api
  shopId: string
  onUnauthorized: () => void
}) {
  const [switches, setSwitches] = useState<AssistantSwitches | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [turningOff, setTurningOff] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      setSwitches(await api.assistantSwitches())
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not load the assistant’s state')
    }
  }, [api, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  async function set(enabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      await api.setShopAssistant(shopId, enabled, enabled ? undefined : reason)
      setTurningOff(false)
      setReason('')
      await load()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Forbidden ? 'Viewers can’t change this.' : err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (!switches) return error ? <Card title="Shop assistant"><Notice>{error}</Notice></Card> : null

  const block = switches.blockedShops.find((b) => b.shopId === shopId)

  return (
    <Card title="Shop assistant">
      <div className="card-status">
        {!switches.systemEnabled ? (
          <Status tone="warn" label="Off for every shop" />
        ) : block ? (
          <Status tone="bad" label="Off for this shop" />
        ) : (
          <Status tone="ok" label="On" />
        )}
      </div>

      {error && <Notice>{error}</Notice>}

      {!switches.systemEnabled && (
        <p className="hint" style={{ marginBottom: 10 }}>
          The fleet-wide switch is off (Settings → Shop assistant). This shop’s own switch below takes effect once it’s
          back on.
        </p>
      )}

      {block ? (
        <>
          <p className="hint" style={{ marginBottom: 10 }} title={exact(block.disabledAt)}>
            Switched off {timeAgo(block.disabledAt)}
            {block.disabledBy ? ` by ${block.disabledBy}` : ''}
            {block.reason ? <>: “{block.reason}”</> : '.'}
          </p>
          <Button busy={busy} busyLabel="Turning on…" onClick={() => void set(true)}>
            Turn back on for this shop
          </Button>
        </>
      ) : turningOff ? (
        <>
          <label className="field" style={{ marginBottom: 10 }}>
            <span>Why? (optional, only operators see it)</span>
            <input
              className="input"
              value={reason}
              maxLength={300}
              placeholder="e.g. Owner asked; account overdue"
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="danger" busy={busy} busyLabel="Switching off…" onClick={() => void set(false)}>
              Switch off
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setTurningOff(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 10 }}>
            The owner’s AI assistant: questions, the daily briefing and invoice reading. Switching it off doesn’t
            affect selling or sync.
          </p>
          <Button onClick={() => setTurningOff(true)}>Switch off for this shop…</Button>
        </>
      )}
    </Card>
  )
}
