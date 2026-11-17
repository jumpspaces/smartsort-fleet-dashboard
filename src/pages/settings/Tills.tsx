import { useState } from 'react'
import * as api from '../../api/endpoints.ts'
import type { ConfigPatch, NoticeInput, Schedule, ScheduleInput, TillSettingsLevel } from '../../api/types.ts'
import { ActionError, ConfirmButton, Dialog, Field, Toggle } from '../../components/forms.tsx'
import { belowOf, ConfigEditor, MessageEditor } from '../../components/TillLevelEditor.tsx'
import { Card, Empty, Loadable, Segmented, When } from '../../components/ui.tsx'
import { useApi, useCommandCatalogue, useRecipes, useShopIndex, useShops } from '../../data.ts'
import { duration, plural, until } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { shopHref, tillHref } from '../../lib/router.ts'
import { useSession } from '../../lib/session.tsx'

/* ============================================================ till defaults */

/** What a level sets, in a few words: "a message · check-ins every 5 min". */
function summary(s: TillSettingsLevel): string {
  const parts: string[] = []
  if (s.lock) parts.push('locked')
  if (s.syncHold) parts.push('sync paused')
  if (s.updateHold) parts.push('kept out of updates')
  if (s.notice && Date.parse(s.notice.until) > Date.now()) parts.push(`a message until ${until(s.notice.until)}`)
  if (s.config?.reportIntervalSec) parts.push(`check-ins every ${duration(s.config.reportIntervalSec * 1000)}`)
  if (s.config?.backupEveryHours) parts.push(`backups every ${plural(s.config.backupEveryHours, 'hour')}`)
  return parts.join(' · ')
}

/**
 * What every till keeps unless its shop or the till itself says otherwise —
 * and, under it, every shop and till that does.
 */
