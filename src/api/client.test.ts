import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, Forbidden, HttpError, signIn, Unauthorized } from './client.ts'
import type { Session } from './types.ts'

const session: Session = {
  apiBase: 'https://cloud.test',
  accessToken: 'old',
  refreshToken: 'r1',
  operator: { id: 'op', email: 'a@b.c', name: 'A', role: 'operator' },
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

afterEach(() => vi.unstubAllGlobals())

describe('createClient', () => {
  it('refreshes once for many parallel 401s, then retries each with the new token', async () => {
    let refreshes = 0
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/fleet/refresh')) {
        refreshes++
        await new Promise((r) => setTimeout(r, 5))
        return json(200, { ...session, accessToken: 'new', refreshToken: 'r2' })
      }
      const auth = (init?.headers as Record<string, string>).Authorization
      return auth === 'Bearer new' ? json(200, { ok: url }) : json(401, {})
    })
    vi.stubGlobal('fetch', fetch)
    const onRenewed = vi.fn()
    const c = createClient(session, { onRenewed, onExpired: vi.fn() })

    const results = await Promise.all([c.get('/a'), c.get('/b'), c.get('/c'), c.get('/d')])
    expect(results).toHaveLength(4)
    expect(refreshes).toBe(1)
    expect(onRenewed).toHaveBeenCalledTimes(1)
    expect(c.session.accessToken).toBe('new')
  })

  it('signs out when the refresh is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, {})))
    const onExpired = vi.fn()
    const c = createClient(session, { onRenewed: vi.fn(), onExpired })
    await expect(c.get('/fleet/overview')).rejects.toBeInstanceOf(Unauthorized)
    expect(onExpired).toHaveBeenCalled()
  })

  it('turns 403 into Forbidden and other failures into HttpError with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.endsWith('/x') ? json(403, { message: 'Admins only' }) : json(404, { message: 'No such till' }))),
    )
    const c = createClient(session, { onRenewed: vi.fn(), onExpired: vi.fn() })
    await expect(c.get('/x')).rejects.toBeInstanceOf(Forbidden)
    const err = await c.get('/y').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(404)
    expect((err as HttpError).message).toBe('No such till')
  })

  it('sends CSV bodies as text/csv, not JSON', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { imported: 1 }))
    vi.stubGlobal('fetch', fetch)
    const c = createClient(session, { onRenewed: vi.fn(), onExpired: vi.fn() })
    await c.postText('/import', 'Product Name\nRice', 'text/csv')
    const init = fetch.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/csv')
    expect(init.body).toBe('Product Name\nRice')
  })

  it("takes a download's name from Content-Disposition, with a fallback", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new Response('a,b', {
          status: 200,
          headers: url.endsWith('named') ? { 'Content-Disposition': 'attachment; filename="sales-nov.csv"' } : {},
        }),
      ),
    )
    const c = createClient(session, { onRenewed: vi.fn(), onExpired: vi.fn() })
    expect((await c.download('/named', 'x.csv')).filename).toBe('sales-nov.csv')
    expect((await c.download('/plain', 'x.csv')).filename).toBe('x.csv')
  })

  it('accepts an empty success body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    const c = createClient(session, { onRenewed: vi.fn(), onExpired: vi.fn() })
    await expect(c.post('/fleet/alerts/1/ack')).resolves.toBeUndefined()
  })
})

describe('signIn', () => {
  it('trims the base and explains a switched-off control plane', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, {})))
    await expect(signIn('https://cloud.test///', 'a', 'b')).rejects.toThrow(/not switched on/)
  })

  it('explains an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(signIn('https://nowhere.test', 'a', 'b')).rejects.toThrow(/Couldn't reach https:\/\/nowhere.test/)
  })
})
