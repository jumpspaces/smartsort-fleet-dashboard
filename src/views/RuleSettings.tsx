/**
 * Which alerts fire, how loudly, and what to do about them.
 *
 * The thresholds panel above decides WHEN a rule trips. This decides whether we
 * want to hear about it at all — a distinction that matters because without it
 * people express "stop telling me about quiet tills" by setting a threshold to
 * something absurd, which silently breaks the rule for the cases where it was
 * doing its job.
 *
 * The runbook field is the small one that changes an alert's character: a page
 * that arrives with a link to the fix is a different object from one that
 * arrives with a description of a problem.
 */
import { useCallback, useEffect, useState } from 'react'
import { Forbidden, type Api, type Digest, type RuleRow } from '../api.ts'
import { Button, Card, Chip, Notice } from '../components/ui.tsx'

export function RuleSettings({ api }: { api: Api }) {
  const [rules, setRules] = useState<RuleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [runbook, setRunbook] = useState('')
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    try {
      setRules(await api.rules())
      setError(null)
    } catch (err) {
      if (err instanceof Forbidden) return setForbidden(true)
      setError(err instanceof Error ? err.message : 'Could not load the rules')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) return null

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  const off = rules?.filter((r) => !r.enabled).length ?? 0

  return (
    <Card
      title="What raises an alert"
      actions={off > 0 ? <Chip tone="warn">{off} switched off</Chip> : undefined}
    >
      {error && <Notice>{error}</Notice>}

      {rules?.map((r) => (
        <div key={r.key} className="note-item">
          <div className="cell-stack">
            <span className="strong">{r.label}</span>
            <span className="mono muted small">{r.key}</span>
            {!r.enabled && <Chip tone="warn">Off</Chip>}
            {r.severity && <Chip tone={r.severity === 'critical' ? 'bad' : 'warn'}>
              Forced {r.severity}
            </Chip>}
            {r.runbookUrl && (
              <a className="row-open small" href={r.runbookUrl} target="_blank" rel="noreferrer">
                Runbook
              </a>
            )}
          </div>
          <div className="note-body muted small">{r.description}</div>

          <div className="note-meta">
            <Button
              size="sm"
              variant="ghost"
              busy={busy === `${r.key}:on`}
              onClick={() => void run(`${r.key}:on`, () => api.updateRule(r.key, { enabled: !r.enabled }))}
            >
              {r.enabled ? 'Switch off' : 'Switch on'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              busy={busy === `${r.key}:sev`}
              onClick={() =>
                void run(`${r.key}:sev`, () =>
                  api.updateRule(r.key, {
                    // Three states, cycled: leave it alone → force critical →
                    // force warning → leave it alone.
                    severity:
                      r.severity === null ? 'critical' : r.severity === 'critical' ? 'warning' : null,
                  }),
                )
              }
            >
              {r.severity === null
                ? 'Force critical'
                : r.severity === 'critical'
                  ? 'Force warning'
                  : 'Use the default severity'}
            </Button>
            {editing === r.key ? (
              <>
                <input
                  className="input"
                  value={runbook}
                  autoFocus
                  placeholder="https://…"
                  aria-label={`Runbook link for ${r.label}`}
                  onChange={(e) => setRunbook(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null)
                    if (e.key !== 'Enter') return
                    void run(`${r.key}:book`, async () => {
                      await api.updateRule(r.key, { runbookUrl: runbook.trim() || null })
                      setEditing(null)
                    })
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(r.key)
                  setRunbook(r.runbookUrl ?? '')
                }}
              >
                {r.runbookUrl ? 'Change runbook' : 'Add a runbook link'}
              </Button>
            )}
            {(r.severity || r.runbookUrl || !r.enabled) && (
              <Button
                size="sm"
                variant="ghost"
                busy={busy === `${r.key}:reset`}
                onClick={() => void run(`${r.key}:reset`, () => api.resetRule(r.key))}
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      ))}

      <p className="hint" style={{ marginTop: 10 }}>
        Switching a rule off stops it being raised at all — the console will not show it either,
        which is different from silencing a terminal. Prefer a maintenance window when the terminal
        is the problem, and this when the RULE is.
      </p>
    </Card>
  )
}

/**
 * The daily digest, previewed.
 *
 * Alerts fire when something is wrong, which means a fleet quietly getting worse
 * produces no signal at all. The digest is the only thing here that reports the
 * absence of events — so it needs to be readable before anybody agrees to
 * receive it every morning.
 */
export function DigestPanel({ api }: { api: Api }) {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void api
      .digest()
      .then(setDigest)
      .catch(() => setDigest(null))
  }, [api])

  if (!digest) return null

  return (
    <Card title="Daily digest">
      <p className="hint" style={{ marginBottom: 8 }}>
        Goes to every channel that takes warnings, once a day. This is what it would say right now:
      </p>
      <ul className="plain-list">
        {digest.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {notice && <p className="hint">{notice}</p>}
      {api.operator.role === 'admin' && (
        <Button
          size="sm"
          variant="ghost"
          busy={busy}
          style={{ marginTop: 10 }}
          onClick={() => {
            setBusy(true)
            void api
              .sendDigest()
              .then(() => setNotice('Sent to every channel that takes warnings.'))
              .catch((err: unknown) =>
                setNotice(err instanceof Error ? err.message : 'Could not send it'),
              )
              .finally(() => setBusy(false))
          }}
        >
          Send one now
        </Button>
      )}
    </Card>
  )
}
