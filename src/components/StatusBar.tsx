import { useAwaitingApproval, useOverview } from '../data.ts'
import { count, plural } from '../lib/format.ts'
import { href } from '../lib/router.ts'
import { Live } from './ui.tsx'

/** The fleet's pulse, on every page: how many tills are fine, and what's open. */
export function StatusBar() {
  const o = useOverview()
  const c = o.data?.counts
  // A fix held for a second operator is nobody's job until somebody sees it.
  const awaiting = useAwaitingApproval().data?.length ?? 0
  return (
    <footer className="statusbar" role="region" aria-label="Fleet status">
      {c ? (
        <>
          <a href={href('/tills', { state: 'healthy' })}>
            <span className="dot healthy" /> {count(c.healthy)} working
          </a>
          <a href={href('/tills', { state: 'attention' })}>
            <span className="dot attention" /> {count(c.attention)} need a look
          </a>
          <a href={href('/tills', { state: 'offline' })}>
            <span className="dot offline" /> {count(c.offline)} offline
          </a>
          <a href={href('/alerts')}>{count(o.data!.openAlerts)} open alerts</a>
          {awaiting > 0 && (
            <a href={href('/fixes', { state: 'awaiting_approval' })}>
              <span className="dot attention" /> {plural(awaiting, 'fix', 'fixes')} to approve
            </a>
          )}
        </>
      ) : (
        <span className="muted">Loading the fleet…</span>
      )}
      <span className="statusbar-live">
        <Live updatedAt={o.updatedAt} busy={o.refreshing} />
      </span>
    </footer>
  )
}
