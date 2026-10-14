import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import {
  ClanDocumentStore, InvalidDocument, LocalPatchBus, UnsupportedContract, buildExportZip, indexedDbPersistence, memoryPersistence,
  postClanMirror, problems, sha256Hex, integrity, ranksBetween, type Doc, type DocAsset,
} from '../src/index'
import { appTemplate } from '../src/host'

import { bundle } from '../scripts/bundle-schema.mjs'
import { AT, MAYA, asset, defaults, example, id, jobValue, sha, shotValue, store, wasmBytes } from './fixtures'

const wasm = wasmBytes()
const tmp = mkdtempSync(join(tmpdir(), 'clan-store-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function clanCli(args: string[]): string {
  return execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', ...args], { encoding: 'utf8' })
}

async function filled(s: ClanDocumentStore): Promise<Doc> {
  await s.create({ person: MAYA, title: 'Rain' })
  const { storyboard } = defaults(s)
  const bus = new LocalPatchBus(s)
  const r = await bus.apply({
    patches: [
      { op: 'create', entity: 'assets', id: sha(1), value: asset(1), base_version: 0 },
      { op: 'create', entity: 'assets', id: sha(2), value: asset(2), base_version: 0 },
      { op: 'create', entity: 'keys', id: id('key', 0), value: { key: 'hero', role: 'character' }, base_version: 0 },
      { op: 'create', entity: 'refs', id: id('ref', 0), value: { key: 'hero', variant: 'front', role: 'character', asset: sha(1), named_at: AT }, base_version: 0 },
      { op: 'create', entity: 'shots', id: id('shot', 0), value: shotValue(storyboard, 'a0'), base_version: 0 },
      { op: 'create', entity: 'shots', id: id('shot', 1), value: shotValue(storyboard, 'a1'), base_version: 0 },
      { op: 'create', entity: 'jobs', id: id('job', 0), value: jobValue(0), base_version: 0 },
    ],
    why: { action: 'name @hero_front and plan two shots', rationale: 'its front' },
  })
  expect(r.refused).toEqual([])
  return s.get()
}

describe('ClanDocumentStore (contract 3) against the real napkin-wasm', () => {
  it('create makes a valid project with one script, storyboard and video, linked', async () => {
    const s = store()
    const d = await s.create({ person: MAYA, title: 'Rain' })
    expect(d.contract_version).toBe('3')
    expect(d.project.created_by).toBe('human:p_maya001')
    expect(Object.keys(d.scripts)).toHaveLength(1)
    expect(Object.keys(d.storyboards)).toHaveLength(1)
    expect(Object.keys(d.videos)).toHaveLength(1)
    const roles = Object.values(d.links).map((l) => l.role).sort()
    expect(roles).toEqual(['drives', 'renders'])
    expect(problems(d)).toEqual([])
    expect(integrity(d)).toEqual([])
    const chain = await s.chain()
    expect(chain[0].action).toBe('start the project')
    expect(chain[0].agent).toBe('human:p_maya001')
    expect(s.documentId()).toMatch(/[0-9a-f-]{8,}/)
    s.dispose()
  })

  it('create → patch → export → reopen from bytes: same data, valid', async () => {
    const s = store()
    const before = await filled(s)
    expect(problems(before)).toEqual([])
    const again = store()
    const after = await again.open(await s.exportClan())
    expect(after).toEqual(before)
    s.dispose()
    again.dispose()
  })

  it('refuses a v2 .clan with UnsupportedContract, writes nothing and keeps the open document', async () => {
    // A v2 project: a real .clan whose data says contract 2 (its own older schema).
    const s = store()
    await s.create({ person: MAYA })
    const file = join(tmp, 'v2.clan')
    writeFileSync(file, await s.exportClan())
    const loose = join(tmp, 'loose.json')
    writeFileSync(loose, JSON.stringify({ type: 'object' }))
    clanCli(['patch-schema', file, loose])
    const v2 = JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'examples', 'invalid', 'document.v2.json'), 'utf8'))
    clanCli(['patch-data', file, JSON.stringify({ ...Object.fromEntries(Object.keys(s.get()).map((k) => [k, null])), ...v2 }), '--no-decision'])
    const v2bytes = new Uint8Array(readFileSync(file))
    const copy = v2bytes.slice()

    const mem = memoryPersistence()
    const opener = store({ persistence: mem })
    const current = await opener.create({ person: MAYA, title: 'Mine' })
    await opener.flush()
    const writes = mem.writes
    const err = await opener.open(v2bytes).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContract)
    expect((err as UnsupportedContract).found).toBe('2')
    expect((err as Error).message).toMatch(/older version/)
    expect(Buffer.from(v2bytes).equals(Buffer.from(copy))).toBe(true)
    expect(opener.get()).toEqual(current)
    await opener.flush()
    expect(mem.writes).toBe(writes)

    // load() of saved v2 bytes refuses too, and leaves them saved.
    const saved = memoryPersistence()
    await saved.write({ bytes: v2bytes, handle: 'maya', savedAt: AT })
    await expect(store({ persistence: saved }).load()).rejects.toBeInstanceOf(UnsupportedContract)
    expect(Buffer.from((await saved.read())!.bytes).equals(Buffer.from(copy))).toBe(true)
  })

  it('a patch that breaks the schema, the rules or upstream is refused and changes nothing', async () => {
    const s = store()
    await filled(s)
    const before = structuredClone(s.get())
    const bytesBefore = await s.exportClan()
    const shot0 = id('shot', 0)
    await expect(s.patch({ shots: { [shot0]: { camera: { size: 'enormous' } } } }, { action: 'set bad size' })).rejects.toBeInstanceOf(InvalidDocument)
    await expect(s.patch({ shots: { 'not-an-id': {} } }, { action: 'bad key' })).rejects.toThrow(/document.schema.json/)
    await expect(s.patch({ project: null }, { action: 'drop a required key' })).rejects.toThrow(/project/)
    await expect(s.patch({ surprise: 1 }, { action: 'unknown key' })).rejects.toThrow(/additional/)
    await expect(s.patch({ upstream: { x: {} } }, { action: 'write upstream' })).rejects.toThrow(/read-only/)
    // integrity: a beat past the end of its shot
    const beat = id('beat', 9)
    await expect(s.patch({ beats: { [beat]: { id: beat, v: 1, field_v: {}, shot_id: shot0, rank: 'a0', at_s: 9, kind: 'moment' } } }, { action: 'late beat' })).rejects.toThrow(/past the end/)
    expect(s.get()).toEqual(before)
    expect(Buffer.from(await s.exportClan()).equals(Buffer.from(bytesBefore))).toBe(true)
  })

  it('the exported bytes open with the real clan CLI; targets reach the chain', async () => {
    const s = store()
    const before = await filled(s)
    const file = join(process.env.KEEP_CLAN_DIR || tmp, 'maya.clan')
    writeFileSync(file, await s.exportClan())
    const data = parseYaml(clanCli(['read', 'data', file]))
    delete data.$schema
    expect(data).toEqual(before)
    expect(clanCli(['validate', '--strict', file])).toMatch(/^OK$/m)
    const chain = clanCli(['read', 'chain', file])
    expect(chain).toContain('name @hero_front')
    expect(chain).toContain(`#shots[${id('shot', 0)}]`)
    expect(chain).toContain('human:p_maya001')
  })

  it('saves to persistence after a debounce and restores with load()', async () => {
    const mem = memoryPersistence()
    const s = store({ persistence: mem })
    await s.create({ person: MAYA })
    const { script } = defaults(s)
    for (let i = 0; i < 5; i++) await s.patch({ scripts: { [script]: { title: `Draft ${i}` } } }, { action: `set title ${i}` })
    expect(mem.writes).toBe(0)
    await new Promise((r) => setTimeout(r, 80))
    expect(mem.writes).toBe(1)
    expect(mem.last?.handle).toBe('maya')
    const again = store({ persistence: mem })
    expect(await again.load()).toEqual(s.get())
    expect(await store({ persistence: memoryPersistence() }).load()).toBeNull()
  })

  it('round-trips through IndexedDB (fake-indexeddb) and works with none', async () => {
    const { indexedDB: fake, IDBKeyRange } = await import('fake-indexeddb')
    const g = globalThis as Record<string, unknown>
    g.indexedDB = fake
    g.IDBKeyRange = IDBKeyRange
    try {
      const s = new ClanDocumentStore({ wasm, saveDebounceMs: 10, persistence: indexedDbPersistence('test-db') })
      await s.create({ person: MAYA })
      await s.flush()
      const again = new ClanDocumentStore({ wasm, persistence: indexedDbPersistence('test-db') })
      expect(await again.load()).toEqual(s.get())
    } finally {
      delete g.indexedDB
      delete g.IDBKeyRange
    }
    const none = new ClanDocumentStore({ wasm, saveDebounceMs: 5 })
    await none.create({ person: MAYA })
    await none.flush()
    expect(await new ClanDocumentStore({ wasm }).load()).toBeNull()
  })

  it('records a decision with no data change, once when asked', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const before = s.get()
    const chain0 = await s.chain()
    expect(await s.record({ action: 'pin_decision', cites: [chain0[0].id!] })).toBe(true)
    expect(await s.record({ agent: 'wren', action: 'render failed frame job_X' }, { once: true })).toBe(true)
    expect(await s.record({ agent: 'wren', action: 'render failed frame job_X' }, { once: true })).toBe(false)
    expect(s.get()).toEqual(before)
    const chain = await s.chain()
    expect(chain[1].action).toBe('pin_decision')
    expect(chain[1].cites).toEqual([chain0[0].id])
  })

  it('mirrors on the interval only when changed, and on demand', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const posts: { reason: string; size: number }[] = []
    const stop = s.startMirror(async (bytes, meta) => { posts.push({ reason: meta.reason, size: bytes.byteLength }) }, { everyMs: 40 })
    await new Promise((r) => setTimeout(r, 60))
    expect(posts.filter((p) => p.reason === 'interval')).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 90))
    expect(posts.filter((p) => p.reason === 'interval')).toHaveLength(1)
    await s.mirrorNow('accept')
    expect(posts.filter((p) => p.reason === 'accept')).toHaveLength(1)
    stop()
    expect(posts.every((p) => p.size > 1000)).toBe(true)
  })

  it('writeAsset is quiet: the member is there, with no decision entry and no text sidecar (features/engine-store.clan)', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const before = (await s.chain()).length
    const bytes = new Uint8Array([0x4e, 0x43, 0x59, 1, 9, 8, 7, 6])
    await s.writeAsset('canvas.ybin.zst', bytes)
    await s.writeAsset('canvas.ybin.zst', bytes)
    expect((await s.chain()).length).toBe(before)
    expect(await s.readAsset('canvas.ybin.zst')).toEqual(bytes)
    expect(await s.readAsset('nothing.bin')).toBeNull()
    const names = Object.keys(unzipSync(await s.exportClan()))
    expect(names).toContain('human/assets/canvas.ybin.zst')
    expect(names.filter((n) => n.includes('.extracted'))).toEqual([])
  })

  it('runs beforeBytes at each checkpoint moment, before the bytes leave, and not on other writes', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const moments: string[] = []
    s.setBeforeBytes(async (reason) => {
      moments.push(reason)
      await s.writeAsset('canvas.ybin.zst', new Uint8Array([reason.length]))
    })
    const posted: number[] = []
    const stop = s.startMirror(async (bytes) => {
      posted.push(unzipSync(bytes)['human/assets/canvas.ybin.zst']?.[0] ?? -1)
    }, { everyMs: 60_000 })
    await s.patch({ project: { title: 'Rain' } }, { action: 'set project title' })
    expect(moments).toEqual([])
    await s.mirrorNow('accept')
    await s.mirrorNow('handoff')
    const exported = await s.exportClan()
    expect(moments).toEqual(['accept', 'handoff', 'export'])
    expect(posted).toEqual(['accept'.length, 'handoff'.length])
    expect(unzipSync(exported)['human/assets/canvas.ybin.zst'][0]).toBe('export'.length)
    stop()
  })

  it('builds the export zip: <title>.clan plus assets/<sha256>.<ext>, hashes checked', async () => {
    const s = store()
    await s.create({ person: MAYA, title: 'Rain' })
    const png = new TextEncoder().encode('pretend png bytes')
    const pdf = new TextEncoder().encode('pretend pdf bytes')
    const real = async (b: Uint8Array, kind: DocAsset['kind'], mime: string): Promise<DocAsset> => ({
      sha256: `sha256:${await sha256Hex(b)}`, kind, mime, origin: 'uploaded', locations: ['idb://x'],
    })
    const a1 = await real(png, 'image', 'image/png')
    const a2 = await real(pdf, 'document', 'application/pdf')
    const lost = asset(77) as DocAsset
    const wrong = asset(78) as DocAsset
    await s.patch({ assets: Object.fromEntries([a1, a2, lost, wrong].map((a) => [a.sha256, a])) }, { action: 'add files' })
    const byHash: Record<string, Uint8Array> = { [a1.sha256]: png, [a2.sha256]: pdf, [wrong.sha256]: png }
    const out = await buildExportZip({ clan: await s.exportClan(), doc: s.get(), resolve: async (a) => byHash[a.sha256] ?? null })
    const files = unzipSync(out.zip)
    expect(Object.keys(files).sort()).toEqual([`assets/${a1.sha256.slice(7)}.png`, `assets/${a2.sha256.slice(7)}.pdf`, 'Rain.clan'].sort())
    expect(out.missing).toEqual([lost.sha256])
    expect(out.mismatched).toEqual([wrong.sha256])
  })

  it('the template app carries exactly the bundled contract (rerun `npm run app` if this fails)', async () => {
    const entries = unzipSync(appTemplate())
    const carried = JSON.parse(new TextDecoder().decode(entries['agent/output-schema.json']))
    expect(carried).toEqual(bundle())
  })

  it('document.ad.json, the overhaul scenario, is written through patches and read back', async () => {
    const ad = example<Doc>('document.ad.json')
    const s = store()
    await s.create({ person: MAYA })
    // The project and its maps, in a few writes; upstream is the host's (never patched).
    const { upstream: _up, ...rest } = ad
    const wipe = Object.fromEntries(['scripts', 'storyboards', 'videos', 'links'].map((m) => [m, Object.fromEntries(Object.keys(s.get()[m as 'links']).map((k) => [k, null]))]))
    await s.patch(wipe, { action: 'delete the defaults' })
    await s.patch({ project: rest.project, assets: rest.assets, documents: rest.documents, boards: rest.boards, keys: rest.keys, refs: rest.refs }, { action: 'bring in the brand and refs' })
    await s.patch({ scripts: rest.scripts, scenes: rest.scenes, storyboards: rest.storyboards, jobs: rest.jobs }, { action: 'plan the scenes' })
    await s.patch({ shots: rest.shots, beats: rest.beats, frames: rest.frames, sketches: rest.sketches, takes: rest.takes }, { action: 'plan the shots' })
    await s.patch({ videos: rest.videos, renders: rest.renders, reviews: rest.reviews, format_sets: rest.format_sets, sizes: rest.sizes }, { action: 'cut and size' })
    await s.patch({ links: rest.links, checks: rest.checks, asks: rest.asks, suggestions: rest.suggestions, spin_ins: rest.spin_ins, stale: rest.stale, exports: rest.exports }, { action: 'link and check' })
    const again = store()
    const back = await again.open(await s.exportClan())
    expect(back).toEqual(rest)
    expect(integrity(back)).toEqual([])
  })
})

