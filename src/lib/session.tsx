import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createClient, type Client } from '../api/client.ts'
import type { Session } from '../api/types.ts'

/**
 * The signed-in session, stored under the same key the old console used so a
 * deploy doesn't sign everyone out.
 */
const KEY = 'fleet_session'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    return s.apiBase && s.accessToken && s.refreshToken && s.operator ? (s as Session) : null
  } catch {
    return null
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    // Private windows can refuse storage; the session then lasts the tab.
  }
}

interface Ctx {
  client: Client
  session: Session
  canAct: boolean
  signOut: () => void
}

const SessionContext = createContext<Ctx | null>(null)

export function SessionProvider({
  session,
  onExpired,
  onSignOut,
  children,
}: {
  session: Session
  onExpired: () => void
  onSignOut: () => void
  children: ReactNode
}) {
  // Rebuilt only when a different operator signs in; renewed tokens are kept
  // inside the client and persisted, without re-rendering the whole app.
  const value = useMemo<Ctx>(() => {
    const client = createClient(session, { onRenewed: saveSession, onExpired })
    return {
      client,
      session,
      canAct: session.operator.role !== 'viewer',
      signOut: onSignOut,
    }
  }, [session.operator.id, session.apiBase])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
