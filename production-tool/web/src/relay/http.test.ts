// No token and no own keys (features/drop-hackathon-extras.clan): who is asking comes from the
// relay's identity seam, and a 401 anywhere means signed out.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobRequest, Me } from '../contracts/types'
import { HttpRelay } from './http'

/** A relay for the open project `doc-1` of workspace `t1` (the host's own routes; the relay's address is never known here). */
const make = (doc: string | null = 'doc-1') => new HttpRelay({ host: '/api', tenant: async () => 't1', doc: () => doc })

function answer(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const REFUSED = { error: { code: 'unauthorised', message: 'Sign in through Napkin Studio.', retryable: false } }

describe('HttpRelay and who is signed in', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads GET /me', async () => {
    const me: Me = { participantId: 'p_1a2b3c4d5e', handle: 'maya', name: 'Maya', team: 'napkin', workspace: 'f283da90-07cd-59ec-b370-b23704a2bc91', tenant: { id: 'f283da90-07cd-59ec-b370-b23704a2bc91', agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google'] }, quotas: null, projects: 3 }
    const fetchFn = answer(200, me)
    vi.stubGlobal('fetch', fetchFn)
    expect(await make().me()).toEqual(me)
    expect(fetchFn.mock.calls[0][0]).toBe('/api/t/t1/production/me')
    expect(fetchFn.mock.calls[0][1]?.method).toBe('GET')
  })

  it('maps a relay 401 on GET /me to null, and tells the app it could not confirm who (no sign-in loop)', async () => {
    vi.stubGlobal('fetch', answer(401, REFUSED))
    const relay = make()
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    expect(await relay.me()).toBeNull()
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('unconfirmed')
  })

  it("maps napkin-web's signed-out 401 ({signin:true}) on GET /me to null and signed out", async () => {
    vi.stubGlobal('fetch', answer(401, { ok: false, signin: true, password: false }))
    const relay = make()
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    expect(await relay.me()).toBeNull()
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('signed_out')
  })

  it('takes a 401 from GET /me and GET /config quietly: signed out, not an error, nothing logged', async () => {
    vi.stubGlobal('fetch', answer(401, { ok: false, signin: true, password: false }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const relay = make()
      const onUnauthorised = vi.fn()
      relay.onUnauthorised = onUnauthorised
      expect(await relay.me()).toBeNull()
      expect(await relay.config()).toBeNull()
      expect(onUnauthorised).toHaveBeenCalledWith('signed_out')
      expect(error).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
      warn.mockRestore()
    }
  })

  it('says the agency is not on when GET /me answers 403 flag_off', async () => {
    vi.stubGlobal('fetch', answer(403, { error: { code: 'flag_off', message: 'The Production Tool is not on for your agency yet.', retryable: false } }))
    const relay = make()
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.me()).rejects.toMatchObject({ status: 403 })
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('not_enabled')
  })

  it("does not treat a step's flag_off (a switched-off step) as the agency's", async () => {
    vi.stubGlobal('fetch', answer(403, { error: { code: 'flag_off', message: 'Video is switched off for now.', retryable: false } }))
    const relay = make()
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.getJob('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')).rejects.toMatchObject({ status: 403 })
    expect(onUnauthorised).not.toHaveBeenCalled()
  })

  it('still throws when GET /me fails some other way', async () => {
    vi.stubGlobal('fetch', answer(500, { error: { code: 'internal', message: 'Something broke.', retryable: true } }))
    await expect(make().me()).rejects.toMatchObject({ status: 500 })
  })

  it('tells the app when any route answers 401', async () => {
    vi.stubGlobal('fetch', answer(401, REFUSED))
    const relay = make()
    const onUnauthorised = vi.fn()
    relay.onUnauthorised = onUnauthorised
    await expect(relay.getJob('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')).rejects.toThrow()
    expect(onUnauthorised).toHaveBeenCalledExactlyOnceWith('unconfirmed')
  })

  it('sends no Authorization and no X-Own-Keys header', async () => {
    const fetchFn = answer(200, {})
    vi.stubGlobal('fetch', fetchFn)
    const relay = make()
    await relay.me()
    await relay.createJob({ contractVersion: '3', jobId: 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F', op: 'generate', projectId: 'proj_01K6XA7Q3M9V2D4R8T0B5C1E6F', nonce: 'nonce_0001', node: { kind: 'group', id: 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F' }, parentIds: [], input: { text: 'a cat' } } satisfies JobRequest)
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

describe('HttpRelay and a job that asks', () => {
  afterEach(() => vi.unstubAllGlobals())
  const JOB = 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F'
  const reply = { contractVersion: '3' as const, questionId: 'q_01K6XA7Q3M9V2D4R8T0B5C1E6F', optionId: 'wide' }

  it('posts the answer to /jobs/{jobId}/answer and gives back the resumed job', async () => {
    const fetchFn = answer200({ jobId: JOB, state: 'submitted' })
    vi.stubGlobal('fetch', fetchFn)
    const r = await make().answerJob(JOB, reply)
    expect(r).toEqual({ job: { jobId: JOB, state: 'submitted' } })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`/api/t/t1/d/doc-1/production/jobs/${JOB}/answer`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(reply)
  })

  it('a 409 is the answer that won, not an error', async () => {
    const conflict = { error: { code: 'conflict', message: 'Someone answered first.', retryable: false }, answeredBy: 'human:p_sai0001', answer: { option_id: 'close' } }
    vi.stubGlobal('fetch', answer(409, conflict))
    expect(await make().answerJob(JOB, reply)).toEqual({ conflict })
  })

  it('reads a shelf of the library', async () => {
    const fetchFn = answer200({ workspace: 'w', shelf: 'agency', keys: [] })
    vi.stubGlobal('fetch', fetchFn)
    await make().library()
    expect(fetchFn.mock.calls[0][0]).toBe('/api/t/t1/production/library/agency')
  })

  function answer200(body: unknown) {
    return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }))
  }
})

