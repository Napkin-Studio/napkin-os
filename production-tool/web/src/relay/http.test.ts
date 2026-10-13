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
    const me: Me = { participantId: 'p_1a2b3c4d5e', handle: 'maya', name: 'Maya', team: 'napkin', workspace: 'f283da90-07cd-59ec-b370-b23704a2bc91', tenant: { id: 'f283da90-07cd-59ec-b370-b23704a2bc91', agency: 'napkin' }, quotas: { image: 40, video: 6, render: 3 }, projects: 3 }
    const fetchFn = answer(200, me)
    vi.stubGlobal('fetch', fetchFn)
    expect(await new HttpRelay('http://relay.test/').me()).toEqual(me)
    expect(fetchFn.mock.calls[0][0]).toBe('http://relay.test/me')
    expect(fetchFn.mock.calls[0][1]?.method).toBe('GET')
  })

  it('maps a relay 401 on GET /me to null, and tells the app it could not confirm who (no sign-in loop)', async () => {
    vi.stubGlobal('fetch', answer(401, REFUSED))
    const relay = new HttpRelay('http://relay.test')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    expect(await relay.me()).toBeNull()
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('unconfirmed')
  })

  it("maps napkin-web's signed-out 401 ({signin:true}) on GET /me to null and signed out", async () => {
    vi.stubGlobal('fetch', answer(401, { ok: false, signin: true, password: false }))
    const relay = new HttpRelay('/production/api')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    expect(await relay.me()).toBeNull()
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('signed_out')
  })

  it('says the agency is not on when GET /me answers 403 flag_off', async () => {
    vi.stubGlobal('fetch', answer(403, { error: { code: 'flag_off', message: 'The Production Tool is not on for your agency yet.', retryable: false } }))
    const relay = new HttpRelay('/production/api')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.me()).rejects.toMatchObject({ status: 403 })
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('not_enabled')
  })

  it("does not treat a step's flag_off (a switched-off step) as the agency's", async () => {
    vi.stubGlobal('fetch', answer(403, { error: { code: 'flag_off', message: 'Video is switched off for now.', retryable: false } }))
    const relay = new HttpRelay('/production/api')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.getJob('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')).rejects.toMatchObject({ status: 403 })
    expect(onUnauthorised).not.toHaveBeenCalled()
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
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('unconfirmed')
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
