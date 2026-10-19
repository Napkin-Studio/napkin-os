// No token and no own keys (features/drop-hackathon-extras.clan): who is asking comes from the
// relay's identity seam, and a 401 anywhere means signed out.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobRequest, Me } from '../contracts/types'
import { HttpRelay } from './http'

function answer(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const REFUSED = { error: { code: 'unauthorised', message: 'Sign in through Napkin Studio.', retryable: false } }

describe('HttpRelay and who is signed in', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads GET /me', async () => {
    const me: Me = { participantId: 'p_1a2b3c4d5e', handle: 'maya', team: 'napkin', workspace: 'p_1a2b3c4d5e', quotas: { image: 40, video: 6, render: 3 }, projects: 3 }
    const fetchFn = answer(200, me)
    vi.stubGlobal('fetch', fetchFn)
    expect(await new HttpRelay('http://relay.test/').me()).toEqual(me)
    expect(fetchFn.mock.calls[0][0]).toBe('http://relay.test/me')
    expect(fetchFn.mock.calls[0][1]?.method).toBe('GET')
  })

  it('maps a 401 on GET /me to signed out (null), and tells the app', async () => {
    vi.stubGlobal('fetch', answer(401, REFUSED))
    const relay = new HttpRelay('http://relay.test')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    expect(await relay.me()).toBeNull()
    expect(onUnauthorised).toHaveBeenCalledOnce()
  })

  it('still throws when GET /me fails some other way', async () => {
    vi.stubGlobal('fetch', answer(500, { error: { code: 'internal', message: 'Something broke.', retryable: true } }))
    await expect(new HttpRelay('http://relay.test').me()).rejects.toMatchObject({ status: 500 })
  })

  it('tells the app when any route answers 401', async () => {
    vi.stubGlobal('fetch', answer(401, REFUSED))
    const relay = new HttpRelay('http://relay.test')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.getJob('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')).rejects.toThrow()
    expect(onUnauthorised).toHaveBeenCalledOnce()
  })

  it('sends no Authorization and no X-Own-Keys header', async () => {
    const fetchFn = answer(200, {})
    vi.stubGlobal('fetch', fetchFn)
    const relay = new HttpRelay('http://relay.test')
    await relay.me()
    await relay.createJob({ contractVersion: '2', jobId: 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F', op: 'generate', parentIds: [], input: { text: 'a cat' } } as JobRequest)
    await relay.getJob('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')
    relay.dogfoodEvents([{ at: 1 } as never], false)
    expect(fetchFn).toHaveBeenCalledTimes(4)
    for (const [, init] of fetchFn.mock.calls) {
      const h = new Headers(init?.headers)
      expect(h.has('Authorization')).toBe(false)
      expect(h.has('X-Own-Keys')).toBe(false)
    }
  })
})