describe('HttpRelay talks to napkin-web only (S3-1)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const JOB = 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F'

  /** Every URL a walk over the relay's calls fetches. */
  async function walk(relay: HttpRelay) {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ exists: true, url: 'https://cdn.test/in/x', entries: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchFn)
    await relay.me()
    await relay.config()
    await relay.library()
    await relay.log({ level: 'info', message: 'x' } as never)
    await relay.upload(new Blob(['x'], { type: 'image/png' }), 'image/png')
    await relay.createJob({ contractVersion: '3', jobId: JOB, op: 'generate', projectId: 'proj_01K6XA7Q3M9V2D4R8T0B5C1E6F', nonce: 'nonce_0001', node: { kind: 'group', id: JOB }, parentIds: [], input: { text: 'a cat' } } satisfies JobRequest)
    await relay.getJob(JOB)
    await relay.cancelJob(JOB)
    await relay.answerJob(JOB, { contractVersion: '3', questionId: 'q_01K6XA7Q3M9V2D4R8T0B5C1E6F', optionId: 'wide' })
    await relay.inbox()
    await relay.ackJob(JOB)
    await relay.dogfoodConsent()
    relay.dogfoodEvents([{ kind: 'click', name: 'x' }], false)
    return fetchFn.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
  }

  it('every call is a path of this origin: the shell API, never an address of the relay', async () => {
    const calls = await walk(make())
    expect(calls.length).toBeGreaterThan(12)
    for (const c of calls) expect(c.split(' ')[1]).toMatch(/^\/api\//)
    expect(calls).toEqual(expect.arrayContaining([
      'GET /api/t/t1/production/me',
      'GET /api/t/t1/production/config',
      'POST /api/t/t1/production/log',
      `POST /api/t/t1/d/doc-1/production/jobs`,
      `GET /api/t/t1/d/doc-1/production/jobs/${JOB}`,
      `DELETE /api/t/t1/d/doc-1/production/jobs/${JOB}`,
      'POST /api/t/t1/d/doc-1/production/uploads',
      'GET /api/t/t1/d/doc-1/production/inbox',
      `POST /api/t/t1/d/doc-1/production/inbox/${JOB}/ack`,
      'POST /api/dogfood/consent',
      'POST /api/dogfood/events',
    ]))
  })

  it('new bytes go straight to S3 on the presigned link: the one call that leaves this origin (owner, 2026-11-23)', async () => {
    const put = 'https://bucket.s3.eu-west-1.amazonaws.com/in/sha256:abc?X-Amz-Expires=900&X-Amz-Signature=s'
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => url.startsWith('/api/')
      ? new Response(JSON.stringify({ exists: false, putUrl: put, putHeaders: { 'x-amz-checksum-sha256': 'q83vEj==' }, url: 'https://cdn.test/in/sha256:abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchFn)
    await make().upload(new Blob(['x'], { type: 'image/png' }), 'image/png')
    const calls = fetchFn.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
    expect(calls).toEqual(['POST /api/t/t1/d/doc-1/production/uploads', `PUT ${put}`])
    // the PUT carries the bytes and the hash binding the relay named, and no credential of napkin-web's
    const h = new Headers(fetchFn.mock.calls[1][1]?.headers)
    expect(h.get('x-amz-checksum-sha256')).toBe('q83vEj==')
    expect(h.get('content-type')).toBe('image/png')
    for (const name of ['authorization', 'x-napkin-user', 'x-napkin-identity']) expect(h.has(name)).toBe(false)
  })

  it('sends no credential and no identity of its own', async () => {
    const fetchFn = answer(200, { entries: [] })
    vi.stubGlobal('fetch', fetchFn)
    await make().inbox()
    for (const [, init] of fetchFn.mock.calls) {
      const h = new Headers(init?.headers)
      for (const name of ['authorization', 'x-napkin-user', 'x-napkin-identity']) expect(h.has(name)).toBe(false)
    }
  })

  it("a call that belongs to a project says so when none is open, and sends nothing", async () => {
    const fetchFn = answer(200, {})
    vi.stubGlobal('fetch', fetchFn)
    const home = make(null)
    await expect(home.getJob(JOB)).rejects.toMatchObject({ error: { code: 'invalid_input' } })
    await expect(home.inbox()).rejects.toMatchObject({ error: { code: 'invalid_input' } })
    expect(fetchFn).not.toHaveBeenCalled()
    await home.me() // who is signed in needs no project
    expect(fetchFn.mock.calls[0][0]).toBe('/api/t/t1/production/me')
  })

  it('follows the project that is open now, and asks for the workspace once', async () => {
    let doc: string | null = 'doc-1'
    const tenant = vi.fn(async () => 't1')
    const relay = new HttpRelay({ host: '/api', tenant, doc: () => doc })
    const fetchFn = answer(200, { entries: [] })
    vi.stubGlobal('fetch', fetchFn)
    await relay.inbox()
    doc = 'doc 2/x'
    await relay.inbox()
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual(['/api/t/t1/d/doc-1/production/inbox', '/api/t/t1/d/doc%202%2Fx/production/inbox'])
    expect(tenant).toHaveBeenCalledTimes(1)
  })

  it('asks /api/session for the workspace by default, and says sign in when it is not there', async () => {
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => url === '/api/session'
      ? new Response(JSON.stringify({ tenant: 'abc' }), { status: 200 })
      : new Response(JSON.stringify({ entries: [{ job: 'j' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchFn)
    const relay = new HttpRelay({ doc: () => 'd1' })
    expect(await relay.inbox()).toEqual([{ job: 'j' }])
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual(['/api/session', '/api/t/abc/d/d1/production/inbox'])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(new HttpRelay({ doc: () => 'd1' }).inbox()).rejects.toMatchObject({ status: 401, error: { code: 'unauthorised' } })
  })

  it("the dogfood batch is napkin-web's shape: the project is the document, the tool is the app", async () => {
    const fetchFn = answer(200, { ok: true })
    vi.stubGlobal('fetch', fetchFn)
    make().dogfoodEvents([{ kind: 'click', name: 'generate', project: 'doc-1', stage: 'video', at: '2026-11-23T10:00:00Z', tab: 'tab1', seq: 4, data: { n: 1 } }], false)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/dogfood/events')
    expect(JSON.parse(String(init?.body))).toEqual({ events: [{ kind: 'click', name: 'generate', doc: 'doc-1', app: 'production', at: '2026-11-23T10:00:00Z', data: { stage: 'video', tab: 'tab1', seq: 4, n: 1 } }] })
  })

  it('hears the host say a job of this project is waiting, and only this project', async () => {
    const sources: { url: string; listeners: Record<string, (e: { data: string }) => void>; closed: boolean }[] = []
    vi.stubGlobal('EventSource', class {
      url: string
      listeners: Record<string, (e: { data: string }) => void> = {}
      closed = false
      constructor(url: string) { this.url = url; sources.push(this as never) }
      addEventListener(name: string, f: (e: { data: string }) => void) { this.listeners[name] = f }
      close() { this.closed = true }
    })
    const heard = vi.fn()
    const stop = make().onSettled('doc-1', heard)
    await vi.waitFor(() => expect(sources).toHaveLength(1))
    expect(sources[0].url).toBe('/api/t/t1/events')
    sources[0].listeners['napkin-job-settled']({ data: JSON.stringify({ doc: 'doc-2', job: 'j' }) })
    expect(heard).not.toHaveBeenCalled()
    sources[0].listeners['napkin-job-settled']({ data: JSON.stringify({ doc: 'doc-1', job: 'j' }) })
    sources[0].listeners['napkin-job-settled']({ data: 'not json' })
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
    expect(sources[0].closed).toBe(true)
  })
})
