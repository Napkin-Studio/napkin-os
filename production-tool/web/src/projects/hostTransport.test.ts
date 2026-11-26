// Production saves through Napkin OS's library (features/production-in-library.clan, S1-8..S1-12, S1-16, S1-17):
// ServerCopy over the real ProjectServer, against a host that keeps the host's rules (test/hostFake.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { hexOf, sha256Hex } from '../lib/hash'
import { forgetMedia } from '../lib/media'
import { HostFake } from '../test/hostFake'
import { deleteWords } from './deleteWords'
import { CREATED_SAVE_MS, LANDING_SAVE_MS, MIRROR_EVERY_MS } from './session'
import { ProjectServer, SaveConflict } from './server'
import { ServerCopy } from './serverCopy'
import { memoryStorage } from './storage'

const enc = (s: string) => new TextEncoder().encode(s)
const hex = (v: string) => v.replace(/^sha256:/, '')

async function setup() {
  const host = new HostFake()
  const v0 = await host.put('doc-1', enc('v0'), 'Hollow Oak')
  const server = new ProjectServer({ host: '/api', signedIn: () => true, fetchFn: host.fetch })
  const marks: { etag: string; savedAt: string }[] = []
  const index = { get: () => ({ id: 'doc-1', name: 'Hollow Oak' }), setServer: vi.fn(async (_id: string, m: { etag: string; savedAt: string }) => { marks.push(m) }) }
  const tab = (base = hex(v0)) => new ServerCopy({
    id: 'doc-1', server, index: index as never, storage: memoryStorage(),
    doc: () => ({ assets: {} }) as unknown as ProductionDocument, upload: async () => undefined,
    base: { mark: { etag: base, savedAt: '2026-11-23T11:00:00.000Z' }, unsaved: false },
  })
  return { host, server, tab, v0: hex(v0) }
}

describe('S1-9 the tool saves with the version it started from, and keeps the old timing', () => {
  it('each save sends If-Match of the last version, and the answer becomes the next one', async () => {
    const { host, tab, v0 } = await setup()
    const copy = tab()
    await copy.post(enc('v1'), { reason: 'interval' })
    await copy.post(enc('v2'), { reason: 'accept' })
    await copy.post(enc('v3'), { reason: 'manual' })
    const sent = host.saves('doc-1').map((c) => [c.headers['if-match'], c.headers['x-clan-reason']])
    const v1 = await sha256Hex(enc('v1'))
    const v2 = await sha256Hex(enc('v2'))
    expect(sent).toEqual([[`"sha256:${v0}"`, 'interval'], [`"sha256:${v1}"`, 'accept'], [`"sha256:${v2}"`, 'manual']])
    expect(hex(host.docs.get('doc-1')!.version)).toBe(await sha256Hex(enc('v3')))
    expect(copy.basedOn()?.etag).toBe(await sha256Hex(enc('v3')))
  })

  it('every reason the host knows goes as it is (handoff, export and landing take a snapshot there)', async () => {
    const { host, tab } = await setup()
    const copy = tab()
    for (const [i, reason] of (['handoff', 'export', 'landing'] as const).entries()) await copy.post(enc(`r${i}`), { reason })
    expect(host.saves().map((c) => c.headers['x-clan-reason'])).toEqual(['handoff', 'export', 'landing'])
  })

  it('the save moments are the ones the tool always had', () => {
    expect([CREATED_SAVE_MS, LANDING_SAVE_MS, MIRROR_EVERY_MS]).toEqual([1_500, 10_000, 60_000])
  })
})

