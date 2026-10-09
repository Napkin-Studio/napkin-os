import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpRelay } from './http'

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('HttpRelay and a refused session', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tells the app when the server refuses the token', async () => {
    vi.stubGlobal('fetch', answer(401, { error: { code: 'unauthorised', message: 'Your session has expired. Sign in again.', retryable: false } }))
    const relay = new HttpRelay('http://relay.test')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    relay.useToken('old')
    await expect(relay.getJob('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')).rejects.toThrow()
    expect(onUnauthorised).toHaveBeenCalledOnce()
  })

  it('does not sign out on a wrong event code', async () => {
    vi.stubGlobal('fetch', answer(401, { error: { code: 'unauthorised', message: 'That event code is not right.', retryable: false } }))
    const relay = new HttpRelay('http://relay.test')
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.session({ eventCode: 'NOPE', handle: 'maya' })).rejects.toThrow()
    expect(onUnauthorised).not.toHaveBeenCalled()
  })
})
