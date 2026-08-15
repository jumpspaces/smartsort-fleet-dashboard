/**
 * What happened to this terminal, in order.
 *
 * The console holds all of this already — alerts, commands, notes, silences,
 * version changes, faults — in six tables rendered as six cards, none of them
 * next to each other. So the question a support call opens with, "what happened
 * to this till", is answered by reading five panels and interleaving them in
 * your head by timestamp.
 *
 * The value here is entirely the ordering. "We pushed 2.5.0 at 14:02, it went
 * offline at 14:09, somebody restarted it at 14:20" is a sentence no single
 * panel can say, and it is usually the whole diagnosis.
 */
import type { TimelineEvent, TimelineKind } from '../api.ts'
import { Icon, type IconName } from './Icon.tsx'
import { exact, timeAgo } from '../lib/format.ts'

const ICON: Record<TimelineKind, IconName> = {
  alert_opened: 'bell',
  alert_resolved: 'check',
  command: 'prompt',
  note: 'note',
  mute: 'mute',
  version: 'rocket',
  error: 'bug',
  rollout: 'rocket',
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="muted small">
        Nothing has happened to this terminal in the window — no alerts, no commands, no version
        changes. For a till, that is the good outcome.
      </p>
    )
  }

  // Day headers, because "14:09" is only useful once you know which day. Dates
  // are grouped rather than repeated on every row: the eye should be able to
  // scan the times.
  let lastDay = ''

  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const day = e.at.slice(0, 10)
        const newDay = day !== lastDay
        lastDay = day
        return (
          <li key={`${e.at}-${i}`} className="timeline-item" data-severity={e.severity ?? undefined}>
            {newDay && <div className="timeline-day">{day}</div>}
            <div className="timeline-row">
              <span className="timeline-dot" data-severity={e.severity ?? undefined}>
                <Icon name={ICON[e.kind]} size={12} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="timeline-title">{e.title}</div>
                {e.detail && <div className="timeline-detail">{e.detail}</div>}
                <div className="note-meta">
                  <span title={exact(e.at)}>{timeAgo(e.at)}</span>
                  {e.actor && <span>{e.actor}</span>}
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
