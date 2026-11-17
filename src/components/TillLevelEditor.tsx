import { useState, type FormEvent } from 'react'
import type { ConfigPatch, KeptNotice, NoticeInput, TillConfig, TillConfigKey } from '../api/types.ts'
import { duration, plural, until } from '../lib/format.ts'
import { useAction } from '../lib/query.ts'
import { ErrorNote, Segmented } from './ui.tsx'

/**
 * Editing what the console KEEPS for tills — a message on their screens and
 * how often they check in and back up — at any level: the whole fleet, one
 * shop, one till. The till takes the result up on every check-in, so nothing
 * set here expires except a message, at the end its sender chose.
 */

export const NOTICE_HOURS = [1, 2, 4, 8, 24, 48, 72, 168]
const INTERVALS = [60, 120, 180, 300, 600, 900]
const BACKUPS = [2, 4, 6, 8, 12, 24]

/** What a till does when nothing anywhere sets it. */
export const BUILD_DEFAULT: Required<TillConfig> = { reportIntervalSec: 180, backupEveryHours: 12 }

const KEYS: { key: TillConfigKey; label: string; choices: number[]; text: (v: number) => string }[] = [
  { key: 'reportIntervalSec', label: 'Checks in', choices: INTERVALS, text: (v) => `every ${duration(v * 1000)}` },
  { key: 'backupEveryHours', label: 'Backs up', choices: BACKUPS, text: (v) => `every ${plural(v, 'hour')}` },
]

export const hoursLabel = (h: number) => (h < 24 ? plural(h, 'hour') : plural(h / 24, 'day'))

/** What applies to a key when a level sets nothing, and where that comes from. */
export type Below = Record<TillConfigKey, { value: number; from: string }>

/** The value under a level: the first of `levels` that sets it, else the build's default. */
export function belowOf(levels: { config?: TillConfig; from: string }[]): Below {
  const out = {} as Below
  for (const { key } of KEYS) {
    const hit = levels.find((l) => typeof l.config?.[key] === 'number')
    out[key] = hit ? { value: hit.config![key]!, from: hit.from } : { value: BUILD_DEFAULT[key], from: 'the default' }
  }
  return out
}

/* --------------------------------------------------------------- message --- */

export function MessageEditor({
  id,
  current,
  canAct,
  placeholder,
  hint,
  submitLabel = 'Show on tills',
  onShow,
  onClear,
}: {
  id: string
  /** The button's words when nothing is showing yet. */
  submitLabel?: string
  /** This level's own message, if it has one. */
  current: KeptNotice | null | undefined
  canAct: boolean
  placeholder: string
  hint: string
  onShow: (n: NoticeInput) => Promise<unknown>
  onClear: () => Promise<unknown>
}) {
  const [text, setText] = useState('')
  const [tone, setTone] = useState<'info' | 'warn'>('info')
  const [hours, setHours] = useState(24)
  const show = useAction(async () => {
    await onShow({ text: text.trim(), tone, hours })
    setText('')
  })
  const clear = useAction(onClear)
  const live = current && Date.parse(current.until) > Date.now() ? current : null

  return (
    <div className="stack" style={{ gap: 8 }}>
      {live && (
        <div className={`notice ${live.tone === 'warn' ? 'warn' : 'info'}`}>
          <span style={{ flex: 1 }}>
            On screen, comes down {until(live.until)}: “{live.text}”{live.by ? ` — ${live.by}` : ''}
          </span>
          {canAct && (
            <button className="btn sm" disabled={clear.pending} onClick={() => void clear.run()}>
              Take down
            </button>
          )}
        </div>
      )}
      {canAct && (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (text.trim()) void show.run()
          }}
        >
          <label htmlFor={id} className="small" style={{ fontWeight: 550 }}>
            Show a message
          </label>
          <textarea
            id={id}
            className="textarea"
            rows={2}
            maxLength={280}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
          />
          <div className="row">
            <Segmented
              label="Tone"
              value={tone}
              options={[
                { value: 'info', label: 'Note' },
                { value: 'warn', label: 'Warning' },
              ]}
              onChange={setTone}
            />
            <select className="select" aria-label="For how long" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {NOTICE_HOURS.map((h) => (
                <option key={h} value={h}>
                  for {hoursLabel(h)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn sm primary" disabled={show.pending || !text.trim()} style={{ marginLeft: 'auto' }}>
              {live ? 'Replace message' : submitLabel}
            </button>
          </div>
          <div className="hint">
            {hint} {280 - text.length} characters left.
          </div>
        </form>
      )}
      {(show.error || clear.error) && <ErrorNote error={(show.error ?? clear.error)!} />}
    </div>
  )
}

/* -------------------------------------------------------------- settings --- */

export function ConfigEditor({
  own,
  below,
  canAct,
  hint,
  onApply,
}: {
  /** What this level sets itself. */
  own: TillConfig
  /** What applies where it sets nothing. */
  below: Below
  canAct: boolean
  hint?: string
  onApply: (patch: ConfigPatch) => Promise<unknown>
}) {
  const [choice, setChoice] = useState<Record<TillConfigKey, string>>({ reportIntervalSec: '', backupEveryHours: '' })
  const patch: ConfigPatch = {}
  for (const { key } of KEYS) {
    if (choice[key] === 'follow') patch[key] = null
    else if (choice[key] !== '') patch[key] = Number(choice[key])
  }
  const changed = Object.keys(patch).length > 0
  const apply = useAction(async () => {
    await onApply(patch)
    setChoice({ reportIntervalSec: '', backupEveryHours: '' })
  })

  return (
    <div className="stack" style={{ gap: 10 }}>
      <dl className="kv" style={{ margin: 0 }}>
        {KEYS.map(({ key, label, text }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {own[key] != null ? (
                <>
                  {text(own[key]!)} <span className="muted">(set here)</span>
                </>
              ) : (
                <>
                  {text(below[key].value)} <span className="muted">({below[key].from})</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {canAct && (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (changed) void apply.run()
          }}
        >
          <div className="row">
            {KEYS.map(({ key, label, choices, text }) => (
              <select
                key={key}
                className="select"
                aria-label={label}
                value={choice[key]}
                onChange={(e) => setChoice({ ...choice, [key]: e.target.value })}
              >
                <option value="">{label}: no change</option>
                {own[key] != null && (
                  <option value="follow">
                    {label}: as {below[key].from} ({text(below[key].value)})
                  </option>
                )}
                {choices.map((v) => (
                  <option key={v} value={v}>
                    {label} {text(v)}
                  </option>
                ))}
              </select>
            ))}
            <button type="submit" className="btn sm primary" disabled={!changed || apply.pending}>
              Apply
            </button>
          </div>
          {hint && <div className="hint">{hint}</div>}
          {apply.error && <ErrorNote error={apply.error} />}
        </form>
      )}
    </div>
  )
}
