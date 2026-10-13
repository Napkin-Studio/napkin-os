// Who may use the tool behind Napkin OS (features/os-sign-in.clan; UI spec 3.15): napkin-web's
// signed-out 401 offers Sign in and comes back; the relay's 401 never sends anyone away (no loop).
import { describe, expect, it, vi } from 'vitest'
import { ProjectServer } from '../projects/server'
import { AccessStore, NO_ACCESS, accessOf, behindNapkinOs, signInHref, signOut } from './access'
import { MOCK_TENANT, MockRelay } from './mock'

describe('what a refusal means', () => {
  it("is signed out only for napkin-web's 401 with signin:true", () => {
    expect(accessOf(401, { ok: false, signin: true, password: false })).toBe('signed_out')
    expect(accessOf(401, { error: { code: 'unauthorised', message: 'Sign in to use the Production Tool.', retryable: false } })).toBe('unconfirmed')
    expect(accessOf(401, null)).toBe('unconfirmed')
    expect(accessOf(401, { signin: 'yes' })).toBe('unconfirmed')
  })

  it('is the agency not on only for 403 flag_off on GET /me', () => {
    const off = { error: { code: 'flag_off', message: 'The Production Tool is not on for your agency yet.', retryable: false } }
    expect(accessOf(403, off, true)).toBe('not_enabled')
    expect(accessOf(403, off, false)).toBeNull()
    expect(accessOf(403, { error: { code: 'blocked' } }, true)).toBeNull()
    expect(accessOf(500, {}, true)).toBeNull()
  })

  it('says what the UI spec says', () => {
    expect(NO_ACCESS.signed_out.title).toBe('Sign in to Napkin Studio to use Production')
    expect(NO_ACCESS.unconfirmed.title).toBe('We could not confirm who you are')
    expect(NO_ACCESS.not_enabled.title).toBe('The Production Tool is not on for your agency yet.')
  })
})

describe('Sign in and Sign out', () => {
  it('signs in through Napkin OS and comes back to the same page', () => {
    expect(signInHref({ pathname: '/production/', search: '' })).toBe('/?next=%2Fproduction%2F')
    expect(signInHref({ pathname: '/production/p/prj_1', search: '?shot=s1&t=3' }))
      .toBe('/?next=' + encodeURIComponent('/production/p/prj_1?shot=s1&t=3'))
  })

  it('offers Sign out only behind napkin-web', () => {
    expect(behindNapkinOs('/production/api')).toBe(true)
    expect(behindNapkinOs('http://localhost:8787')).toBe(false)
    expect(behindNapkinOs(undefined)).toBe(false)
  })

  it("posts to Napkin OS's sign-out, then goes to the OS home", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }))
    const go = vi.fn()
    await signOut(fetchFn as unknown as typeof fetch, go)
    expect(fetchFn).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST' })
    expect(go).toHaveBeenCalledWith('/')
  })

  it('still goes home when the sign-out call fails', async () => {
    const go = vi.fn()
    await signOut((async () => { throw new Error('offline') }) as unknown as typeof fetch, go)
    expect(go).toHaveBeenCalledWith('/')
  })
})

describe('the access store', () => {
  it('tells subscribers when access changes, once', () => {
    const a = new AccessStore()
    const fn = vi.fn()
    a.subscribe(fn)
    expect(a.get()).toBe('ok')
    a.set('signed_out')
    a.set('signed_out')
    expect(a.get()).toBe('signed_out')
    expect(fn).toHaveBeenCalledOnce()
  })
})

describe('saved projects behind Napkin OS', () => {
  it("reports napkin-web's signed-out 401 on a later call, with a readable error", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: false, signin: true }), { status: 401 }))
    const onUnauthorised = vi.fn()
    const server = new ProjectServer({ base: '/production/api', signedIn: () => true, fetchFn: fetchFn as unknown as typeof fetch, onUnauthorised })
    await expect(server.list()).rejects.toMatchObject({ status: 401, error: { code: 'unauthorised' } })
    expect(onUnauthorised).toHaveBeenCalledWith('signed_out')
  })
})

describe('the mock relay', () => {
  it("names its person in Napkin's own agency", async () => {
    const me = await new MockRelay({ renderer: { render: async () => new Blob() } as never }).me()
    expect(me.tenant).toEqual({ id: 'f283da90-07cd-59ec-b370-b23704a2bc91', agency: 'napkin' })
    expect(me.workspace).toBe(MOCK_TENANT.id)
    expect(me.team).toBe('napkin')
  })
})
