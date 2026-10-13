import { useCallback, useEffect, useState } from 'react'
import {
  BUSINESS_TYPE_LABELS,
  Forbidden,
  Unauthorized,
  type Api,
  type BusinessType,
  type EditionFeature,
  type ShopEdition,
} from '../api.ts'
import { Button, Card, Chip, Notice } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

/**
 * One shop's edition: its business type and which major features it has. The
 * owner never sees this, never sees a switch, and never learns what else
 * exists — only JumpSpaces changes it, here. Setup picked the first set from
 * the owner's answers; everything after is an operator's decision, with a
 * reason when something is taken away.
 */
export function ShopFeaturesCard({
  api,
  shopId,
  onUnauthorized,
  reloadKey = 0,
}: {
  api: Api
  shopId: string
  onUnauthorized: () => void
  /** Bumped by the shop page's Refresh: the card reloads with the rest. */
  reloadKey?: number
}) {
  const [edition, setEdition] = useState<ShopEdition | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // A failed change, shown on the row it belongs to ('type' or a feature key):
  // a refusal like "still in use" or "needs app 2.9.0" reads against its switch.
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // The feature being switched off, waiting on a reason.
  const [turningOff, setTurningOff] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // A business type picked but not yet confirmed.
  const [pendingType, setPendingType] = useState<BusinessType | null>(null)
  // Viewers see the card but can't change anything; no switch that only ends in a 403.
  const canEdit = api.operator?.role !== 'viewer'

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setEdition(await api.shopEdition(shopId))
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setLoadError(err instanceof Error ? err.message : 'Could not load this shop’s features')
    }
  }, [api, shopId, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  async function save(key: string, change: Parameters<Api['setShopEdition']>[1]) {
    setBusy(key)
    setError(null)
    try {
      setEdition(await api.setShopEdition(shopId, change))
      setTurningOff(null)
      setReason('')
      setPendingType(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError({
        key,
        message: err instanceof Forbidden ? 'Viewers can’t change this.' : err instanceof Error ? err.message : 'Could not save',
      })
    } finally {
      setBusy(null)
    }
  }

  const rowError = (key: string) => (error?.key === key ? <Notice>{error.message}</Notice> : null)

  if (!edition) {
    return loadError ? (
      <Card title="Features">
        <Notice>{loadError}</Notice>
        <Button variant="ghost" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    ) : null
  }

  return (
    <Card title="Features">
      {!canEdit && <p className="hint">You can see this shop’s features. Only operators can change them.</p>}

      <label className="field" style={{ marginBottom: 12 }}>
        <span>Business type</span>
        <select
          className="input"
          value={pendingType ?? edition.businessType ?? ''}
          disabled={busy !== null || !canEdit}
          onChange={(e) => setPendingType(e.target.value as BusinessType)}
        >
          {!edition.businessType && <option value="">Not set (shop from before editions)</option>}
          {edition.businessTypes.map((t) => (
            <option key={t} value={t}>
              {BUSINESS_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <span className="hint">
          {edition.setupCompletedAt
            ? `The owner answered the setup questions ${timeAgo(edition.setupCompletedAt)}. Changing the type doesn’t change the features below.`
            : 'Decides which setup questions the owner is asked when they connect their first till.'}
        </span>
      </label>
      {pendingType && pendingType !== edition.businessType && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="hint">Change the type to {BUSINESS_TYPE_LABELS[pendingType]}?</span>
          <Button
            variant="primary"
            busy={busy === 'type'}
            busyLabel="Saving…"
            onClick={() => void save('type', { businessType: pendingType })}
          >
            Change type
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => setPendingType(null)}>
            Cancel
          </Button>
        </div>
      )}
      {rowError('type')}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {edition.features.map((f) => (
          <li key={f.key} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <div>
                <strong>{f.label}</strong>{' '}
                {f.enabled ? <Chip tone="ok">On</Chip> : f.built ? <Chip tone="idle">Off</Chip> : <Chip tone="idle">Not built yet</Chip>}
                <div className="hint">{f.description}</div>
                <Provenance f={f} />
              </div>
              {canEdit && f.built && turningOff !== f.key && (
                <Button
                  variant={f.enabled ? 'ghost' : 'primary'}
                  busy={busy === f.key}
                  busyLabel={f.enabled ? 'Switching off…' : 'Switching on…'}
                  disabled={busy !== null}
                  onClick={() => (f.enabled ? setTurningOff(f.key) : void save(f.key, { features: { [f.key]: true } }))}
                >
                  {f.enabled ? 'Switch off…' : 'Switch on'}
                </Button>
              )}
            </div>
            {rowError(f.key)}

            {turningOff === f.key && (
              <div style={{ marginTop: 8 }}>
                <label className="field" style={{ marginBottom: 8 }}>
                  <span>Why? (only operators see it)</span>
                  <input
                    className="input"
                    value={reason}
                    maxLength={300}
                    placeholder="e.g. Owner sells no perishables"
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                  />
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    variant="danger"
                    busy={busy === f.key}
                    busyLabel="Switching off…"
                    disabled={!reason.trim()}
                    onClick={() => void save(f.key, { features: { [f.key]: false }, reason })}
                  >
                    Switch off
                  </Button>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => setTurningOff(null)}>
                    Cancel
                  </Button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  The shop stops seeing it on every till and phone at their next sync. Nothing is deleted: switching it
                  back on brings everything back.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Provenance({ f }: { f: EditionFeature }) {
  if (!f.source || f.source === 'legacy' || f.source === 'migration') {
    return f.enabled ? <div className="hint">Kept from before editions.</div> : null
  }
  const who = f.source === 'setup' ? 'Chosen at setup' : `${f.enabled ? 'Switched on' : 'Switched off'}${f.changedBy ? ` by ${f.changedBy}` : ''}`
  return (
    <div className="hint" title={f.changedAt ? exact(f.changedAt) : undefined}>
      {who}
      {f.changedAt ? ` ${timeAgo(f.changedAt)}` : ''}
      {f.reason ? <>: “{f.reason}”</> : '.'}
    </div>
  )
}
