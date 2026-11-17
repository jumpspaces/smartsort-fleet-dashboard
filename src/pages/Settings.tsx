import { useState, type FormEvent } from 'react'
import * as api from '../api/endpoints.ts'
import { HttpError } from '../api/client.ts'
import type { Channel, ChannelKind, FleetConfig, Role, Thresholds } from '../api/types.ts'
import { ActionError, ConfirmButton, Dialog, Field, Toggle } from '../components/forms.tsx'
import { describeRule, LimitsEditor } from '../components/LimitsEditor.tsx'
import { Bars } from '../components/Bars.tsx'
import { Card, Empty, Loadable, PageHeader, Segmented, When } from '../components/ui.tsx'
import { useApi, useShops } from '../data.ts'
import { count, date, until } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { href, shopHref, tillHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'
import { Schedules, TillDefaults } from './settings/Tills.tsx'
import { CloudAddress } from './settings/CloudAddress.tsx'
import { StepUpDialog } from '../components/StepUpDialog.tsx'
import { TwoFactorCard } from '../components/TwoFactor.tsx'

const TABS = [
  { id: 'team', label: 'Team' },
  { id: 'rules', label: 'Alert rules' },
  { id: 'detection', label: 'Detection' },
  { id: 'notify', label: 'Notifications' },
  { id: 'quiet', label: 'Quiet periods' },
  { id: 'tills', label: 'Tills' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'festive', label: 'Festive days' },
] as const
type Tab = (typeof TABS)[number]['id']

export function Settings({ params }: { params: URLSearchParams }) {
  const raw = params.get('tab')
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : 'team'
  return (
    <div className="stack">
      <PageHeader title="Settings" sub="How the console watches the fleet, and who can use it." />
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <a key={t.id} href={href('/settings', { tab: t.id === 'team' ? null : t.id })} aria-current={t.id === tab ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {tab === 'team' && (
        <>
          <Team />
          <TwoFactorCard />
          <TwoFactorPolicy />
          <CommandSafety />
        </>
      )}
      {tab === 'rules' && <Rules />}
      {tab === 'detection' && <Detection />}
      {tab === 'notify' && <Notifications />}
      {tab === 'quiet' && <QuietPeriods />}
      {tab === 'tills' && (
        <>
          <TillDefaults />
          <Schedules />
          <CloudAddress />
        </>
      )}
      {tab === 'assistant' && <AssistantSettings />}
      {tab === 'festive' && <Festive />}
    </div>
  )
}

function AdminOnly() {
  return <div className="notice info">Only admins can change this.</div>
}

/* =================================================================== team */

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', operator: 'Operator', viewer: 'Viewer' }
const ROLE_HINT: Record<Role, string> = {
  viewer: 'Can look at everything, change nothing.',
  operator: 'Can also send fixes, handle alerts and work on shops.',
  admin: 'Can also manage the team and the console’s settings.',
}

function Team() {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const ops = useApi('operators', (c, s) => api.operators(c, s), { enabled: isAdmin })
  const [adding, setAdding] = useState(false)
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [clearFor, setClearFor] = useState<{ id: string; name: string } | null>(null)
  const toggle = useAction(async (id: string, active: boolean) => {
    await api.setOperatorActive(client, id, active)
    invalidate('operators')
  })

  if (!isAdmin) {
    return (
      <Card title="Your account">
        <div>
          {session.operator.name} · {session.operator.email}
        </div>
        <div className="small muted">
          {ROLE_LABEL[session.operator.role]} — {ROLE_HINT[session.operator.role]}
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Team"
      sub="Everyone who can sign in to this console."
      flush
      actions={
        <button className="btn sm primary" onClick={() => setAdding(true)}>
          Add someone
        </button>
      }
    >
      <ActionError error={toggle.error} />
      <Loadable q={ops} rows={4}>
        {(list) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Sign-in codes</th>
                  <th>Last signed in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} style={o.active ? undefined : { opacity: 0.6 }}>
                    <td>
                      <div style={{ fontWeight: 550 }}>
                        {o.name}
                        {o.id === session.operator.id && <span className="muted"> (you)</span>}
                      </div>
                      <div className="small muted">{o.email}</div>
                    </td>
                    <td>
                      {ROLE_LABEL[o.role]}
                      {!o.active && <span className="badge neutral" style={{ marginLeft: 6 }}>Disabled</span>}
                    </td>
                    <td className="sub">{o.twoFactorAt ? 'On' : <span className="muted">Off</span>}</td>
                    <td className="sub">
                      <When iso={o.lastLoginAt} />
                    </td>
                    <td className="r">
                      <span className="row" style={{ justifyContent: 'flex-end' }}>
                        {o.twoFactorAt && o.id !== session.operator.id && (
                          <button className="btn sm ghost" onClick={() => setClearFor(o)}>
                            Clear codes
                          </button>
                        )}
                        <button className="btn sm ghost" onClick={() => setResetFor(o.id)}>
                          Set password
                        </button>
                        {o.id !== session.operator.id &&
                          (o.active ? (
                            <ConfirmButton danger confirm="Disable" disabled={toggle.pending} onConfirm={() => void toggle.run(o.id, false)}>
                              Disable
                            </ConfirmButton>
                          ) : (
                            <button className="btn sm" disabled={toggle.pending} onClick={() => void toggle.run(o.id, true)}>
                              Enable
                            </button>
                          ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loadable>
      <AddOperator open={adding} onClose={() => setAdding(false)} />
      <SetPassword id={resetFor} onClose={() => setResetFor(null)} />
      <StepUpDialog
        open={clearFor != null}
        title={`Clear ${clearFor?.name ?? ''}'s sign-in codes`}
        confirm="Clear codes"
        danger
        hint="Your own password. For someone who lost their phone and their recovery codes."
        onClose={() => setClearFor(null)}
        onConfirm={async (password) => {
          await api.resetOperatorTwoFactor(client, clearFor!.id, password)
          invalidate('operators')
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          They're signed out everywhere, and set codes up again at their next sign-in.
        </p>
      </StepUpDialog>
    </Card>
  )
}

function AddOperator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client } = useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('operator')
  const add = useAction(async () => {
    await api.createOperator(client, { name: name.trim(), email: email.trim(), password, role })
    invalidate('operators')
    setName('')
    setEmail('')
    setPassword('')
    onClose()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void add.run()
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add someone to the team">
      <form className="form" onSubmit={submit}>
        <Field label="Name" id="on">
          <input id="on" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" id="oe">
          <input id="oe" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Starting password" id="op" hint="At least 12 characters. They should change it after signing in.">
          <input id="op" className="input" type="password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Role" id="or" hint={ROLE_HINT[role]}>
          <select id="or" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <ActionError error={add.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={add.pending}>
            Add
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Codes for everyone: off by default, and only switchable by an admin who uses them. */
function TwoFactorPolicy() {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const cfg = useApi('config', (c, s) => api.fleetConfig(c, s))
  const save = useAction(async (on: boolean) => {
    await api.updateSettings(client, { requireTwoFactor: on })
    invalidate('config')
    invalidate('twofactor')
  })
  return (
    <Card title="Sign-in codes for everyone">
      <Loadable q={cfg} rows={2}>
        {({ config }) => (
          <div className="stack" style={{ gap: 10 }}>
            <div className="spread">
              <div>
                <div style={{ fontWeight: 550 }}>Every operator must sign in with a code</div>
                <div className="small sub">
                  {config.requireTwoFactor
                    ? 'On. Anyone without codes set up can do nothing else until they set them up.'
                    : 'Off. Each operator chooses. Set up your own first, then turn this on.'}
                </div>
              </div>
              <Toggle
                label="Require sign-in codes"
                checked={config.requireTwoFactor === true}
                disabled={!isAdmin || save.pending}
                onChange={(on) => void save.run(on)}
              />
            </div>
            {!isAdmin && <AdminOnly />}
            <ActionError error={save.error} />
          </div>
        )}
      </Loadable>
    </Card>
  )
}

/**
 * The two-person rule for the drastic remote commands. Every one of them
 * already asks for the sender's password; this adds a second operator.
 */
function CommandSafety() {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const cfg = useApi('config', (c, s) => api.fleetConfig(c, s))
  const save = useAction(async (on: boolean) => {
    await api.updateSettings(client, { requireCommandApproval: on })
    invalidate('config')
  })
  return (
    <Card title="Locking tills and discarding rows" sub="The remote commands that take a till out of service or throw away what it holds.">
      <Loadable q={cfg} rows={2}>
        {({ config }) => (
          <div className="stack" style={{ gap: 10 }}>
            <div className="spread">
              <div>
                <div style={{ fontWeight: 550 }}>A second operator must approve them</div>
                <div className="small sub">
                  {config.requireCommandApproval
                    ? 'On. A lock or a discarded row waits until someone other than its sender approves it, with their own password.'
                    : 'Off. The sender’s own password is enough. Turn this on once the team has two people who can act.'}
                </div>
              </div>
              <Toggle
                label="Require a second operator"
                checked={config.requireCommandApproval}
                disabled={!isAdmin || save.pending}
                onChange={(on) => void save.run(on)}
              />
            </div>
            {!isAdmin && <AdminOnly />}
            <ActionError error={save.error} />
          </div>
        )}
      </Loadable>
    </Card>
  )
}

function SetPassword({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { client } = useSession()
  const [password, setPassword] = useState('')
  const set = useAction(async () => {
    if (!id) return
    await api.setOperatorPassword(client, id, password)
    setPassword('')
    onClose()
  })
  return (
    <Dialog open={!!id} onClose={onClose} title="Set a new password">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void set.run()
        }}
      >
        <Field label="New password" id="np" hint="At least 12 characters.">
          <input id="np" className="input" type="password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ActionError error={set.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={set.pending}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* ============================================================ alert rules */

function Rules() {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const rules = useApi('rules', (c, s) => api.rules(c, s))
  const save = useAction(async (key: string, patch: Parameters<typeof api.updateRule>[2]) => {
    await api.updateRule(client, key, patch)
    invalidate('rules')
  })
  const reset = useAction(async (key: string) => {
    await api.resetRule(client, key)
    invalidate('rules')
  })
  return (
    <Card
      title="Alert rules"
      sub="What raises an alert, how urgent it is, and what to run about it. A rule with a fix runs it on the till when it opens an alert there — at most once in 6 hours for that till, never while its alerts are muted."
      flush
    >
      {!isAdmin && (
        <div style={{ padding: '12px 16px 0' }}>
          <AdminOnly />
        </div>
      )}
      <ActionError error={save.error ?? reset.error} />
      <Loadable q={rules} rows={6}>
        {(list) => (
          <ul className="list">
            {list.map((r) => (
              <li key={r.key}>
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: '1 1 300px' }}>
                    <div style={{ fontWeight: 550 }}>{r.label}</div>
                    <div className="small sub">{r.description}</div>
                    <div className="small muted mono">{r.key}</div>
                    {r.runbookUrl && (
                      <a className="small" href={r.runbookUrl} target="_blank" rel="noreferrer noopener">
                        Runbook
                      </a>
                    )}
                  </div>
                  <div className="row">
                    <select
                      className="select"
                      aria-label={`Urgency for ${r.label}`}
                      disabled={!isAdmin || save.pending}
                      value={r.severity ?? ''}
                      onChange={(e) => void save.run(r.key, { severity: (e.target.value || null) as 'warning' | 'critical' | null })}
                    >
                      <option value="">Default urgency</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Urgent</option>
                    </select>
                    {r.autoFixChoices.length > 0 && (
                      <select
                        className="select"
                        aria-label={`Automatic fix for ${r.label}`}
                        disabled={!isAdmin || save.pending}
                        value={r.autoFix ?? ''}
                        onChange={(e) => void save.run(r.key, { autoFix: e.target.value || null })}
                      >
                        <option value="">Alert only</option>
                        {r.autoFixChoices.map((c) => (
                          <option key={c.value} value={c.value}>
                            Then run: {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <Toggle
                      label={`${r.label} on`}
                      checked={r.enabled}
                      disabled={!isAdmin || save.pending}
                      onChange={(v) => void save.run(r.key, { enabled: v })}
                    />
                    {isAdmin && <RunbookEdit ruleKey={r.key} url={r.runbookUrl} />}
                    {isAdmin && r.updatedBy && (
                      <button className="btn sm ghost" disabled={reset.pending} onClick={() => void reset.run(r.key)} title={`Changed by ${r.updatedBy}`}>
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
    </Card>
  )
}

function RunbookEdit({ ruleKey, url }: { ruleKey: string; url: string | null }) {
  const { client } = useSession()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(url ?? '')
  const save = useAction(async () => {
    const v = value.trim()
    if (v && !/^https?:\/\//.test(v)) throw new Error('A runbook link must start with http:// or https://')
    await api.updateRule(client, ruleKey, { runbookUrl: v || null })
    invalidate('rules')
    setEditing(false)
  })
  if (!editing)
    return (
      <button className="btn sm ghost" onClick={() => setEditing(true)}>
        {url ? 'Edit runbook' : 'Add runbook'}
      </button>
    )
  return (
    <form
      className="row"
      style={{ gap: 4, flexBasis: '100%' }}
      onSubmit={(e) => {
        e.preventDefault()
        void save.run()
      }}
    >
      <input className="input" type="url" autoFocus style={{ flex: 1, minWidth: 220 }} placeholder="https://…" aria-label="Runbook link" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn sm primary" type="submit" disabled={save.pending}>
        Save
      </button>
      <button className="btn sm ghost" type="button" onClick={() => setEditing(false)}>
        Cancel
      </button>
      <ActionError error={save.error} />
    </form>
  )
}

/* ============================================================== detection */

/** Each threshold in the unit a person thinks in. */
const THRESHOLDS: { key: keyof Thresholds; label: string; unit: string; scale: number; hint: string }[] = [
  { key: 'offlineAfterMs', label: 'Call a till offline after', unit: 'minutes', scale: 60_000, hint: 'With no check-in for this long.' },
  { key: 'syncPendingDeep', label: 'Sales piling up at', unit: 'sales waiting', scale: 1, hint: '' },
  { key: 'oldestPendingStuckMs', label: 'Sales stuck after', unit: 'minutes', scale: 60_000, hint: 'When the oldest unsent sale is this old.' },
  { key: 'pullStaleMs', label: 'Not getting changes after', unit: 'minutes', scale: 60_000, hint: '' },
  { key: 'recentErrorWindowMs', label: 'Count app problems from the last', unit: 'hours', scale: 3_600_000, hint: '' },
  { key: 'errorSpikeGroups', label: 'Lots of problems at once at', unit: 'new kinds', scale: 1, hint: '' },
  { key: 'flatlineUptimeSec', label: 'No sales alert after open for', unit: 'minutes', scale: 60, hint: '' },
  { key: 'flatlineMinSellingDays', label: '…only if it sold on at least', unit: 'recent days', scale: 1, hint: '' },
]

function Detection() {
  const cfg = useApi('config', (c, s) => api.fleetConfig(c, s))
  return (
    <Loadable q={cfg} rows={6}>
      {(d) => <DetectionForm key={d.config.updatedAt} config={d.config} defaults={d.defaults} />}
    </Loadable>
  )
}

function DetectionForm({ config, defaults }: { config: FleetConfig; defaults: Thresholds }) {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const [vals, setVals] = useState(() => Object.fromEntries(THRESHOLDS.map((t) => [t.key, String(config[t.key] / t.scale)])))
  const save = useAction(async () => {
    const patch: Partial<Thresholds> = {}
    for (const t of THRESHOLDS) {
      const n = Number(vals[t.key])
      if (!Number.isFinite(n) || n < 0) throw new Error(`“${t.label}” needs a number.`)
      patch[t.key] = Math.round(n * t.scale)
    }
    await api.updateThresholds(client, patch)
    invalidate('config')
    invalidate('device')
    invalidate('overview')
  })
  return (
    <Card title="What counts as a problem" sub={`Last changed ${date(config.updatedAt)}${config.updatedBy ? ` by ${config.updatedBy}` : ''}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        {!isAdmin && <AdminOnly />}
        <div className="form-grid">
          {THRESHOLDS.map((t) => (
            <Field key={t.key} id={t.key} label={t.label} hint={`${t.unit}${t.hint ? ` · ${t.hint}` : ''} · default ${defaults[t.key] / t.scale}`}>
              <input
                id={t.key}
                className="input"
                type="number"
                min={0}
                disabled={!isAdmin}
                value={vals[t.key]}
                onChange={(e) => setVals((v) => ({ ...v, [t.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <ActionError error={save.error} />
        {isAdmin && (
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={save.pending}>
              {save.pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </Card>
  )
}

/* ========================================================== notifications */

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromTime = (s: string) => {
  const [h = '0', m = '0'] = s.split(':')
  return Number(h) * 60 + Number(m)
}

function Notifications() {
  const cfg = useApi('config', (c, s) => api.fleetConfig(c, s))
  const chans = useApi('channels', (c, s) => api.channels(c, s))
  const { session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const [editing, setEditing] = useState<Channel | 'new' | null>(null)
  return (
    <div className="stack">
      <Loadable q={cfg} rows={3}>
        {(d) => <QuietHours key={d.config.updatedAt} config={d.config} />}
      </Loadable>
      <Card
        title="Where alerts go"
        sub="Each channel gets alerts of its urgency or above."
        flush
        actions={
          isAdmin && (
            <button className="btn sm primary" onClick={() => setEditing('new')}>
              Add a channel
            </button>
          )
        }
      >
        <Loadable q={chans} rows={3}>
          {(list) =>
            list.length === 0 ? (
              <Empty title="No channels">Alerts show here in the console but go nowhere else.</Empty>
            ) : (
              <ul className="list">
                {list.map((c) => (
                  <ChannelItem key={c.id} c={c} onEdit={() => setEditing(c)} />
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>
      {isAdmin && <ChannelDialog channel={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function QuietHours({ config }: { config: FleetConfig }) {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const [start, setStart] = useState(toTime(config.quietStartMinute))
  const [end, setEnd] = useState(toTime(config.quietEndMinute))
  const [tz, setTz] = useState(config.quietTimezone)
  const [breakthrough, setBreakthrough] = useState(config.quietBreakthrough)
  const [target, setTarget] = useState(String(config.sloTargetBps / 100))
  const save = useAction(async () => {
    const bps = Math.round(Number(target) * 100)
    if (!Number.isFinite(bps) || bps < 5000 || bps > 10000) throw new Error('The uptime target must be between 50% and 100%.')
    await api.updateSettings(client, {
      quietStartMinute: fromTime(start),
      quietEndMinute: fromTime(end),
      quietTimezone: tz.trim(),
      quietBreakthrough: breakthrough,
      sloTargetBps: bps,
    })
    invalidate('config')
    invalidate('slo')
  })
  return (
    <Card title="Quiet hours and uptime target">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        {!isAdmin && <AdminOnly />}
        <div className="form-grid">
          <Field label="Quiet from" id="qs" hint="Same start and end = never quiet.">
            <input id="qs" className="input" type="time" disabled={!isAdmin} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Quiet until" id="qe">
            <input id="qe" className="input" type="time" disabled={!isAdmin} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Time zone" id="qt">
            <input id="qt" className="input" disabled={!isAdmin} value={tz} onChange={(e) => setTz(e.target.value)} />
          </Field>
          <Field label="During quiet hours" id="qb">
            <select id="qb" className="select" disabled={!isAdmin} value={breakthrough} onChange={(e) => setBreakthrough(e.target.value as 'critical' | 'none')}>
              <option value="critical">Urgent alerts still go out</option>
              <option value="none">Hold everything until morning</option>
            </select>
          </Field>
          <Field label="Uptime target (%)" id="qslo" hint="What each shop is expected to reach.">
            <input id="qslo" className="input" type="number" step="0.01" min={50} max={100} disabled={!isAdmin} value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        </div>
        {config.webhookLastFailureAt && (
          <div className="notice warn">
            The alert webhook last failed <When iso={config.webhookLastFailureAt} />: {config.webhookLastFailureError}
          </div>
        )}
        <ActionError error={save.error} />
        {isAdmin && (
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={save.pending}>
              Save
            </button>
          </div>
        )}
      </form>
    </Card>
  )
}

const KIND_LABEL: Record<ChannelKind, string> = { webhook: 'Webhook', push_owner: 'Shop owner’s phone' }

function ChannelItem({ c, onEdit }: { c: Channel; onEdit: () => void }) {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const [result, setResult] = useState<string | null>(null)
  const test = useAction(async () => {
    const r = await api.testChannel(client, c.id)
    setResult(r.ok ? 'Test delivered.' : `Test failed: ${r.error ?? 'unknown error'}`)
    invalidate('channels')
  })
  const del = useAction(async () => {
    await api.deleteChannel(client, c.id)
    invalidate('channels')
  })
  return (
    <li>
      <div className="spread">
        <div>
          <div style={{ fontWeight: 550 }}>
            {c.label} {!c.active && <span className="badge neutral">Off</span>}
          </div>
          <div className="small sub">
            {KIND_LABEL[c.kind]} · {c.minSeverity === 'critical' ? 'urgent only' : 'warnings and urgent'}
            {c.respectQuietHours ? ' · respects quiet hours' : ' · ignores quiet hours'}
            {c.ruleKeys?.length ? ` · ${c.ruleKeys.length} rules only` : ''}
          </div>
          {c.target && <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>{c.target}</div>}
          <div className="small muted">
            {c.lastSuccessAt ? (
              <>
                Last delivered <When iso={c.lastSuccessAt} />
              </>
            ) : (
              'Never delivered'
            )}
            {c.lastFailureAt && c.lastError && <span style={{ color: 'var(--bad)' }}> · last failure: {c.lastError}</span>}
          </div>
          {result && <div className="small">{result}</div>}
        </div>
        {isAdmin && (
          <span className="row">
            <button className="btn sm" disabled={test.pending} onClick={() => void test.run()}>
              Send a test
            </button>
            {!c.managed && (
              <>
                <button className="btn sm ghost" onClick={onEdit}>
                  Edit
                </button>
                <ConfirmButton danger confirm="Delete" disabled={del.pending} onConfirm={() => void del.run()}>
                  Delete
                </ConfirmButton>
              </>
            )}
          </span>
        )}
      </div>
      <ActionError error={test.error ?? del.error} />
    </li>
  )
}

function ChannelDialog({ channel, onClose }: { channel: Channel | 'new' | null; onClose: () => void }) {
  return (
    <Dialog open={!!channel} onClose={onClose} title={channel === 'new' ? 'Add a channel' : 'Edit channel'}>
      {channel && <ChannelForm key={channel === 'new' ? 'new' : channel.id} channel={channel === 'new' ? null : channel} onDone={onClose} />}
    </Dialog>
  )
}

function ChannelForm({ channel, onDone }: { channel: Channel | null; onDone: () => void }) {
  const { client } = useSession()
  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? 'webhook')
  const [label, setLabel] = useState(channel?.label ?? '')
  const [target, setTarget] = useState(channel?.target ?? '')
  const [minSeverity, setMin] = useState(channel?.minSeverity ?? 'warning')
  const [quiet, setQuiet] = useState(channel?.respectQuietHours ?? true)
  const [active, setActive] = useState(channel?.active ?? true)
  const [onlyRules, setOnlyRules] = useState<string[] | null>(channel?.ruleKeys?.length ? channel.ruleKeys : null)
  const rules = useApi('rules', (c, s) => api.rules(c, s))
  const save = useAction(async () => {
    if (onlyRules && onlyRules.length === 0) throw new Error('Pick at least one rule, or choose “Every rule”.')
    const input = {
      kind,
      label: label.trim(),
      target: kind === 'webhook' ? target.trim() : null,
      minSeverity,
      respectQuietHours: quiet,
      active,
      ruleKeys: onlyRules,
    }
    if (channel) await api.updateChannel(client, channel.id, input)
    else await api.createChannel(client, input)
    invalidate('channels')
    onDone()
  })
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void save.run()
      }}
    >
      <Field label="Name" id="cl">
        <input id="cl" className="input" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Support Slack" />
      </Field>
      <Field label="Type" id="ck">
        <select id="ck" className="select" value={kind} disabled={!!channel} onChange={(e) => setKind(e.target.value as ChannelKind)}>
          <option value="webhook">Webhook (Slack, Discord, SMS relay…)</option>
          <option value="push_owner">Shop owner’s phone</option>
        </select>
      </Field>
      {kind === 'webhook' && (
        <Field label="Webhook address" id="ct">
          <input id="ct" className="input" type="url" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://hooks.slack.com/…" />
        </Field>
      )}
      <div className="form-grid">
        <Field label="Send" id="cm">
          <select id="cm" className="select" value={minSeverity} onChange={(e) => setMin(e.target.value as 'warning' | 'critical')}>
            <option value="warning">Warnings and urgent</option>
            <option value="critical">Urgent only</option>
          </select>
        </Field>
      </div>
      <Field label="Which alerts" id="cr">
        <select id="cr" className="select" value={onlyRules ? 'some' : 'all'} onChange={(e) => setOnlyRules(e.target.value === 'all' ? null : [])}>
          <option value="all">Every rule</option>
          <option value="some">Only the rules I pick</option>
        </select>
      </Field>
      {onlyRules && (
        <div className="stack" style={{ gap: 4, maxHeight: 200, overflowY: 'auto', padding: 8, border: '1px solid var(--line)', borderRadius: 6 }}>
          {(rules.data ?? []).map((r) => (
            <label key={r.key} className="row small" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={onlyRules.includes(r.key)}
                onChange={(e) => setOnlyRules((cur) => (e.target.checked ? [...(cur ?? []), r.key] : (cur ?? []).filter((k) => k !== r.key)))}
              />
              {r.label}
            </label>
          ))}
        </div>
      )}
      <label className="row">
        <Toggle label="Respect quiet hours" checked={quiet} onChange={setQuiet} /> Respect quiet hours
      </label>
      <label className="row">
        <Toggle label="Active" checked={active} onChange={setActive} /> On
      </label>
      <ActionError error={save.error} />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={save.pending}>
          Save
        </button>
      </div>
    </form>
  )
}

/* ========================================================= quiet periods */

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Until tomorrow', minutes: 24 * 60 },
  { label: '3 days', minutes: 3 * 24 * 60 },
  { label: '1 week', minutes: 7 * 24 * 60 },
]

/** Planned work: silence alerts for a till, a shop or everything, for a while. */
function QuietPeriods() {
  const { client, canAct } = useSession()
  const shops = useShops()
  const [all, setAll] = useState(false)
  const list = useApi(`mutes:${all}`, (c, s) => api.mutes(c, all, s), { every: 60_000 })
  const [scope, setScope] = useState<'shop' | 'fleet'>('shop')
  const [shopId, setShopId] = useState('')
  const [minutes, setMinutes] = useState(240)
  const [reason, setReason] = useState('')
  const open = useAction(async () => {
    if (scope === 'shop' && !shopId) throw new Error('Pick a shop.')
    await api.openMute(client, { scope, shopId: scope === 'shop' ? shopId : undefined, minutes, reason: reason.trim() })
    setReason('')
    invalidate('mutes')
    invalidate('device')
  })
  const cancel = useAction(async (id: string) => {
    await api.cancelMute(client, id)
    invalidate('mutes')
    invalidate('device')
  })

  return (
    <div className="stack">
      {canAct && (
        <Card title="Silence alerts for a while" sub="For planned work — a move, a power cut, an upgrade. To silence one till, do it from its page.">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              void open.run()
            }}
          >
            <div className="form-grid">
              <Field label="For" id="ms">
                <select id="ms" className="select" value={scope} onChange={(e) => setScope(e.target.value as 'shop' | 'fleet')}>
                  <option value="shop">One shop</option>
                  <option value="fleet">Every shop</option>
                </select>
              </Field>
              {scope === 'shop' && (
                <Field label="Shop" id="msh">
                  <select id="msh" className="select" value={shopId} onChange={(e) => setShopId(e.target.value)}>
                    <option value="">Choose…</option>
                    {(shops.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="How long" id="mm">
                <select id="mm" className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {DURATIONS.map((d) => (
                    <option key={d.minutes} value={d.minutes}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Why" id="mr">
              <input id="mr" className="input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Shop moving premises" />
            </Field>
            <ActionError error={open.error} />
            <div className="form-actions">
              <button className="btn primary" type="submit" disabled={open.pending || !reason.trim()}>
                Silence
              </button>
            </div>
          </form>
        </Card>
      )}
      <Card
        title={all ? 'All quiet periods' : 'Quiet now'}
        flush
        actions={
          <button className="btn sm ghost" onClick={() => setAll((v) => !v)}>
            {all ? 'Show current only' : 'Show past ones too'}
          </button>
        }
      >
        <ActionError error={cancel.error} />
        <Loadable q={list} rows={3}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="Nothing is silenced" />
            ) : (
              <ul className="list">
                {rows.map((m) => (
                  <li key={m.id} style={m.active ? undefined : { opacity: 0.6 }}>
                    <div className="spread">
                      <div>
                        <div style={{ fontWeight: 550 }}>
                          {m.scope === 'fleet' ? (
                            'Every shop'
                          ) : m.scope === 'shop' && m.shopId ? (
                            <a href={shopHref(m.shopId)}>{m.shopName ?? 'Shop'}</a>
                          ) : m.deviceId ? (
                            <a href={tillHref(m.deviceId)}>Till {m.deviceId.slice(0, 8)}</a>
                          ) : (
                            'Till'
                          )}
                        </div>
                        <div className="small sub">“{m.reason}”</div>
                        <div className="small muted">
                          {m.active ? `Ends ${until(m.endsAt)}` : m.cancelledAt ? `Ended early by ${m.cancelledBy ?? 'someone'}` : `Ended ${date(m.endsAt)}`}
                          {m.createdByLabel && ` · set by ${m.createdByLabel}`}
                        </div>
                      </div>
                      {m.active && canAct && (
                        <button className="btn sm" disabled={cancel.pending} onClick={() => void cancel.run(m.id)}>
                          End now
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>
    </div>
  )
}

/* ============================================================== assistant */

const usd = (micros: number) => {
  const d = micros / 1_000_000
  return d > 0 && d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function AssistantSettings() {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const sw = useApi('assistant', (c, s) => api.assistant(c, s))
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'last_month'>('month')
  const usage = useApi(`assistant:usage:${period}`, (c, s) => api.assistantUsage(c, period, s))
  const [key, setKey] = useState('')
  const act = useAction(async (fn: () => Promise<unknown>) => {
    await fn()
    invalidate('assistant')
  })

  return (
    <Loadable q={sw} rows={6}>
      {(a) => (
        <div className="stack">
          {!isAdmin && <AdminOnly />}
          <Card title="Shop assistant" sub="AI help inside SmartSort. Off here means off for every shop.">
            <div className="stack" style={{ gap: 14 }}>
              <label className="row">
                <Toggle
                  label="Assistant on for the fleet"
                  checked={a.systemEnabled}
                  disabled={!isAdmin || act.pending}
                  onChange={(v) => void act.run(() => api.setSystemAssistant(client, v))}
                />
                <span style={{ fontWeight: 550 }}>{a.systemEnabled ? 'On for shops that have it' : 'Off everywhere'}</span>
                {a.systemChangedBy && (
                  <span className="small muted">
                    · {a.systemChangedBy}, <When iso={a.systemChangedAt} />
                  </span>
                )}
              </label>
              <div className="small sub">
                {a.enabledShops.length} shops have it · {a.notEnabledCount} never given it · {a.blockedShops.length} switched off on purpose
              </div>

              <div>
                <div style={{ fontWeight: 550, marginBottom: 4 }}>Anthropic key</div>
                {a.apiKey.unreadable && <div className="notice warn">The saved key can’t be read any more. Enter it again.</div>}
                <div className="small sub">
                  {a.apiKey.source === 'console'
                    ? `Using ${a.apiKey.hint ?? 'a saved key'}${a.apiKey.setBy ? `, set by ${a.apiKey.setBy}` : ''}`
                    : a.apiKey.source === 'environment'
                      ? 'Using the server’s own key.'
                      : 'No key — the assistant can’t run.'}
                </div>
                {isAdmin && a.apiKey.canStore && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <input
                      className="input"
                      type="password"
                      placeholder="sk-ant-…"
                      aria-label="New Anthropic key"
                      style={{ flex: '1 1 260px', maxWidth: 360 }}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <button
                      className="btn sm primary"
                      disabled={!key.trim() || act.pending}
                      onClick={() => void act.run(async () => {
                        await api.setAssistantKey(client, key.trim())
                        setKey('')
                      })}
                    >
                      Check and save
                    </button>
                    {a.apiKey.source === 'console' && (
                      <ConfirmButton danger confirm="Remove key" disabled={act.pending} onConfirm={() => void act.run(() => api.removeAssistantKey(client))}>
                        Remove
                      </ConfirmButton>
                    )}
                  </div>
                )}
                {isAdmin && !a.apiKey.canStore && <div className="small muted">The server can’t store a key (SECRETS_KEY isn’t set).</div>}
              </div>

              <Field label="Model every shop uses" id="am">
                <select
                  id="am"
                  className="select"
                  style={{ maxWidth: 360 }}
                  disabled={!isAdmin || act.pending}
                  value={a.defaults.model}
                  onChange={(e) => void act.run(() => api.setAssistantModel(client, e.target.value))}
                >
                  {a.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — ${m.price.input}/${m.price.output} per M tokens
                    </option>
                  ))}
                </select>
              </Field>
              <ActionError error={act.error} />
            </div>
          </Card>

          <Card title="Limits for every shop" sub={`On top of the server’s own ceiling of ${a.serverHourlyLimit} requests per hour per shop.`}>
            {isAdmin ? (
              <LimitsEditor key={JSON.stringify(a.limits)} rules={a.limits} scope="fleet" busy={act.pending} onSave={(r) => void act.run(() => api.setFleetLimits(client, r))} />
            ) : a.limits.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {a.limits.map((r, i) => (
                  <li key={i}>{describeRule(r)}</li>
                ))}
              </ul>
            ) : (
              <div className="muted small">No limits.</div>
            )}
          </Card>

          <Card
            title="Use"
            flush
            actions={
              <Segmented
                label="Period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                  { value: 'last_month', label: 'Last month' },
                ]}
              />
            }
          >
            <Loadable q={usage} rows={4}>
              {(u) => (
                <>
                  <div style={{ padding: 16 }} className="stack">
                    <div className="row" style={{ gap: 24 }}>
                      <div>
                        <div className="small sub">Requests</div>
                        <div className="stat-value" style={{ fontSize: 20 }}>{count(u.totals.requests)}</div>
                      </div>
                      <div>
                        <div className="small sub">Estimated cost</div>
                        <div className="stat-value" style={{ fontSize: 20 }}>{usd(u.totals.costMicros)}</div>
                      </div>
                      <div>
                        <div className="small sub">Failed</div>
                        <div className="stat-value" style={{ fontSize: 20 }}>{count(u.totals.errors)}</div>
                      </div>
                    </div>
                    {u.byDay.length > 1 && u.totals.costMicros > 0 && (
                      <Bars
                        label="Daily cost"
                        format={usd}
                        height={64}
                        points={u.byDay.map((d) => ({ key: d.day, value: d.costMicros, label: d.day.slice(5) }))}
                      />
                    )}
                  </div>
                  {u.shops.length > 0 && (
                    <div className="table-wrap" style={{ borderTop: '1px solid var(--line)' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Shop</th>
                            <th className="r">Requests</th>
                            <th className="r">Cost</th>
                            <th>Closest limit</th>
                            <th>Last used</th>
                          </tr>
                        </thead>
                        <tbody>
                          {u.shops.map((s) => (
                            <tr key={s.shopId}>
                              <td className="primary-cell">
                                <a href={shopHref(s.shopId)}>{s.shopName}</a>
                              </td>
                              <td className="r num">{count(s.requests)}</td>
                              <td className="r num">{usd(s.costMicros)}</td>
                              <td style={{ minWidth: 140 }}>
                                {s.nearestLimit ? (
                                  <>
                                    <div className={`meter${s.nearestLimit.share >= 1 ? ' bad' : s.nearestLimit.share > 0.8 ? ' warn' : ''}`}>
                                      <span style={{ width: `${Math.min(100, s.nearestLimit.share * 100)}%` }} />
                                    </div>
                                    <div className="small muted">{Math.round(s.nearestLimit.share * 100)}% of {s.nearestLimit.metric} {s.nearestLimit.period}</div>
                                  </>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td className="sub">
                                <When iso={s.lastUsedAt} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </Loadable>
          </Card>

          {a.blockedShops.length > 0 && (
            <Card title="Switched off on purpose" flush>
              <ul className="list">
                {a.blockedShops.map((b) => (
                  <li key={b.shopId}>
                    <a href={shopHref(b.shopId)} style={{ fontWeight: 550 }}>
                      {b.shopName}
                    </a>
                    <div className="small muted">
                      {b.reason ? `“${b.reason}” · ` : ''}
                      {b.disabledBy ?? 'someone'}, <When iso={b.disabledAt} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </Loadable>
  )
}

/* =========================================================== festive days */

/** Must match the server's season list (domain/holidays.ts), in calendar order. */
const SEASONS: { id: string; name: string }[] = [
  { id: 'newyear', name: 'New Year' },
  { id: 'constitution', name: 'Constitution Day' },
  { id: 'valentines', name: 'Valentine’s Day' },
  { id: 'independence', name: 'Independence Day' },
  { id: 'womens', name: 'International Women’s Day' },
  { id: 'ramadan', name: 'Ramadan (first day)' },
  { id: 'eid-fitr', name: 'Eid al-Fitr' },
  { id: 'easter', name: 'Easter Sunday' },
  { id: 'mayday', name: 'May Day' },
  { id: 'mothers', name: 'Mothers’ Day' },
  { id: 'africa', name: 'African Union Day' },
  { id: 'eid-adha', name: 'Eid al-Adha' },
  { id: 'fathers', name: 'Fathers’ Day' },
  { id: 'republic', name: 'Republic Day' },
  { id: 'founders', name: 'Founders’ Day' },
  { id: 'pink', name: 'Pink October (1 October)' },
  { id: 'blackfriday', name: 'Black Friday' },
  { id: 'farmers', name: 'Farmers’ Day' },
  { id: 'christmas', name: 'Christmas Day' },
]

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const THIS_YEAR = new Date().getFullYear()

function Festive() {
  const { client, canAct } = useSession()
  const [year, setYear] = useState(new Date().getFullYear())
  const h = useApi('holidays', (c, s) => api.holidays(c, s))
  const missing = h.error instanceof HttpError && h.error.status === 404
  const [editing, setEditing] = useState<{ season: string; day: string } | null>(null)
  const act = useAction(async (fn: () => Promise<unknown>) => {
    await fn()
    invalidate('holidays')
    setEditing(null)
  })
  return (
    <Card
      title="Festive days"
      sub="The dates every till's customer screen decorates for. Dates come from a public calendar; set one by hand to override it."
      flush
      actions={
        <span className="row">
          <Segmented
            label="Year"
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
            options={[THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1].map((y) => ({ value: String(y), label: String(y) }))}
          />
          {canAct && (
            <button className="btn sm" disabled={act.pending} onClick={() => void act.run(() => api.refreshHolidays(client))}>
              Read calendar now
            </button>
          )}
        </span>
      }
    >
      <ActionError error={act.error} />
      {missing ? (
        <div style={{ padding: 16 }}>
          <div className="notice warn">
            This server doesn’t have the festive-day calendar yet. Deploy the latest server and this tab will fill in.
          </div>
        </div>
      ) : (
      <Loadable q={h} rows={8}>
        {(d) => (
          <>
            <div style={{ padding: '12px 16px 0' }} className="small muted">
              {d.refresh.at ? (
                <>
                  Calendar last read <When iso={d.refresh.at} /> — {d.refresh.ok ? `${d.refresh.found} dates found` : `failed: ${d.refresh.error}`}
                </>
              ) : (
                'Calendar not read yet since the server started.'
              )}
            </div>
            <ul className="list">
              {SEASONS.map((s) => {
                const row = d.holidays.find((r) => r.season === s.id && r.year === year)
                const isEditing = editing?.season === s.id
                return (
                  <li key={s.id}>
                    <div className="spread">
                      <span style={{ fontWeight: 550 }}>{s.name}</span>
                      <span className="row">
                        {isEditing ? (
                          <>
                            <input
                              type="date"
                              className="input"
                              aria-label={`Date for ${s.name}`}
                              value={editing.day}
                              onChange={(e) => setEditing({ season: s.id, day: e.target.value })}
                            />
                            <button className="btn sm primary" disabled={!editing.day || act.pending} onClick={() => void act.run(() => api.setHoliday(client, s.id, editing.day))}>
                              Save
                            </button>
                            <button className="btn sm ghost" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={row ? 'num' : 'muted'}>{row ? dayLabel(row.day) : 'No date'}</span>
                            {row?.source === 'manual' && <span className="tag">set by hand</span>}
                            {canAct && (
                              <button className="btn sm ghost" onClick={() => setEditing({ season: s.id, day: row?.day ?? `${year}-01-01` })}>
                                Change
                              </button>
                            )}
                            {canAct && row?.source === 'manual' && (
                              <button className="btn sm ghost" disabled={act.pending} onClick={() => void act.run(() => api.clearHoliday(client, s.id, year))}>
                                Use calendar’s
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Loadable>
      )}
    </Card>
  )
}
