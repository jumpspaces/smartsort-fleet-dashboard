import { useCallback, useEffect, useState } from 'react'
import { Forbidden, Unauthorized, type Api, type HolidayFeedStatus, type HolidayRow } from '../api.ts'
import { Button, Card, Chip, Notice } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

/**
 * The festive days every shop's customer screen dresses up for, and on which
 * date. The cloud reads Google's public Ghana holiday calendar daily; this is
 * for when an announcement beats it — Eid above all, which waits on the moon —
 * or the government moves a holiday. A date set here wins over the feed and
 * reaches every till on its next sync.
 *
 * A festive day with no date here is worked out on the till itself, so a blank
 * row is not a missing festive day.
 */

/** In lockstep with server domain/holidays.ts SEASON_IDS, in the order of the year. */
const SEASONS: Array<{ id: string; name: string }> = [
  { id: 'newyear', name: 'New Year' },
  { id: 'valentines', name: 'Valentine’s Day' },
  { id: 'independence', name: 'Independence Day' },
  { id: 'easter', name: 'Easter Sunday' },
  { id: 'eid-fitr', name: 'Eid al-Fitr' },
  { id: 'eid-adha', name: 'Eid al-Adha' },
  { id: 'republic', name: 'Republic Day' },
  { id: 'farmers', name: 'Farmers’ Day' },
  { id: 'christmas', name: 'Christmas Day' },
]

const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export function HolidayCalendar({ api, onUnauthorized }: { api: Api; onUnauthorized: () => void }) {
  const [rows, setRows] = useState<HolidayRow[] | null>(null)
  const [feed, setFeed] = useState<HolidayFeedStatus | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canAct = api.operator.role !== 'viewer'

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Forbidden ? 'Only operators can change festive days.' : err instanceof Error ? err.message : fallback)
    },
    [onUnauthorized],
  )

  const load = useCallback(async () => {
    try {
      const res = await api.holidays()
      setRows(res.holidays)
      setFeed(res.refresh)
    } catch (err) {
      fail(err, 'Could not load the festive days')
    }
  }, [api, fail])

  useEffect(() => {
    void load()
  }, [load])

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      fail(err, 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  const thisYear = new Date().getFullYear()
  const held = (season: string) => rows?.find((r) => r.season === season && r.year === year)

  return (
    <Card
      title="Festive days"
      actions={
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {[thisYear, thisYear + 1].map((y) => (
            <Button key={y} size="sm" variant={y === year ? 'primary' : 'ghost'} onClick={() => setYear(y)}>
              {y}
            </Button>
          ))}
        </span>
      }
    >
      {error && <Notice>{error}</Notice>}
      <p className="hint" style={{ marginBottom: 12 }}>
        The days every shop’s customer screen dresses up for. Read daily from the public Ghana holiday calendar; set a date
        here when an announcement comes first (Eid, a moved holiday) and every till takes it on its next sync. A blank date is
        worked out on the till.
      </p>

      {rows && (
        <table>
          <thead>
            <tr>
              <th>Festive day</th>
              <th>Date</th>
              <th>From</th>
              {canAct && <th aria-label="Change" />}
            </tr>
          </thead>
          <tbody>
            {SEASONS.map(({ id, name }) => {
              const row = held(id)
              const key = `${id}:${year}`
              const draft = drafts[key] ?? ''
              return (
                <tr key={key}>
                  <td className="strong">{name}</td>
                  <td>{row ? shortDay(row.day) : <span className="muted">Worked out on the till</span>}</td>
                  <td>
                    {row ? <Chip tone={row.source === 'manual' ? 'warn' : 'ok'}>{row.source === 'manual' ? 'Set here' : 'Feed'}</Chip> : null}
                  </td>
                  {canAct && (
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input
                          className="input"
                          type="date"
                          aria-label={`${name} ${year}`}
                          min={`${year}-01-01`}
                          max={`${year}-12-31`}
                          value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          busy={busy === key}
                          disabled={!draft || draft === row?.day}
                          onClick={() =>
                            void run(key, async () => {
                              await api.setHoliday(id, draft)
                              setDrafts(({ [key]: _, ...rest }) => rest)
                            })
                          }
                        >
                          Set
                        </Button>
                        {row?.source === 'manual' && (
                          <Button size="sm" variant="ghost" busy={busy === `${key}:clear`} onClick={() => void run(`${key}:clear`, () => api.clearHoliday(id, year))}>
                            Back to feed
                          </Button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="toolbar" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
        {feed && (
          <span className={feed.ok ? 'hint' : 'strong'} title={feed.at ? exact(feed.at) : undefined}>
            {!feed.at
              ? 'The feed has not been read since the server started.'
              : feed.ok
                ? `Feed read ${timeAgo(feed.at)}: ${feed.found} festive days.`
                : `Feed not read ${timeAgo(feed.at)}: ${feed.error}`}
          </span>
        )}
        {canAct && (
          <Button size="sm" variant="ghost" busy={busy === 'refresh'} onClick={() => void run('refresh', () => api.refreshHolidays())}>
            Read feed now
          </Button>
        )}
      </div>
    </Card>
  )
}
