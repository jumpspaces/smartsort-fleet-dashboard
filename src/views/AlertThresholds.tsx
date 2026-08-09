import { useCallback, useEffect, useState } from 'react'
import { Forbidden, Unauthorized, type Api, type FleetConfigRow, type FleetThresholds } from '../api.ts'
import { Button, Notice } from '../components/ui.tsx'
import { timeAgo } from '../lib/format.ts'

/**
 * The knobs behind lib/fleet-health.ts's HEALTH object and the alert
 * evaluator, exposed so an unusually noisy or unusually quiet fleet can be
 * retuned without a deploy. A save takes effect immediately on the server
 * (see fleet-config.service.ts) — no restart, no waiting for the next pass.
 *
 * Units here are minutes/hours/counts, the way an operator thinks about them;
 * the server stores and validates milliseconds/seconds. Conversion happens at
 * the edges, not in the numbers shown on screen.
 */

interface FieldSpec {
  key: keyof FleetThresholds
  label: string
  hint: string
  unit: string
  /** Raw-value ↔ displayed-value factor (e.g. 60_000 for ms → minutes). */
  factor: number
  min: number
  max: number
  step?: number
}

const FIELDS: FieldSpec[] = [
  {
    key: 'offlineAfterMs',
    label: 'Offline after',
    hint: 'No check-in for longer than this counts as offline, not a slow network.',
    unit: 'minutes',
    factor: 60_000,
    min: 1,
    max: 60,
  },
  {
    key: 'syncPendingDeep',
    label: 'Sync queue depth',
    hint: 'A queue at least this deep is backing up, not just mid-batch.',
    unit: 'rows',
    factor: 1,
    min: 1,
    max: 1000,
  },
  {
    key: 'oldestPendingStuckMs',
    label: 'Sync queue stuck after',
    hint: 'Any queue, however short, that has not moved in this long is stuck.',
    unit: 'minutes',
    factor: 60_000,
    min: 1,
    max: 1440,
  },
  {
    key: 'pullStaleMs',
    label: 'Not receiving sync after',
    hint: 'A till that has gone this long without a successful pull is missing what its peers record.',
    unit: 'minutes',
    factor: 60_000,
    min: 1,
    max: 1440,
  },
  {
    key: 'recentErrorWindowMs',
    label: 'Error recency window',
    hint: 'Only errors still open and seen inside this window count against health.',
    unit: 'hours',
    factor: 3_600_000,
    min: 1,
    max: 720,
  },
  {
    key: 'errorSpikeGroups',
    label: 'Error spike threshold',
    hint: 'Distinct open faults on one terminal before it is a pattern, not bad luck.',
    unit: 'faults',
    factor: 1,
    min: 1,
    max: 100,
  },
  {
    key: 'flatlineUptimeSec',
    label: 'Sales flatline uptime',
    hint: 'A till up this long with zero sales is either broken or unattended.',
    unit: 'minutes',
    factor: 60,
    min: 10,
    max: 1440,
  },
  {
    key: 'flatlineMinSellingDays',
    label: 'Flatline: normally-selling days',
    hint: 'Only alert on a quiet till that has actually sold on this many of the last 7 days.',
    unit: 'days',
    factor: 1,
    min: 0,
    max: 7,
    step: 1,
  },
]

export function AlertThresholds({ api }: { api: Api }) {
  const [config, setConfig] = useState<FleetConfigRow | null>(null)
  const [defaults, setDefaults] = useState<FleetThresholds | null>(null)
  const [values, setValues] = useState<Partial<Record<keyof FleetThresholds, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const { config, defaults } = await api.fleetConfig()
      setConfig(config)
      setDefaults(defaults)
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(config[f.key] / f.factor)])))
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return
      if (err instanceof Forbidden) return setForbidden(true)
      setError(err instanceof Error ? err.message : 'Could not load thresholds')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) return null // Viewers/operators simply don't see this section.
  if (config == null || defaults == null) return null

  const dirty = FIELDS.some((f) => Number(values[f.key]) * f.factor !== config[f.key])

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const patch: Partial<FleetThresholds> = {}
      for (const f of FIELDS) {
        const n = Number(values[f.key])
        if (!Number.isFinite(n)) continue
        patch[f.key] = Math.round(n * f.factor) as never
      }
      const row = await api.updateFleetConfig(patch)
      setConfig(row)
      setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(row[f.key] / f.factor)])))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save thresholds')
    } finally {
      setBusy(false)
    }
  }

  function resetToDefaults() {
    if (!defaults) return
    setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(defaults[f.key] / f.factor)])))
    setSaved(false)
  }

  return (
    <section className="panel" style={{ padding: 16, marginTop: 24 }}>
      <div className="cmd-head" style={{ marginBottom: 4 }}>
        <span className="strong">Alert thresholds</span>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        What counts as a problem, fleet-wide. Changes apply immediately — no restart, no waiting
        for the next evaluator pass.
        {config.updatedBy && (
          <> Last changed {timeAgo(config.updatedAt)}.</>
        )}
      </p>

      {error && <Notice>{error}</Notice>}

      <div className="form-grid">
        {FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step ?? 1}
                value={values[f.key] ?? ''}
                aria-label={f.label}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                style={{ maxWidth: 120 }}
              />
              <span className="muted small">{f.unit}</span>
            </div>
            <span className="hint">{f.hint}</span>
          </label>
        ))}
      </div>

      <div className="form-actions" style={{ marginTop: 14 }}>
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
          Save thresholds
        </Button>
        <Button variant="ghost" disabled={busy} onClick={resetToDefaults}>
          Reset to defaults
        </Button>
        {saved && !dirty && <span className="hint">Saved.</span>}
      </div>
    </section>
  )
}
