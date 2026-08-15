/**
 * Where pages go, and when they are allowed to arrive.
 *
 * The two settings on this panel exist to make alerting survivable rather than
 * merely present. Severity routing means a team room can take everything while a
 * phone takes only what is worth waking for. Quiet hours mean the 04:00 warning
 * about a shop that opens at nine waits until nine.
 *
 * Both are framed here as HOLDING, never dropping, because that is what the
 * server does and the difference is the whole point: an operator has to be able
 * to make it quiet without wondering what they stopped hearing.
 */
import { useCallback, useEffect, useState } from 'react'
import { Forbidden, type Api, type ChannelRow, type FleetConfigRow } from '../api.ts'
import { Button, Card, Chip, Notice } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

const clockOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(':').map(Number)
  return ((h ?? 0) % 24) * 60 + ((m ?? 0) % 60)
}

export function NotifyRouting({ api }: { api: Api }) {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null)
  const [config, setConfig] = useState<FleetConfigRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  // New-channel form.
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('')
  const [kind, setKind] = useState<'webhook' | 'push_owner'>('webhook')
  const [minSeverity, setMinSeverity] = useState<'warning' | 'critical'>('warning')

  const load = useCallback(async () => {
    try {
      const [c, cfg] = await Promise.all([api.channels(), api.fleetConfig()])
      setChannels(c)
      setConfig(cfg.config)
      setError(null)
    } catch (err) {
      if (err instanceof Forbidden) return setForbidden(true)
      setError(err instanceof Error ? err.message : 'Could not load alert routing')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) return null

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  const quietOn = config != null && config.quietStartMinute !== config.quietEndMinute

  return (
    <>
      <Card title="Where alerts go">
        {error && <Notice>{error}</Notice>}
        {notice && <p className="hint">{notice}</p>}

        {channels?.length === 0 && (
          <p className="muted small">
            Nothing is configured, so alerts are recorded here and nowhere else. Add a webhook — a
            Slack or Discord incoming URL works as-is — or turn on owner push so a shop hears about
            its own till.
          </p>
        )}

        {channels?.map((ch) => (
          <div key={ch.id} className="note-item">
            <div className="cell-stack">
              <span className="strong">{ch.label}</span>
              <Chip tone={ch.active ? 'ok' : 'idle'}>{ch.active ? 'On' : 'Off'}</Chip>
              <Chip tone="idle">
                {ch.kind === 'push_owner' ? 'Owner phones' : 'Webhook'}
              </Chip>
              <Chip tone={ch.minSeverity === 'critical' ? 'warn' : 'idle'}>
                {ch.minSeverity === 'critical' ? 'Criticals only' : 'Everything'}
              </Chip>
              {ch.managed && <Chip tone="idle">From server config</Chip>}
              {!ch.respectQuietHours && <Chip tone="warn">Ignores quiet hours</Chip>}
            </div>

            {ch.target && <div className="row-sub mono">{ch.target}</div>}

            <div className="note-meta">
              {ch.lastSuccessAt && (
                <span title={exact(ch.lastSuccessAt)}>Last delivered {timeAgo(ch.lastSuccessAt)}</span>
              )}
              {ch.lastError && <span className="bad-text">{ch.lastError}</span>}
              {!ch.lastSuccessAt && !ch.lastError && <span>Nothing sent yet</span>}
            </div>

            <div className="toolbar" style={{ gap: 8, marginTop: 8 }}>
              <Button
                size="sm"
                variant="ghost"
                busy={busy === `${ch.id}:active`}
                onClick={() =>
                  void run(`${ch.id}:active`, () => api.updateChannel(ch.id, { active: !ch.active }))
                }
              >
                {ch.active ? 'Turn off' : 'Turn on'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                busy={busy === `${ch.id}:sev`}
                onClick={() =>
                  void run(`${ch.id}:sev`, () =>
                    api.updateChannel(ch.id, {
                      minSeverity: ch.minSeverity === 'critical' ? 'warning' : 'critical',
                    }),
                  )
                }
              >
                {ch.minSeverity === 'critical' ? 'Send everything' : 'Criticals only'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                busy={busy === `${ch.id}:quiet`}
                onClick={() =>
                  void run(`${ch.id}:quiet`, () =>
                    api.updateChannel(ch.id, { respectQuietHours: !ch.respectQuietHours }),
                  )
                }
              >
                {ch.respectQuietHours ? 'Ignore quiet hours' : 'Respect quiet hours'}
              </Button>
              {ch.kind === 'webhook' && (
                <Button
                  size="sm"
                  variant="ghost"
                  busy={busy === `${ch.id}:test`}
                  onClick={() =>
                    void run(`${ch.id}:test`, async () => {
                      const res = await api.testChannel(ch.id)
                      setNotice(
                        res.ok
                          ? `${ch.label} accepted the test message.`
                          : `${ch.label} did not accept it: ${res.error ?? 'no detail'}`,
                      )
                    })
                  }
                >
                  Send a test
                </Button>
              )}
              {!ch.managed && (
                <Button
                  size="sm"
                  variant="danger"
                  busy={busy === `${ch.id}:del`}
                  onClick={() => void run(`${ch.id}:del`, () => api.deleteChannel(ch.id))}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="toolbar" style={{ gap: 8 }}>
            <select
              className="input"
              value={kind}
              aria-label="Channel kind"
              onChange={(e) => setKind(e.target.value as 'webhook' | 'push_owner')}
            >
              <option value="webhook">Webhook</option>
              <option value="push_owner">Owner phones</option>
            </select>
            <input
              className="input"
              value={label}
              placeholder="Name — Ops room, On-call…"
              aria-label="Channel name"
              onChange={(e) => setLabel(e.target.value)}
            />
            {kind === 'webhook' && (
              <input
                className="input"
                value={target}
                placeholder="https://hooks.slack.com/…"
                aria-label="Webhook URL"
                onChange={(e) => setTarget(e.target.value)}
              />
            )}
            <select
              className="input"
              value={minSeverity}
              aria-label="Severity"
              onChange={(e) => setMinSeverity(e.target.value as 'warning' | 'critical')}
            >
              <option value="warning">Everything</option>
              <option value="critical">Criticals only</option>
            </select>
            <Button
              size="sm"
              busy={busy === 'new'}
              disabled={!label.trim() || (kind === 'webhook' && !target.trim())}
              onClick={() =>
                void run('new', async () => {
                  await api.createChannel({
                    kind,
                    label: label.trim(),
                    target: kind === 'webhook' ? target.trim() : null,
                    minSeverity,
                  })
                  setLabel('')
                  setTarget('')
                })
              }
            >
              Add
            </Button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            <b>Owner phones</b> pushes a shop's own alerts to its owner through the mobile app —
            their till is offline, their machine is being refused. It never carries fleet-wide
            alerts, which are ours and not theirs.
          </p>
        </div>
      </Card>

      <Card title="Quiet hours">
        {config == null ? (
          <div className="skeleton" style={{ width: '50%' }} />
        ) : (
          <>
            <div className="toolbar" style={{ gap: 12 }}>
              <label className="muted small">
                From
                <input
                  className="input"
                  type="time"
                  value={clockOf(config.quietStartMinute)}
                  onChange={(e) =>
                    setConfig({ ...config, quietStartMinute: minutesOf(e.target.value) })
                  }
                />
              </label>
              <label className="muted small">
                To
                <input
                  className="input"
                  type="time"
                  value={clockOf(config.quietEndMinute)}
                  onChange={(e) =>
                    setConfig({ ...config, quietEndMinute: minutesOf(e.target.value) })
                  }
                />
              </label>
              <label className="muted small">
                Timezone
                <input
                  className="input"
                  value={config.quietTimezone}
                  aria-label="Quiet hours timezone"
                  onChange={(e) => setConfig({ ...config, quietTimezone: e.target.value })}
                />
              </label>
              <label className="muted small">
                Criticals
                <select
                  className="input"
                  value={config.quietBreakthrough}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      quietBreakthrough: e.target.value as 'critical' | 'none',
                    })
                  }
                >
                  <option value="critical">Still get through</option>
                  <option value="none">Wait as well</option>
                </select>
              </label>
              <Button
                size="sm"
                busy={busy === 'settings'}
                onClick={() =>
                  void run('settings', () =>
                    api.updateFleetSettings({
                      quietStartMinute: config.quietStartMinute,
                      quietEndMinute: config.quietEndMinute,
                      quietTimezone: config.quietTimezone,
                      quietBreakthrough: config.quietBreakthrough,
                      sloTargetBps: config.sloTargetBps,
                    }),
                  )
                }
              >
                Save
              </Button>
            </div>

            <p className="hint" style={{ marginTop: 8 }}>
              {quietOn
                ? `Between ${clockOf(config.quietStartMinute)} and ${clockOf(config.quietEndMinute)} in ${config.quietTimezone}, alerts are HELD rather than sent — they arrive when the window closes. ${
                    config.quietBreakthrough === 'critical'
                      ? 'Criticals go out anyway.'
                      : 'Even criticals wait.'
                  }`
                : 'No quiet window: set the two times differently to enable one. Nothing is ever dropped — a held alert is delivered when the window ends.'}
            </p>

            <div className="toolbar" style={{ gap: 12, marginTop: 14 }}>
              <label className="muted small">
                Availability target
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="50"
                  max="100"
                  value={(config.sloTargetBps / 100).toFixed(2)}
                  aria-label="Availability target percentage"
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      sloTargetBps: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <span className="hint">
                What every terminal is measured against on the Trends page. The gap between this and
                reality is the error budget a shop spends when it goes dark.
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  )
}
