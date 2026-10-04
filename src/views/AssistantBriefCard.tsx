import { useState } from 'react'
import { Unauthorized, type Api, type AssistantBrief } from '../api.ts'
import { Button, Card, Notice } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

/**
 * The assistant's written brief: of the whole fleet (what needs attention
 * now), or of one shop (before phoning it). Written on request — each is a
 * model call — and kept for a while on the server, so asking twice in a row
 * shows the same one unless "Fresh" is pressed.
 */
export function AssistantBriefCard({
  api,
  shopId,
  onUnauthorized,
}: {
  api: Api
  /** Omit for the fleet brief. */
  shopId?: string
  onUnauthorized?: () => void
}) {
  const [brief, setBrief] = useState<AssistantBrief | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(fresh: boolean) {
    setBusy(true)
    setError(null)
    try {
      setBrief(shopId ? await api.shopSupportBrief(shopId, fresh) : await api.fleetHealthBrief(fresh))
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized?.()
      setError(err instanceof Error ? err.message : 'The assistant could not write the brief.')
    } finally {
      setBusy(false)
    }
  }

  const title = shopId ? 'Support brief' : 'Assistant brief'
  return (
    <Card
      title={title}
      actions={
        <Button size="sm" busy={busy} busyLabel="Writing…" onClick={() => void load(Boolean(brief))}>
          {brief ? 'Fresh' : shopId ? 'Brief me on this shop' : 'What needs attention?'}
        </Button>
      }
    >
      {error && <Notice>{error}</Notice>}
      {!brief && !error && (
        <p className="hint">
          {shopId
            ? 'Terminals, sync, recent faults, open alerts and AI status, summarised before you call.'
            : 'Quiet tills, sales drops, open alerts and AI limits across every shop, summarised.'}
        </p>
      )}
      {brief && (
        <div>
          <p className="strong" style={{ marginBottom: 8 }}>{brief.content.headline}</p>
          {brief.content.points.length > 0 && (
            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              {brief.content.points.map((p, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{p}</li>
              ))}
            </ul>
          )}
          {brief.content.actions.length > 0 && (
            <>
              <p className="small strong" style={{ margin: '8px 0 4px' }}>Do next</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {brief.content.actions.map((a, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{a}</li>
                ))}
              </ul>
            </>
          )}
          <p className="hint" style={{ marginTop: 8 }} title={exact(brief.createdAt)}>
            Written {timeAgo(brief.createdAt)} from the console's own figures.
          </p>
        </div>
      )}
    </Card>
  )
}
