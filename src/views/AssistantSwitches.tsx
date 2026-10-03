import { useCallback, useEffect, useState } from 'react'
import { Forbidden, Unauthorized, type Api, type AssistantSwitches as Switches } from '../api.ts'
import { Button, Notice, Status } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'
import { buildHash } from '../lib/route.ts'

/**
 * Settings → Shop assistant: the fleet-wide switch, and every shop switched off
 * on its own (each shop's page has its own switch; this is where they are all
 * in one place, and where they can be turned back on in bulk).
 *
 * Off takes effect on each shop's next check — a till asks when the owner opens
 * the assistant — and any request after that is refused by the cloud, so
 * there's nothing to push to the tills.
 */
export function AssistantSwitches({ api, onUnauthorized }: { api: Api; onUnauthorized: () => void }) {
  const [data, setData] = useState<Switches | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmingOff, setConfirmingOff] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api.assistantSwitches())
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not load the assistant switches')
    }
  }, [api, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(
        err instanceof Forbidden
          ? 'Your role can’t change this. Ask an admin.'
          : err instanceof Error
            ? err.message
            : 'Could not save that change',
      )
    } finally {
      setBusy(null)
    }
  }

  if (!data) {
    return error ? (
      <section className="panel" style={{ padding: 16, marginTop: 24 }}>
        <Notice>{error}</Notice>
      </section>
    ) : null
  }

  const setSystem = (enabled: boolean) =>
    run('system', async () => {
      setData(await api.setSystemAssistant(enabled))
      setConfirmingOff(false)
    })

  return (
    <section className="panel" style={{ padding: 16, marginTop: 24 }}>
      <div className="cmd-head" style={{ marginBottom: 4 }}>
        <span className="strong">Shop assistant</span>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        The AI assistant owners use for questions, the daily briefing and reading invoices. Switching it off stops it on
        the shop’s next check; selling and syncing carry on exactly as before.
      </p>

      {error && <Notice>{error}</Notice>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Status
          tone={data.systemEnabled ? 'ok' : 'bad'}
          label={data.systemEnabled ? 'On for the fleet' : 'Off for every shop'}
        />
        {data.systemChangedAt && (
          <span className="hint" title={exact(data.systemChangedAt)}>
            {data.systemEnabled ? 'Turned on' : 'Turned off'} {timeAgo(data.systemChangedAt)}
            {data.systemChangedBy ? ` by ${data.systemChangedBy}` : ''}.
          </span>
        )}
      </div>

      <div className="form-actions" style={{ marginTop: 12 }}>
        {data.systemEnabled ? (
          confirmingOff ? (
            <>
              <Button variant="danger" busy={busy === 'system'} busyLabel="Turning off…" onClick={() => void setSystem(false)}>
                Turn off for every shop
              </Button>
              <Button variant="ghost" disabled={busy === 'system'} onClick={() => setConfirmingOff(false)}>
                Cancel
              </Button>
              <span className="hint">Every owner loses the assistant until it’s turned back on.</span>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingOff(true)}>
              Turn off for every shop…
            </Button>
          )
        ) : (
          <Button variant="primary" busy={busy === 'system'} busyLabel="Turning on…" onClick={() => void setSystem(true)}>
            Turn back on for the fleet
          </Button>
        )}
      </div>

      <div className="cmd-head" style={{ marginTop: 20, marginBottom: 6 }}>
        <span className="strong">Switched off for one shop</span>
      </div>
      {data.blockedShops.length === 0 ? (
        <p className="hint">No shop has its assistant switched off on its own. Use a shop’s page to switch one off.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <span className="th-label">Shop</span>
                </th>
                <th>
                  <span className="th-label">Why</span>
                </th>
                <th>
                  <span className="th-label">Switched off</span>
                </th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.blockedShops.map((b) => (
                <tr key={b.shopId}>
                  <td>
                    <a href={buildHash({ view: 'shop', params: { id: b.shopId } })}>{b.shopName}</a>
                  </td>
                  <td>{b.reason ?? <span className="muted">—</span>}</td>
                  <td title={exact(b.disabledAt)}>
                    {timeAgo(b.disabledAt)}
                    {b.disabledBy ? <span className="muted"> · {b.disabledBy}</span> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Button
                      size="sm"
                      busy={busy === b.shopId}
                      busyLabel="Turning on…"
                      onClick={() =>
                        void run(b.shopId, async () => {
                          await api.setShopAssistant(b.shopId, true)
                          await load()
                        })
                      }
                    >
                      Turn back on
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!data.systemEnabled && data.blockedShops.length > 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          These stay off when the fleet switch comes back on.
        </p>
      )}
    </section>
  )
}
