import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import {
  ClanDocumentStore, InvalidDocument, buildExportZip, memoryPersistence, postClanMirror, problems, sha256Hex,
  indexedDbPersistence, type Doc, type DocAsset,
} from '../src/index'
import { appTemplate } from '../src/host'
import { bundle } from '../scripts/bundle-schema.mjs'
import { AT, asset, id, job, sha, shot, wasmBytes } from './fixtures'

const wasm = wasmBytes()
const maya = { participant: { id: 'p_a1b2c3', handle: 'maya' } }
const tmp = mkdtempSync(join(tmpdir(), 'clan-store-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function store(persistence = memoryPersistence() as ReturnType<typeof memoryPersistence> | null) {
  return new ClanDocumentStore({ wasm, persistence, saveDebounceMs: 20 })
}

function clanCli(args: string[]): string {
  return execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', ...args], { encoding: 'utf8' })
}

async function filled(s: ClanDocumentStore): Promise<Doc> {
  await s.create(maya)
  await s.patch({ stage: { current: 'character', next_action: 'Name your character.' } }, { action: 'set the next action' })
  await s.patch({ assets: [asset(1), asset(2)] }, { action: 'added two assets' })
  await s.patch(
    { keys: [{ key: 'hero', role: 'character' }], refs: [{ id: id('ref', 0), key: 'hero', variant: 'front', asset: sha(1), node: id('job', 0), named_at: AT }] },
    { action: 'named @hero_front', rationale: 'its front' },
  )
  await s.patch({ shots: [shot(0), shot(1)], jobs: [job(0), job(1)] }, { action: 'planned shots' })
  return s.get()
}

describe('ClanDocumentStore against the real napkin-wasm', () => {
  it('create → patch → export → reopen from bytes: same data, valid', async () => {
    const s = store()
    const before = await filled(s)
    expect(problems(before)).toEqual([])
    expect(before.participant.handle).toBe('maya')
    expect(before.shots).toHaveLength(2)

    const bytes = await s.exportClan()
    expect(bytes.byteLength).toBeGreaterThan(1000)

    const again = store()
    const after = await again.open(bytes)
    expect(after).toEqual(before)
    expect(problems(after)).toEqual([])
    s.dispose()
    again.dispose()
  })

  it('a document made under an older schema moves to the app\'s when it opens (scripts to 1500)', async () => {
    const s = store()
    await filled(s)
    // An "older" document: the same, but with the 600-character script limit it was made with.
    const older = bundle() as Record<string, unknown>
    const text = JSON.stringify(older).replace(/("imported_text":\{[^}]*"maxLength":)1500/, '$1600')
    expect(text).toContain('"maxLength":600')
    const file = join(tmp, 'older.clan')
    writeFileSync(file, await s.exportClan())
    const schemaFile = join(tmp, 'older-schema.json')
    writeFileSync(schemaFile, text)
    clanCli(['patch-schema', file, schemaFile])
    const olderBytes = new Uint8Array(execFileSync('cat', [file]))

    const again = store()
    await again.open(olderBytes)
    const rev = id('rev', 0)
    const script = { current: rev, revisions: [{ id: rev, created_at: AT, imported_text: 'a'.repeat(1000), target_s: 15, status: 'draft' }] }
    await again.patch({ script }, { action: 'a longer script' }) // refused before the move to the app's schema
    expect((again.get().script?.revisions[0] as { imported_text: string }).imported_text).toHaveLength(1000)
    s.dispose()
    again.dispose()
  })

  it('a patch that breaks the schema is refused and leaves the document unchanged', async () => {
    const s = store()
    await filled(s)
    const before = structuredClone(s.get())
    const bytesBefore = await s.exportClan()

    await expect(s.patch({ stage: { current: 'editing' } }, { action: 'bad stage' })).rejects.toBeInstanceOf(InvalidDocument)
    await expect(s.patch({ shots: [{ id: 'not-an-id' }] }, { action: 'bad shot' })).rejects.toThrow(/document.schema.json/)
    await expect(s.patch({ participant: null }, { action: 'drop a required key' })).rejects.toThrow(/participant/)
    await expect(s.patch({ surprise: 1 }, { action: 'unknown key' })).rejects.toThrow(/additional/)

    expect(s.get()).toEqual(before)
    const reopened = await store().open(await s.exportClan())
    expect(reopened).toEqual(before)
    // Nothing was written: the archive is byte-for-byte what it was.
    expect(Buffer.from(await s.exportClan()).equals(Buffer.from(bytesBefore))).toBe(true)
    // And the store still takes a good patch afterwards.
    await s.patch({ stage: { current: 'storyboard' } }, { action: 'to storyboard' })
    expect(s.get().stage.current).toBe('storyboard')
  })

  it('every patch and verdict is in the decision chain, attributed to the handle', async () => {
    const s = store()
    await filled(s)
    await s.verdict({ kind: 'accept', target: { kind: 'take', id: id('take', 1) }, note: 'the light is right' })
    await s.verdict({ kind: 'reject', target: { kind: 'frame', id: id('frame', 2) } })
    await s.verdict({ kind: 'select', target: { kind: 'view', id: 'front' } })
    const before = s.get()

    const chain = await s.chain()
    const actions = chain.map(d => d.action)
    expect(actions.slice(0, 3)).toEqual([
      'select view front',
      `reject frame ${id('frame', 2)}`,
      `accept take ${id('take', 1)}`,
    ])
    expect(actions).toContain('named @hero_front')
    expect(actions).toContain('started the document')
    const accept = chain[2]
    expect(accept.agent).toBe('maya')
    expect(accept.rationale).toBe('the light is right')
    expect(accept.fields_changed ?? []).toEqual([])
    const named = chain.find(d => d.action === 'named @hero_front')!
    expect(named.rationale).toBe('its front')
    expect(named.fields_changed).toEqual(['keys', 'refs'])
    // A verdict changes no data.
    expect(s.get()).toEqual(before)

    // The chain travels in the bytes.
    const again = store()
    await again.open(await s.exportClan())
    expect((await again.chain()).map(d => d.action).slice(0, 3)).toEqual(actions.slice(0, 3))

    await expect(s.verdict({ kind: 'maybe' as 'accept', target: { kind: 'take', id: 'x' } })).rejects.toThrow(/accept, reject or select/)
  })

  it('the exported bytes open with the real clan CLI', async () => {
    const s = store()
    const before = await filled(s)
    await s.verdict({ kind: 'accept', target: { kind: 'shot', id: id('shot', 0) }, note: 'cli check' })
    const file = join(process.env.KEEP_CLAN_DIR || tmp, 'maya.clan')
    writeFileSync(file, await s.exportClan())

    const data = parseYaml(clanCli(['read', 'data', file]))
    delete data.$schema
    expect(data).toEqual(before)
    const report = clanCli(['validate', '--strict', file])
    expect(report).toMatch(/^OK$/m)
    const chain = clanCli(['read', 'chain', file])
    expect(chain).toContain(`accept shot ${id('shot', 0)}`)
    // The document carries the contract (bundled) as its schema.
    const agent = clanCli(['read', 'agent', file])
    expect(agent).toContain('production-tool')
  })

  it('saves to persistence after a debounce and restores with load()', async () => {
    const mem = memoryPersistence()
    const s = store(mem)
    await s.create(maya)
    for (let i = 0; i < 5; i++) {
      await s.patch({ stage: { current: 'character', next_action: `step ${i}` } }, { action: `step ${i}` })
    }
    expect(mem.writes).toBe(0)
    await new Promise(r => setTimeout(r, 80))
    expect(mem.writes).toBe(1)
    expect(mem.last?.handle).toBe('maya')

    const again = store(mem)
    const restored = await again.load()
    expect(restored).toEqual(s.get())
    expect(await store(memoryPersistence()).load()).toBeNull()
    s.dispose()
    again.dispose()
  })

  it('round-trips through IndexedDB (fake-indexeddb) and works with none', async () => {
    const { indexedDB: fake, IDBKeyRange } = await import('fake-indexeddb')
    const g = globalThis as Record<string, unknown>
    g.indexedDB = fake
    g.IDBKeyRange = IDBKeyRange
    try {
      const s = new ClanDocumentStore({ wasm, saveDebounceMs: 10, persistence: indexedDbPersistence('test-db') })
      await s.create(maya)
      await s.patch({ shots: [shot(0)] }, { action: 'one shot' })
      await s.flush()
      const again = new ClanDocumentStore({ wasm, persistence: indexedDbPersistence('test-db') })
      expect(await again.load()).toEqual(s.get())
    } finally {
      delete g.indexedDB
      delete g.IDBKeyRange
    }
    // No IndexedDB at all: the default persistence quietly keeps nothing.
    const none = new ClanDocumentStore({ wasm, saveDebounceMs: 5 })
    await none.create(maya)
    await none.flush()
    expect(await new ClanDocumentStore({ wasm }).load()).toBeNull()
  })

  it('onChange fires on create, patch and verdict; unsubscribe stops it', async () => {
    const s = store()
    const seen: string[] = []
    const off = s.onChange(d => seen.push(d.stage.current))
    await s.create(maya)
    await s.patch({ stage: { current: 'video' } }, { action: 'to video' })
    await s.verdict({ kind: 'accept', target: { kind: 'shot', id: id('shot', 0) } })
    off()
    await s.patch({ stage: { current: 'storyboard' } }, { action: 'back' })
    expect(seen).toEqual(['character', 'video', 'video'])
  })

  it('mirrors on accept verdicts and on the interval only when changed', async () => {
    const s = store()
    await s.create(maya)
    const posts: { reason: string; size: number }[] = []
    const stop = s.startMirror(async (bytes, meta) => { posts.push({ reason: meta.reason, size: bytes.byteLength }) }, { everyMs: 40 })
    await new Promise(r => setTimeout(r, 60))
    expect(posts.filter(p => p.reason === 'interval')).toHaveLength(1)
    await new Promise(r => setTimeout(r, 90))
    expect(posts.filter(p => p.reason === 'interval')).toHaveLength(1) // nothing changed since
    await s.verdict({ kind: 'reject', target: { kind: 'take', id: id('take', 3) } })
    await s.verdict({ kind: 'accept', target: { kind: 'take', id: id('take', 4) } })
    await new Promise(r => setTimeout(r, 5))
    expect(posts.filter(p => p.reason === 'accept')).toHaveLength(1)
    stop()
    const n = posts.length
    await s.patch({ stage: { current: 'video' } }, { action: 'to video' })
    await new Promise(r => setTimeout(r, 60))
    expect(posts).toHaveLength(n)
    expect(posts.every(p => p.size > 1000)).toBe(true)
  })

  it('builds the export zip: <handle>.clan plus assets/<sha256>.<ext>, hashes checked', async () => {
    const s = store()
    await s.create(maya)
    const png = new TextEncoder().encode('pretend png bytes')
    const mp4 = new TextEncoder().encode('pretend mp4 bytes')
    const real = async (b: Uint8Array, kind: 'image' | 'video', mime: string): Promise<DocAsset> => ({
      sha256: `sha256:${await sha256Hex(b)}`, kind, mime, origin: 'generated', locations: ['idb://x'],
    })
    const a1 = await real(png, 'image', 'image/png')
    const a2 = await real(mp4, 'video', 'video/mp4')
    const lost = { ...asset(77) } as DocAsset
    const wrong = { ...asset(78) } as DocAsset
    await s.patch({ assets: [a1, a2, lost, wrong] }, { action: 'assets' })
    const byHash: Record<string, Uint8Array> = { [a1.sha256]: png, [a2.sha256]: mp4, [wrong.sha256]: png }
    const out = await buildExportZip({ clan: await s.exportClan(), doc: s.get(), resolve: async a => byHash[a.sha256] ?? null })
    const files = unzipSync(out.zip)
    expect(Object.keys(files).sort()).toEqual([
      `assets/${a1.sha256.slice(7)}.png`,
      `assets/${a2.sha256.slice(7)}.mp4`,
      'maya.clan',
    ].sort())
    expect(out.missing).toEqual([lost.sha256])
    expect(out.mismatched).toEqual([wrong.sha256])
    const reopened = await store().open(files['maya.clan'])
    expect(reopened).toEqual(s.get())
  })

  it('the template app carries exactly the bundled contract (rerun `npm run app` if this fails)', async () => {
    const { unzipSync: unzip } = await import('fflate')
    const entries = unzip(appTemplate())
    const carried = JSON.parse(new TextDecoder().decode(entries['agent/output-schema.json']))
    expect(carried).toEqual(bundle())
  })
})

describe('timing and size, 8 shots + 30 jobs', () => {
  let s: ClanDocumentStore
  beforeAll(async () => {
    s = store(null)
    await s.create(maya)
  })

  it('measures each patch', async () => {
    const rows: string[] = []
    const shots = Array.from({ length: 8 }, (_, i) => shot(i))
    const jobs = Array.from({ length: 30 }, (_, i) => job(i))
    const t0 = performance.now()
    await s.patch({ shots, assets: Array.from({ length: 16 }, (_, i) => asset(i + 1)) }, { action: 'shot list' })
    rows.push(`shot list (8 shots, 16 assets): ${(performance.now() - t0).toFixed(1)} ms`)
    let jobsSoFar: unknown[] = []
    const times: number[] = []
    for (const j of jobs) {
      jobsSoFar = [...jobsSoFar, j]
      const t = performance.now()
      await s.patch({ jobs: jobsSoFar }, { action: `job ${j.id} completed` })
      times.push(performance.now() - t)
    }
    const size = (await s.exportClan()).byteLength
    const sorted = [...times].sort((a, b) => a - b)
    rows.push(`30 job patches: median ${sorted[15].toFixed(1)} ms, p90 ${sorted[27].toFixed(1)} ms, max ${sorted[29].toFixed(1)} ms`)
    const t2 = performance.now()
    await s.patch({ stage: { current: 'video', next_action: 'Review the takes.' } }, { action: 'small patch on the full document' })
    rows.push(`one small patch on the full document: ${(performance.now() - t2).toFixed(1)} ms`)
    const t3 = performance.now()
    await s.verdict({ kind: 'accept', target: { kind: 'take', id: id('take', 1) } })
    rows.push(`one verdict: ${(performance.now() - t3).toFixed(1)} ms`)
    const finalSize = (await s.exportClan()).byteLength
    const dataYaml = (await s.chain()).length
    rows.push(`.clan size: ${size} bytes after the jobs, ${finalSize} bytes at the end (${dataYaml} chain entries)`)
    console.log(`\n[clan-store timing]\n  ${rows.join('\n  ')}\n`)
    expect(s.get().jobs).toHaveLength(30)
    expect(problems(s.get())).toEqual([])
  })
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
