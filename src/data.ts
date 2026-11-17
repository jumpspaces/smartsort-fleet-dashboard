import { useMemo } from 'react'
import * as api from './api/endpoints.ts'
import type { AlertState, DeviceQuery, Shop } from './api/types.ts'
import { useQuery } from './lib/query.ts'
import { useSession } from './lib/session.tsx'

/**
 * Every read the console makes, with its cache key and poll rate in one place.
 * Keys start with the resource name so a write can `invalidate('devices')`.
 */

const LIVE = 30_000 // tills report every ~3 minutes; 30s keeps alerts prompt
const SLOW = 120_000

export function useOverview() {
  const { client } = useSession()
  return useQuery('overview', (s) => api.overview(client, s), { every: LIVE })
}

export function useDevices(q: DeviceQuery) {
  const { client } = useSession()
  return useQuery(`devices:${JSON.stringify(q)}`, (s) => api.devices(client, q, s), { every: LIVE })
}

/** `every` shortens the poll while a till is in live mode and changing by the second. */
export function useDevice(id: string, every = LIVE) {
  const { client } = useSession()
  return useQuery(`device:${id}`, (s) => api.device(client, id, s), { every })
}

export function useHeartbeats(ids: string[]) {
  const { client } = useSession()
  const key = ids.join(',')
  return useQuery(`heartbeats:${key}`, () => api.heartbeats(client, ids), {
    every: SLOW,
    enabled: ids.length > 0,
  })
}

export function useDeviceErrors(id: string) {
  const { client } = useSession()
  return useQuery(`errors:${id}`, (s) => api.deviceErrors(client, id, s), { every: SLOW })
}

export function useDeviceCommands(id: string, every = 15_000) {
  const { client } = useSession()
  return useQuery(`commands:${id}`, (s) => api.deviceCommands(client, id, s), { every })
}

/** Fixes waiting for a second operator, fleet-wide. */
export function useAwaitingApproval() {
  const { client } = useSession()
  return useQuery('commands:awaiting', (s) => api.awaitingApproval(client, s), { every: LIVE })
}

export function useCommandCatalogue() {
  const { client } = useSession()
  return useQuery('catalogue', (s) => api.commandCatalogue(client, s))
}

export function useRecipes() {
  const { client } = useSession()
  return useQuery('recipes', (s) => api.recipes(client, s))
}

/** What the console keeps for a till, and whether the till has taken it up. */
export function useDeviceSettings(id: string, every = 15_000) {
  const { client } = useSession()
  return useQuery(`settings:${id}`, (s) => api.deviceSettings(client, id, s), { every })
}

export function useNotes(id: string) {
  const { client } = useSession()
  return useQuery(`notes:${id}`, (s) => api.notes(client, id, s))
}

export function useAlerts(state: AlertState | 'all') {
  const { client } = useSession()
  return useQuery(`alerts:${state}`, (s) => api.alerts(client, state, s), { every: LIVE })
}

export function useShops() {
  const { client } = useSession()
  return useQuery('shops', (s) => api.shops(client, s), { every: SLOW })
}

/** Shop by id, for currency and names. Empty until shops load. */
export function useShopIndex(): Map<string, Shop> {
  const { data } = useShops()
  return useMemo(() => new Map((data ?? []).map((s) => [s.id, s])), [data])
}

/**
 * Any other read: `useApi('rules', (c, s) => api.rules(c, s))`. The key's
 * first segment (before ":") is what `invalidate` matches on.
 */
export function useApi<T>(
  key: string,
  fetcher: (client: ReturnType<typeof useSession>['client'], signal: AbortSignal) => Promise<T>,
  opts?: { every?: number; enabled?: boolean },
) {
  const { client } = useSession()
  return useQuery(key, (s) => fetcher(client, s), opts)
}

/**
 * Whether the assistant is usable at all. AI is all-or-nothing per the
 * product: off (or no key) hides every AI surface rather than greying it.
 */
export function useAssistantOn(): boolean {
  const q = useApi('assistant', (c, s) => api.assistant(c, s), { every: SLOW })
  return !!q.data?.systemEnabled && !!q.data.apiKey.source && !q.data.apiKey.unreadable
}