describe('S1-10 two tabs never overwrite each other', () => {
  it('the loser is refused, told, and nothing of the winner is touched', async () => {
    const { host, tab } = await setup()
    const a = tab()
    const b = tab()
    await a.post(enc('A edits'), { reason: 'interval' })
    const winner = host.docs.get('doc-1')!
    await expect(b.post(enc('B edits'), { reason: 'interval' })).rejects.toBeInstanceOf(SaveConflict)
    expect(new TextDecoder().decode(host.docs.get('doc-1')!.bytes)).toBe('A edits')
    expect(host.docs.get('doc-1')!.version).toBe(winner.version)
    expect(b.get()?.message).toContain('saved from somewhere else')
    // Until the person chooses no save goes: B's edits stay with B.
    const before = host.saves().length
    await expect(b.post(enc('B edits more'), { reason: 'interval' })).rejects.toBeInstanceOf(SaveConflict)
    expect(host.saves().length).toBe(before)
  })

  it('after the person chooses, the next save goes on top of the winner\'s version', async () => {
    const { host, tab } = await setup()
    const a = tab()
    const b = tab()
    await a.post(enc('A'), { reason: 'interval' })
    await b.post(enc('B'), { reason: 'interval' }).catch(() => {})
    await b.settle({ etag: hex(host.docs.get('doc-1')!.version), savedAt: '2026-11-23T12:30:00.000Z' })
    await b.post(enc('B on top'), { reason: 'manual' })
    expect(new TextDecoder().decode(host.docs.get('doc-1')!.bytes)).toBe('B on top')
    expect(b.get()).toBeNull()
  })
})

describe('S1-11 saves are serialised', () => {
  it('ten edits, a manual save and a landing racing: one in flight, none refused', async () => {
    const { host, tab } = await setup()
    const copy = tab()
    host.latency = 4
    const posts = Array.from({ length: 10 }, (_, i) => copy.post(enc(`edit ${i}`), { reason: 'interval' }))
    posts.push(copy.post(enc('manual'), { reason: 'manual' }), copy.post(enc('landing'), { reason: 'landing' }))
    await Promise.all(posts)
    expect(host.mostInFlight).toBe(1)
    expect(host.calls.filter((c) => c.method === 'PUT')).toHaveLength(12)
    expect(copy.get()).toBeNull()
    expect(new TextDecoder().decode(host.docs.get('doc-1')!.bytes)).toBe('landing')
  })
})

describe('S1-8 deleting a project', () => {
  it('goes to the host\'s Trash, and says so plainly', async () => {
    const { host, server } = await setup()
    const out = await server.remove('doc-1')
    expect(host.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/t/t1/d/doc-1' })
    expect(Date.parse(out.restorableUntil) - Date.parse(host.docs.get('doc-1')!.trashed!)).toBe(30 * 864e5)
    expect((await server.list()).map((r) => r.id)).toEqual([])
    await expect(server.remove('doc-1')).rejects.toMatchObject({ status: 404 })
    const words = deleteWords('Hollow Oak')
    expect(words).toContain('Trash')
    expect(words).toContain('30 days')
    expect(words).toContain('restore')
  })
})

describe('S1-16 pictures are found by their hash, never by an address a document names', () => {
  afterEach(() => { vi.unstubAllGlobals(); forgetMedia() })

  it('a fetch spy sees only the media base and the relay\'s by-hash route', async () => {
    const { server } = await setup()
    await server.session() // the media base comes from GET /api/session
    const { fetchAssets } = await import('./serverAssets')
    const bytes = enc('a picture')
    const sha = `sha256:${await sha256Hex(bytes)}`
    const asked: string[] = []
    const dl = async (url: string) => { asked.push(url); return url.endsWith(`/in/${sha}`) ? bytes : null }
    const doc = { refs: {}, shots: {}, frames: {}, takes: {}, renders: {}, exports: {}, assets: {
      [sha]: { sha256: sha, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: ['https://old-cdn.test/in/x', 'idb://sha256/abc'] },
    } } as unknown as ProductionDocument
    await fetchAssets(doc, { where: async () => null, download: dl }, 'doc-1')
    expect(asked).toEqual([`https://media.test/in/${sha}`])
    expect(hexOf(sha)).toHaveLength(64)
  })
})