export function TillDefaults() {
  const { client, canAct } = useSession()
  const q = useApi('tillsettings:fleet', (c, s) => api.fleetTillSettings(c, s))
  const shops = useShopIndex()
  const save = async (patch: { notice?: NoticeInput | null; config?: ConfigPatch }) => {
    await api.updateFleetTillSettings(client, patch)
    invalidate('tillsettings')
    invalidate('settings')
  }
  return (
    <Loadable q={q} rows={4}>
      {({ fleet, shops: shopLevels, devices }) => {
        const exceptions = [
          ...shopLevels.map((s) => ({
            key: `s:${s.shopId}`,
            href: shopHref(s.shopId),
            name: shops.get(s.shopId)?.name ?? 'A shop',
            what: summary(s.settings),
          })),
          ...devices.map((d) => ({
            key: `d:${d.deviceId}`,
            href: tillHref(d.deviceId),
            name: `${d.shopName ?? 'Unlinked till'} · ${d.deviceId.slice(0, 12)}`,
            what: summary(d.settings),
          })),
        ].filter((e) => e.what)
        return (
          <>
            <Card title="Every till" sub="What every till keeps unless its shop or the till itself says otherwise. Tills take it up at their next check-in.">
              <div className="stack" style={{ gap: 18 }}>
                <MessageEditor
                  id="fleet-message"
                  current={fleet.notice}
                  canAct={canAct}
                  placeholder="e.g. SmartSort will be down for maintenance from 11pm to midnight tonight. Sales keep working."
                  hint="Shown on every till that has no message of its own or from its shop."
                  onShow={(notice) => save({ notice })}
                  onClear={() => save({ notice: null })}
                />
                <div className="stack" style={{ gap: 6 }}>
                  <div className="small" style={{ fontWeight: 550 }}>
                    How often tills check in and back up
                  </div>
                  <ConfigEditor own={fleet.config ?? {}} below={belowOf([])} canAct={canAct} onApply={(config) => save({ config })} />
                </div>
              </div>
            </Card>
            <Card title="Set differently" sub="Shops and tills with settings of their own, over the ones above." flush>
              {exceptions.length === 0 ? (
                <Empty title="None">Every shop and till runs on the settings above.</Empty>
              ) : (
                <ul className="list">
                  {exceptions.map((e) => (
                    <li key={e.key}>
                      <div className="spread">
                        <a href={e.href}>{e.name}</a>
                        <span className="small sub">{e.what}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )
      }}
    </Loadable>
  )
}

/* ================================================================ schedules */

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

export function cadenceText(s: Pick<Schedule, 'every' | 'weekday' | 'atMinute'>): string {
  return `${s.every === 'week' && s.weekday != null ? WEEKDAYS[s.weekday] : 'Every day'} at ${clock(s.atMinute)}`
}

/** Upkeep that comes round by itself: queued as ordinary commands on each till it covers. */
export function Schedules() {
  const { client, canAct } = useSession()
  const q = useApi('schedules', (c, s) => api.schedules(c, s), { every: 60_000 })
  const [adding, setAdding] = useState(false)
  const toggle = useAction(async (id: string, enabled: boolean) => {
    await api.updateSchedule(client, id, { enabled })
    invalidate('schedules')
  })
  const remove = useAction(async (id: string) => {
    await api.deleteSchedule(client, id)
    invalidate('schedules')
  })
  const runNow = useAction(async (id: string) => {
    await api.runSchedule(client, id)
    invalidate('schedules')
  })
  return (
    <Card
      title="Schedules"
      sub="Upkeep that runs by itself, at shop time. Nothing that takes a till out of service can be scheduled, and anything that interrupts a sale waits for a quiet till."
      actions={
        canAct && (
          <button className="btn sm primary" onClick={() => setAdding(true)}>
            Add a schedule
          </button>
        )
      }
      flush
    >
      <ActionError error={toggle.error ?? remove.error ?? runNow.error} />
      <Loadable q={q} rows={3}>
        {({ schedules }) =>
          schedules.length === 0 ? (
            <Empty title="No schedules">Check every till's database on Sunday nights, say, or unstick one shop's sync every evening.</Empty>
          ) : (
            <ul className="list">
              {schedules.map((s) => (
                <li key={s.id}>
                  <div className="spread" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 280px' }}>
                      <div style={{ fontWeight: 550 }}>{s.label}</div>
                      <div className="small sub">
                        {s.actionLabel} · {s.targetLabel} · {cadenceText(s)}
                        {s.whenQuiet ? ', when quiet' : ''}
                      </div>
                      <div className="small muted">
                        {s.enabled ? <>Next {until(s.nextRunAt)}</> : 'Paused'}
                        {s.lastRunAt && (
                          <>
                            {' · last ran '}
                            <When iso={s.lastRunAt} />
                            {s.lastResult &&
                              `: ${plural(s.lastResult.issued, 'till')}${s.lastResult.skippedTotal ? `, ${s.lastResult.skippedTotal} skipped` : ''}`}
                          </>
                        )}
                      </div>
                      {s.lastResult && s.lastResult.skipped.length > 0 && (
                        <div className="small muted" title={s.lastResult.skipped.map((x) => `${x.deviceId}: ${x.reason}`).join('\n')}>
                          Skipped because: {s.lastResult.skipped[0]!.reason}
                        </div>
                      )}
                    </div>
                    {canAct && (
                      <div className="row">
                        <button className="btn sm" disabled={runNow.pending} onClick={() => void runNow.run(s.id)}>
                          Run now
                        </button>
                        <Toggle label={`${s.label} on`} checked={s.enabled} disabled={toggle.pending} onChange={(v) => void toggle.run(s.id, v)} />
                        <ConfirmButton confirm="Delete" danger disabled={remove.pending} onConfirm={() => void remove.run(s.id)}>
                          Delete
                        </ConfirmButton>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
      <AddSchedule open={adding} onClose={() => setAdding(false)} schedulable={q.data?.commands ?? []} />
    </Card>
  )
}

function AddSchedule({ open, onClose, schedulable }: { open: boolean; onClose: () => void; schedulable: string[] }) {
  const { client } = useSession()
  const recipes = useRecipes()
  const catalogue = useCommandCatalogue()
  const shops = useShops()
  const [label, setLabel] = useState('')
  const [action, setAction] = useState('')
  const [scope, setScope] = useState<'fleet' | 'shop'>('fleet')
  const [shopId, setShopId] = useState('')
  const [every, setEvery] = useState<'day' | 'week'>('week')
  const [weekday, setWeekday] = useState(0)
  const [time, setTime] = useState('03:00')
  const [quiet, setQuiet] = useState(true)

  const choices = [
    ...(recipes.data ?? []).map((r) => ({ value: `recipe:${r.name}`, label: r.label, interrupts: r.holdable })),
    ...(catalogue.data ?? [])
      .filter((c) => schedulable.includes(c.name))
      .map((c) => ({ value: `command:${c.name}`, label: c.label, interrupts: c.quietable })),
  ]
  const chosen = choices.find((c) => c.value === action)

  const create = useAction(async () => {
    const [h, m] = time.split(':').map(Number)
    const input: ScheduleInput = {
      label: label.trim() || chosen?.label || 'Schedule',
      scope,
      target: scope === 'shop' ? shopId : null,
      action,
      every,
      weekday: every === 'week' ? weekday : null,
      atMinute: (h ?? 0) * 60 + (m ?? 0),
      whenQuiet: quiet,
    }
    await api.createSchedule(client, input)
    invalidate('schedules')
    setLabel('')
    setAction('')
    onClose()
  })

  return (
    <Dialog open={open} onClose={onClose} title="Add a schedule">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void create.run()
        }}
      >
        <Field label="What to run" id="sched-action">
          <select id="sched-action" className="select" required value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Choose…</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="On" id="sched-scope">
          <div className="row">
            <Segmented
              label="On which tills"
              value={scope}
              options={[
                { value: 'fleet', label: 'Every till' },
                { value: 'shop', label: 'One shop' },
              ]}
              onChange={setScope}
            />
            {scope === 'shop' && (
              <select className="select" aria-label="Shop" required value={shopId} onChange={(e) => setShopId(e.target.value)}>
                <option value="">Choose a shop…</option>
                {(shops.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Field>
        <Field label="When" id="sched-time" hint="Shop time. Tills silent for a day are skipped — their work would only expire waiting.">
          <div className="row">
            <Segmented
              label="How often"
              value={every}
              options={[
                { value: 'day', label: 'Every day' },
                { value: 'week', label: 'Once a week' },
              ]}
              onChange={setEvery}
            />
            {every === 'week' && (
              <select className="select" aria-label="Day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            <input id="sched-time" className="input" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </Field>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={chosen?.interrupts || quiet} disabled={chosen?.interrupts} onChange={(e) => setQuiet(e.target.checked)} />
          Wait for a quiet till (10 minutes without a sale)
          {chosen?.interrupts && <span className="muted"> — always, for this one</span>}
        </label>
        <Field label="Name (optional)" id="sched-label">
          <input id="sched-label" className="input" maxLength={80} placeholder={chosen?.label ?? 'e.g. Sunday database check'} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <ActionError error={create.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={create.pending || !action || (scope === 'shop' && !shopId)}>
            Add schedule
          </button>
        </div>
      </form>
    </Dialog>
  )
}