describe('size and time, worst case', () => {
  it('a worst-case project stays under 3.5 MB and validates in under 60 ms', async () => {
    const s = store({ persistence: null })
    await s.create({ person: MAYA })
    const { storyboard } = defaults(s)
    const SHOTS = 60
    const ranks = ranksBetween(null, null, SHOTS)
    // Text that compresses like prose, not like a repeated letter.
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const WORDS = ['light', 'Maya', 'walks', 'the', 'waterline', 'bottle', 'opens', 'golden', 'slow', 'push', 'in', 'on', 'her', 'face', 'sea', 'laughs', 'cold', 'morning', 'hand', 'sharp']
    const words = (n: number) => { let t = ''; while (t.length < n) t += `${WORDS[Math.floor(rand() * WORDS.length)]}${rand() < 0.1 ? '. ' : ' '}`; return t.slice(0, n) }
    const prose = (n: number) => ({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: words(n) }] }] })
    const shots: Record<string, unknown> = {}
    const beats: Record<string, unknown> = {}
    const frames: Record<string, unknown> = {}
    const jobs: Record<string, unknown> = {}
    for (let i = 0; i < SHOTS; i++) {
      const sid = id('shot', i)
      shots[sid] = { id: sid, v: 9, field_v: { 'camera/size': 3, duration_s: 4, rank: 7 }, ...shotValue(storyboard, ranks[i]),
        prose: prose(3000), action: words(600), direction: words(2400), refs: [], last_writer: 'dex' }
      for (let b = 0; b < 6; b++) {
        const bid = id('beat', i * 10 + b)
        beats[bid] = { id: bid, v: 2, field_v: {}, shot_id: sid, rank: `a${b + 1}`, at_s: b * 0.5, kind: 'moment', prose: prose(200), text: words(200) }
      }
      for (let f = 0; f < 6; f++) {
        const fid = id('frame', i * 10 + f)
        frames[fid] = { id: fid, v: 1, field_v: {}, shot_id: sid, version: f + 1, kind: 'generated', asset: sha(i * 10 + f), crew: 'wren', model: 'gen4_image', provider: 'runway' }
        const jid = id('job', i * 10 + f)
        jobs[jid] = { id: jid, v: 3, field_v: {}, ...jobValue(i * 10 + f) }
      }
    }
    await s.patch({ shots, beats, frames, jobs }, { action: 'fill the worst case', quiet: true })
    // A long chain: 300 attributed writes, each with its targets and a cite.
    const doc = s.documentId()
    const sizes = ['wide', 'medium', 'close']
    for (let i = 0; i < 300; i++) {
      const sid = id('shot', i % SHOTS)
      await s.patch({ shots: { [sid]: { camera: { size: sizes[i % 3] } } } }, {
        action: `set shots[${sid}].camera.size`, agent: i % 2 ? 'human:p_maya001' : 'dex', rationale: words(120),
        targets: [`${doc}#shots[${sid}]`, `${doc}#shots[${sid}].camera.size`], cites: [`${doc}#jobs[${id('job', i % 300)}]`],
      })
    }
    const bytes = await s.exportClan()
    problems(s.get()) // compiled once, as on every write after the first
    const t = performance.now()
    const p = problems(s.get())
    const ms = performance.now() - t
    console.log(`\n[clan-store worst case] ${SHOTS} shots, ${Object.keys(beats).length} beats, ${Object.keys(frames).length} frames, ${Object.keys(jobs).length} jobs: ${bytes.byteLength} bytes, validate ${ms.toFixed(1)} ms\n`)
    expect(p).toEqual([])
    expect(bytes.byteLength).toBeLessThan(3.5 * 1024 * 1024)
    expect(ms).toBeLessThan(60)
  }, 180_000)
})

describe('postClanMirror', () => {
  const capture = () => {
    const sent: { url: string; headers: Record<string, string> }[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string> })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    return { sent, fetchFn }
  }
  it('names the project in X-Project-Id, and says when the relay took it', async () => {
    const { sent, fetchFn } = capture()
    const posted: Date[] = []
    const post = postClanMirror({ relay: 'https://relay.test/api/', token: () => 't', projectId: 'prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8', onPosted: (at) => posted.push(at), fetchFn })
    await post(new Uint8Array([80, 75, 3, 4]), { handle: 'maya', reason: 'manual' })
    expect(sent[0].url).toBe('https://relay.test/api/clan')
    expect(sent[0].headers['X-Project-Id']).toBe('prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8')
    expect(posted).toHaveLength(1)
  })
  it('sends no X-Project-Id without a project', async () => {
    const { sent, fetchFn } = capture()
    await postClanMirror({ relay: 'https://relay.test', token: () => 't', fetchFn })(new Uint8Array([80, 75, 3, 4]), { handle: 'maya', reason: 'interval' })
    expect('X-Project-Id' in sent[0].headers).toBe(false)
  })
})
