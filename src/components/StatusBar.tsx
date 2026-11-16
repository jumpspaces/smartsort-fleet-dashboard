import { useOverview } from '../data.ts'
import { count } from '../lib/format.ts'
import { href } from '../lib/router.ts'
import { Live } from './ui.tsx'

/** The fleet's pulse, on every page: how many tills are fine, and what's open. */
export function StatusBar() {
  const o = useOverview()
  const c = o.data?.counts
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
