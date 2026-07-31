/**
 * Client tests. The interesting behaviour here is the session handling, because
 * it is the part that fails invisibly: a refresh race signs the operator out
 * mid-shift and looks like "the dashboard logged me off again" rather than a
 * bug with a cause.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi, Forbidden, Unauthorized, type Session } from './api.ts'

const session: Session = {
  apiBase: 'https://fleet.test',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  operator: { id: 'op-1', email: 'ops@jumpspaces.test', name: 'Ops', role: 'admin' },
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** URL of the nth fetch call. */
const urlOf = (i: number) => String(fetchMock.mock.calls[i]![0])
const initOf = (i: number) => fetchMock.mock.calls[i]![1] as RequestInit | undefined

describe('request building', () => {
  it('sends the access token and drops empty query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ devices: [], total: 0, limit: 50, offset: 0 }))
    const api = createApi(session, { onRenewed: () => {}, onExpired: () => {} })

    await api.devices({ q: '', state: 'all', limit: 50, offset: 0 })

    const url = new URL(urlOf(0))
    expect(url.pathname).toBe('/fleet/devices')
    // `all` is the absence of a filter, and an empty search is not a search —
    // sending either would make the server narrow on nothing.
    expect(url.searchParams.get('state')).toBeNull()
    expect(url.searchParams.get('q')).toBeNull()
    expect(url.searchParams.get('limit')).toBe('50')

    const headers = initOf(0)!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer access-1')
  })

  it('surfaces a 403 as its own error type', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'forbidden', message: 'This action needs the operator role.' }, 403),
    )
    const api = createApi(session, { onRenewed: () => {}, onExpired: () => {} })

    await expect(api.setGroupStatus('fp', 'resolved')).rejects.toBeInstanceOf(Forbidden)
  })
})

describe('session refresh', () => {
  it('refreshes once on a 401 and retries the original call', async () => {
    const onRenewed = vi.fn()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_token' }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresIn: 1800,
          operator: session.operator,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ counts: { all: 1 } }))

    const api = createApi(session, { onRenewed, onExpired: () => {} })
    await api.overview()

    expect(urlOf(1)).toContain('/fleet/refresh')
    // The retry must carry the NEW token, or it 401s again and signs the
    // operator out for no reason.
    expect((initOf(2)!.headers as Record<string, string>).Authorization).toBe('Bearer access-2')
    expect(onRenewed).toHaveBeenCalledOnce()
  })

  it('refreshes only once for many concurrent 401s', async () => {
    // The dashboard fires several requests per poll. Without single-flight,
    // each one refreshes, and all but the winner end up holding a token the
    // server has already rotated past.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/fleet/refresh')) {
        return Promise.resolve(
          jsonResponse({
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresIn: 1800,
            operator: session.operator,
          }),
        )
      }
      const auth = 'access-2'
      const called = fetchMock.mock.calls.at(-1)![1] as RequestInit
      const sent = (called.headers as Record<string, string>).Authorization
      return Promise.resolve(
        sent === `Bearer ${auth}` ? jsonResponse({ ok: true }) : jsonResponse({}, 401),
      )
    })

    const api = createApi(session, { onRenewed: () => {}, onExpired: () => {} })
    await Promise.all([api.overview(), api.alerts(), api.shops()])

    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/fleet/refresh'),
    )
    expect(refreshCalls).toHaveLength(1)
  })

  it('signs out when the refresh itself is rejected', async () => {
    const onExpired = vi.fn()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_token' }, 401))

    const api = createApi(session, { onRenewed: () => {}, onExpired })

    await expect(api.overview()).rejects.toBeInstanceOf(Unauthorized)
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('does not loop when the retry also 401s', async () => {
    const onExpired = vi.fn()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresIn: 1800,
          operator: session.operator,
        }),
      )
      .mockResolvedValue(jsonResponse({}, 401))

    const api = createApi(session, { onRenewed: () => {}, onExpired })
    await expect(api.overview()).rejects.toBeInstanceOf(Unauthorized)

    // original + refresh + one retry, and then it stops.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onExpired).toHaveBeenCalledOnce()
  })
})
