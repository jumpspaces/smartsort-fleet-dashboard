import type { Session } from './types.ts'

/**
 * Transport for the fleet control plane.
 *
 * Sign-in trades an operator's credentials for a short access token and a
 * longer refresh token. A 401 triggers exactly one refresh, shared by every
 * request that hit it at the same moment — the console polls several endpoints
 * at once, and parallel refreshes would invalidate each other.
 */

export class Unauthorized extends Error {}
export class Forbidden extends Error {
  constructor(
    message: string,
    /** The server's error code, e.g. "two_factor_setup_required". */
    readonly code?: string,
  ) {
    super(message)
  }
}
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}
/** The password was right; now the code from the operator's authenticator app. */
export class TwoFactorRequired extends Error {}

export const trimBase = (base: string) => base.trim().replace(/\/+$/, '')

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
  const message = body?.message ?? `Request failed (HTTP ${res.status})`
  if (res.status === 403) return new Forbidden(message, body?.error)
  if (res.status === 401 && body?.error === 'two_factor_required') return new TwoFactorRequired(message)
  return new HttpError(message, res.status, body?.error)
}

export async function signIn(apiBase: string, email: string, password: string, code?: string): Promise<Session> {
  const base = trimBase(apiBase)
  let res: Response
  try {
    res = await fetch(`${base}/fleet/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
    })
  } catch {
    throw new Error(`Couldn't reach ${base}. Check the server address and your connection.`)
  }
  if (res.status === 503) throw new Error('The fleet console is not switched on for this server.')
  if (!res.ok) throw await failure(res)
  return { apiBase: base, ...((await res.json()) as Omit<Session, 'apiBase'>) }
}

export interface Client {
  readonly session: Session
  get<T>(path: string, signal?: AbortSignal): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  del<T>(path: string): Promise<T>
  /** POST a raw text body (the CSV importers take the file itself). */
  postText<T>(path: string, body: string, contentType: string): Promise<T>
  /** A file download, riding the same session handling as everything else. A body makes it a POST. */
  download(path: string, fallbackName: string, body?: unknown): Promise<{ filename: string; blob: Blob }>
  /** Carry on with a session the server just issued (turning on sign-in codes ends the old one). */
  adopt(next: Omit<Session, 'apiBase'>): void
}

export interface ClientHooks {
  onRenewed(session: Session): void
  onExpired(): void
}

export function createClient(initial: Session, hooks: ClientHooks): Client {
  let session = initial
  let refreshing: Promise<boolean> | null = null

  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const res = await fetch(`${session.apiBase}/fleet/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        })
        if (!res.ok) return false
        session = { apiBase: session.apiBase, ...((await res.json()) as Omit<Session, 'apiBase'>) }
        hooks.onRenewed(session)
        return true
      } catch {
        return false
      } finally {
        // Cleared a tick later so every waiter settles on this same result.
        setTimeout(() => (refreshing = null), 0)
      }
    })()
    return refreshing
  }

  async function raw(path: string, init: RequestInit = {}, contentType?: string, retried = false): Promise<Response> {
    const res = await fetch(`${session.apiBase}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': contentType ?? 'application/json' } : {}),
        Authorization: `Bearer ${session.accessToken}`,
      },
    })
    if (res.status === 401) {
      if (!retried && (await refresh())) return raw(path, init, contentType, true)
      hooks.onExpired()
      throw new Unauthorized('Your session has ended. Sign in again.')
    }
    if (!res.ok) throw await failure(res)
    return res
  }

  async function request<T>(path: string, init: RequestInit = {}, contentType?: string): Promise<T> {
    const res = await raw(path, init, contentType)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  const json = (body: unknown) => (body === undefined ? undefined : JSON.stringify(body))

  return {
    get session() {
      return session
    },
    get: (path, signal) => request(path, { signal }),
    post: (path, body) => request(path, { method: 'POST', body: json(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: json(body) }),
    del: (path) => request(path, { method: 'DELETE' }),
    postText: (path, body, contentType) => request(path, { method: 'POST', body }, contentType),
    adopt: (next) => {
      session = { apiBase: session.apiBase, ...next }
      hooks.onRenewed(session)
    },
    download: async (path, fallbackName, body) => {
      const res = await raw(path, body === undefined ? {} : { method: 'POST', body: json(body) })
      // Readable cross-origin only because the API exposes the header; an
      // older server still saves the file, under the fallback name.
      const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')
      return { filename: match?.[1] ?? fallbackName, blob: await res.blob() }
    },
  }
}
