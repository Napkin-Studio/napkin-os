// A project born as a spin-off (features/production-spinoff.clan): napkin-web writes it to the relay
// from a brief, and the tool opens it, edits it and saves it again. The manifest the spin-off wrote
// (what it carries, from where, the decisions) must survive that round trip: provenance that the first
// autosave drops is provenance nobody has.
//
// The fixture is `cargo run -p clan-sdk --example make_production -- /dev/null brief-spun-off.clan`:
// a Brief Maker document spun off into the Production template with source_uri clan-store:doc-lumen-brief.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { BRIEF_VERSION_ACTION, ClanDocumentStore, LocalPatchBus, memoryPersistence } from '../src/index'
import { STALE_WASM } from '../src/store'
import { MAYA, id, store, wasmBytes } from './fixtures'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = () => new Uint8Array(readFileSync(join(here, 'fixtures', 'brief-spun-off.clan')))

function entries(bytes: Uint8Array): { manifest: Record<string, any>; data: Record<string, any>; chain: { decisions: Record<string, any>[] } } {
  const z = unzipSync(bytes)
  const text = (p: string) => new TextDecoder().decode(z[p])
  return { manifest: parseYaml(text('manifest.yaml')), data: parseYaml(text('shared/data.yaml')), chain: parseYaml(text('agent/decision-chain.yaml')) }
}

describe('a project born as a spin-off', () => {
  it('opens as a new blank project that still carries the brief', async () => {
    const s = store()
    const doc = await s.open(fixture())
    expect(doc.contract_version).toBe('3')
    expect(doc.project.title).toBe('Lumen Water')
    expect(Object.keys(doc.scripts)).toEqual([])
    expect(Object.keys(doc.storyboards)).toEqual([])
    const before = entries(fixture())
    const briefId = before.manifest.lineage.carried.document_id
    expect((doc as any).upstream[briefId].single_minded_proposition).toBe('Lumen is what the day starts with.')
    // the manifest says which brief, and its version (the tool makes the Brief node from it)
    expect(await s.spunOffFrom()).toEqual({ document_id: briefId, data_sha256: before.manifest.lineage.carried.data_sha256, title: 'Lumen Water', version: 1 })
    // starting the project is a decision of the person who opened it, after the carried ones
    const chain = await s.chain()
    expect(chain[0].action).toBe('start the project')
    expect(chain.some((d) => String(d.action).startsWith('spin off'))).toBe(true)
  })

  it('opens and keeps the projection the host writes into a project spun off by napkin-web', async () => {
    // Found live: napkin-web's host adds data.projection (library::with_projection); the template's schema refused it.
    const z = unzipSync(fixture())
    const data = parseYaml(new TextDecoder().decode(z['shared/data.yaml']))
    data.projection = { built_from: { built_at: '2026-11-22T09:13:07Z', facts_sha256: 'sha256:aa', findings_sha256: 'sha256:bb' }, findings: {}, pins: {} }
    z['shared/data.yaml'] = new TextEncoder().encode(stringifyYaml(data))
    const s = store()
    const doc = await s.open(zipSync(z))
    expect((doc as any).projection.pins).toEqual({})
    expect(entries(await s.exportClan()).data.projection).toEqual(data.projection)
  })

  it('a brief approved twice, spun off, is v2: the parent\'s approves carried in its chain are counted', async () => {
    const z = unzipSync(fixture())
    const briefId = parseYaml(new TextDecoder().decode(z['manifest.yaml'])).lineage.carried.document_id
    const chain = parseYaml(new TextDecoder().decode(z['agent/decision-chain.yaml'])) as { decisions: Record<string, any>[] }
    const approve = (n: number) => ({ id: `d_lock${n}`, kind: 'approve', agent: 'human', actor: 'human:u_a', action: 'lock', targets: [`${briefId}#`], rationale: 'Locked.', timestamp: `2026-11-1${n}T12:00:00Z` })
    const other = { id: 'd_con', kind: 'contest', agent: 'human', actor: 'human:u_a', action: 'open_contest', targets: [`${briefId}#`], rationale: 'Not an approval.', timestamp: '2026-11-09T12:00:00Z' }
    chain.decisions = [approve(2), approve(1), other, ...chain.decisions]
    z['agent/decision-chain.yaml'] = new TextEncoder().encode(stringifyYaml(chain))
    const s = store()
    await s.open(zipSync(z))
    expect((await s.spunOffFrom())?.version).toBe(2)
  })

  it('counts the locks as the host writes them, on the bare brief id (UAT round 4 F24: a v2 brief spun off said v1)', async () => {
    // napkin-host's approve targets the document id itself (ops/review.rs); napkin-web's test
    // a_brief_locked_twice_is_v2_and_its_spinoff_carries_both_locks_on_the_bare_id pins that shape in a real spin-off.
    const z = unzipSync(fixture())
    const briefId = parseYaml(new TextDecoder().decode(z['manifest.yaml'])).lineage.carried.document_id
    const chain = parseYaml(new TextDecoder().decode(z['agent/decision-chain.yaml'])) as { decisions: Record<string, any>[] }
    const approve = (n: number) => ({ id: `d_lock${n}`, kind: 'approve', agent: 'human', actor: 'human:u_a', action: 'lock', targets: [briefId], rationale: 'Locked.', timestamp: `2026-11-1${n}T12:00:00Z` })
    const elsewhere = { id: 'd_other', kind: 'approve', agent: 'human', actor: 'human:u_a', action: 'lock', targets: [`${briefId}x`], rationale: 'Another document.', timestamp: '2026-11-09T12:00:00Z' }
    chain.decisions = [approve(2), approve(1), elsewhere, ...chain.decisions]
    z['agent/decision-chain.yaml'] = new TextEncoder().encode(stringifyYaml(chain))
    const s = store()
    await s.open(zipSync(z))
    expect((await s.spunOffFrom())?.version).toBe(2)
  })

  it('a spin-off whose brief carried an uploaded file (a link, its bytes in the workspace) saves and reopens with its brief (UAT round 4 A15)', async () => {
    // napkin-web's spin-off links the brief's uploaded file (features/spinoff-asset-links): the manifest names it with
    // linked: true and the bytes stay in the workspace. This browser's host has no file store, so a save that made the
    // link whole failed, the project reopened blank, and the Brief node never came.
    const z = unzipSync(fixture())
    const manifest = parseYaml(new TextDecoder().decode(z['manifest.yaml']))
    const bytes = new TextEncoder().encode('the brief an agency uploaded')
    manifest.files.push({ id: 'human-assets-document-1-0.txt', path: 'human/assets/document-1-0.txt', role: 'human-asset', type: 'application/octet-stream', sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, linked: true })
    z['manifest.yaml'] = new TextEncoder().encode(stringifyYaml(manifest))
    const persistence = memoryPersistence()
    const first = new ClanDocumentStore({ wasm: wasmBytes(), persistence, saveDebounceMs: 0, person: MAYA })
    await first.open(zipSync(z))
    const from = await first.spunOffFrom()
    expect(from?.document_id).toBe(manifest.lineage.carried.document_id)
    await first.flush()
    // (the store keeps nothing else open)
    // Reopened from what this browser kept: still the spin-off, the link kept as a link.
    const again = new ClanDocumentStore({ wasm: wasmBytes(), persistence, saveDebounceMs: 0, person: MAYA })
    const doc = (await again.load()) as any
    expect(doc).toBeTruthy()
    expect((await again.spunOffFrom())?.document_id).toBe(from!.document_id)
    expect(doc.upstream[from!.document_id]).toBeTruthy()
    const kept = parseYaml(new TextDecoder().decode(unzipSync(await persistedBytes(persistence))['manifest.yaml']))
    expect(kept.files.find((f: any) => f.path === 'human/assets/document-1-0.txt')).toMatchObject({ linked: true })
  })

  it('a build whose napkin-wasm has no keptBytes says so on save, never a quiet download that fails', async () => {
    const s = new ClanDocumentStore({ wasm: wasmBytes(), persistence: memoryPersistence(), saveDebounceMs: 0, person: MAYA })
    await s.open(fixture())
    const host = (s as unknown as { host: { keptBytes?: unknown } }).host
    const proto = Object.getPrototypeOf(host) as { keptBytes?: unknown }
    const kept = proto.keptBytes
    proto.keptBytes = undefined
    try {
      await expect(s.exportClan().then(() => (s as unknown as { bytes: () => Uint8Array }).bytes())).rejects.toThrow(STALE_WASM)
    } finally {
      proto.keptBytes = kept
    }
  })

  it('a save the host cannot make reaches onSaveError, for this browser\'s copy and the server\'s, and nothing is posted', async () => {
    // UAT acceptance A24 re-test: the store Worker logged "could not save the document … is a link and this host holds
    // no file store", no PUT went, and the bar kept "saved 09:45 AM". Whatever stops the bytes, the page is told.
    const s = new ClanDocumentStore({ wasm: wasmBytes(), persistence: memoryPersistence(), saveDebounceMs: 0, person: MAYA })
    await s.open(fixture())
    const seen: [string, string][] = []
    s.onSaveError((e, where) => seen.push([where, e instanceof Error ? e.message : String(e)]))
    const posted: Uint8Array[] = []
    s.startMirror(async (bytes) => { posted.push(bytes) })
    const host = (s as unknown as { host: { keptBytes?: unknown } }).host
    const proto = Object.getPrototypeOf(host) as { keptBytes?: unknown }
    const kept = proto.keptBytes
    proto.keptBytes = undefined
    try {
      await s.setTitle('Still here')
      await s.flush()
      await expect(s.mirrorNow('manual')).rejects.toThrow(STALE_WASM)
    } finally {
      proto.keptBytes = kept
      s.stopMirror()
    }
    expect(seen.some(([w, m]) => w === 'browser' && m === STALE_WASM)).toBe(true)
    expect(seen.some(([w, m]) => w === 'server' && m === STALE_WASM)).toBe(true)
    expect(posted).toHaveLength(0)
  })

  it('a project that was not spun off says so', async () => {
    const s = store()
    await s.create({ person: MAYA, title: 'Plain', blank: true })
    expect(await s.spunOffFrom()).toBeNull()
  })

  it('keeps the manifest, the carried brief and the carried decisions through open, edit and save', async () => {
    const s = store()
    await s.open(fixture())
    const bus = new LocalPatchBus(s)
    const r = await bus.apply({
      patches: [{ op: 'create', entity: 'keys', id: id('key', 0), value: { key: 'hero', role: 'character' }, base_version: 0 }],
      why: { action: 'name @hero', rationale: 'the lead' },
    })
    expect(r.applied).toBe(true)
    const saved = entries(await s.exportClan())
    const first = entries(fixture())

    // what it carries, and where from
    expect(saved.manifest.lineage.carried).toEqual(first.manifest.lineage.carried)
    expect(saved.manifest.document_id).toBe(first.manifest.document_id)
    expect(saved.manifest.app.app_id).toBe('ie.napkin.production')
    // the brief, frozen
    expect(saved.data.upstream).toEqual(first.data.upstream)
    // every carried decision, pinned, in order, and the spin-off marker
    const carried = (c: typeof first.chain) => c.decisions.filter((d) => d.pinned)
    expect(carried(saved.chain).map((d) => d.action)).toEqual(carried(first.chain).map((d) => d.action))
    expect(saved.chain.decisions.map((d) => d.action)).toContain('name @hero')
    // the spin-off's own address of the source: the first revision's lineage
    expect(first.manifest.lineage.parent_uri).toBe('clan-store:doc-lumen-brief')
  })

  it('a second open and save of the saved bytes changes nothing it carries', async () => {
    const s = store()
    await s.open(fixture())
    const once = await s.exportClan()
    const t = store()
    await t.open(once)
    const twice = await t.exportClan()
    expect(entries(twice).data.upstream).toEqual(entries(once).data.upstream)
    expect(entries(twice).manifest.lineage.carried).toEqual(entries(once).manifest.lineage.carried)
    // not started a second time
    const starts = (await t.chain()).filter((d) => d.action === 'start the project')
    expect(starts).toHaveLength(1)
    expect(MAYA.id).toBeTruthy()
  })
})

// A Brief node made before `source.version` (owner, 2026-11-23: "Migrate once on open"): its document's own schema
// forbids the field, so the version is filled once, when it opens, and saved.
describe('a Brief node from before source.version', () => {
  const BRIEF = 'brief_01K6XA7Q3M9V2D4R8T0B000001'
  const node = (how: 'link' | 'spinoff', version?: number) => ({
    id: BRIEF, v: 1, field_v: {}, title: 'First Light', spine: { proposition: 'Lumen.' },
    source: { document_id: 'doc-first-light', app_id: 'ie.napkin.brief-maker', data_sha256: `sha256:${'b'.repeat(64)}`, taken: 1, ...(version ? { version } : {}), at: '2026-11-20T10:00:00Z', how },
  })
  /** A saved project with one Brief node, written the way an older build did: no version, and a schema that forbids it. */
  async function older(how: 'link' | 'spinoff', version?: number): Promise<Uint8Array> {
    const s = store()
    await s.create({ person: MAYA, title: 'Old', blank: true })
    await s.patch({ briefs: { [BRIEF]: node(how, version ?? 2) } }, { action: 'seed' })
    const z = unzipSync(await s.exportClan())
    if (!version) {
      const data = parseYaml(new TextDecoder().decode(z['shared/data.yaml']))
      delete data.briefs[BRIEF].source.version
      z['shared/data.yaml'] = new TextEncoder().encode(stringifyYaml(data))
      const strip = (o: any): void => {
        if (!o || typeof o !== 'object') return
        if (o.properties?.taken && o.properties?.version) { delete o.properties.version; o.required = o.required.filter((k: string) => k !== 'version') }
        for (const v of Object.values(o)) strip(v)
      }
      const schema = JSON.parse(new TextDecoder().decode(z['agent/output-schema.json']))
      strip(schema)
      z['agent/output-schema.json'] = new TextEncoder().encode(JSON.stringify(schema))
    }
    return zipSync(z)
  }
  const open = (bytes: Uint8Array, briefVersion?: (id: string) => Promise<number | null>, persistence = memoryPersistence()) => {
    const s = new ClanDocumentStore({ wasm: wasmBytes(), persistence, saveDebounceMs: 0, person: MAYA, ...(briefVersion ? { briefVersion } : {}) })
    return { s, persistence, opened: s.open(bytes) }
  }

  it('a linked one gets the linked brief\'s version from Napkin, saved once', async () => {
    const asked: string[] = []
    const { s, persistence, opened } = open(await older('link'), async (id) => { asked.push(id); return 3 })
    const doc = (await opened) as any
    expect(doc.briefs[BRIEF].source.version).toBe(3)
    expect(asked).toEqual(['doc-first-light'])
    expect((await s.chain()).some((d) => d.action === BRIEF_VERSION_ACTION)).toBe(true)
    await s.flush()
    // saved: the next open asks nothing and keeps 3
    const again = new ClanDocumentStore({ wasm: wasmBytes(), persistence, saveDebounceMs: 0, person: MAYA, briefVersion: async () => { throw new Error('asked again') } })
    expect(((await again.load()) as any).briefs[BRIEF].source.version).toBe(3)
  })

  it('a linked one whose brief cannot be read gets 1', async () => {
    const { opened } = open(await older('link'), async () => null)
    expect(((await opened) as any).briefs[BRIEF].source.version).toBe(1)
  })

  it('a spun-off one counts the approves carried in the chain, and asks Napkin nothing', async () => {
    const bytes = await older('spinoff')
    const z = unzipSync(bytes)
    const chain = parseYaml(new TextDecoder().decode(z['agent/decision-chain.yaml'])) as { decisions: Record<string, any>[] }
    // One lock as the host writes it (the bare id: UAT round 4 F24), one as `<id>#`: both count.
    const approve = (n: number) => ({ id: `d_lock${n}`, kind: 'approve', agent: 'human', actor: 'human:u_a', action: 'lock', targets: [n === 1 ? 'doc-first-light' : 'doc-first-light#'], rationale: 'Locked.', timestamp: `2026-11-1${n}T12:00:00Z` })
    chain.decisions = [approve(2), approve(1), ...chain.decisions]
    z['agent/decision-chain.yaml'] = new TextEncoder().encode(stringifyYaml(chain))
    const { opened } = open(zipSync(z), async () => { throw new Error('asked') })
    expect(((await opened) as any).briefs[BRIEF].source.version).toBe(2)
  })

  /** `bytes` with `n` locks of the brief in its chain, as the host writes them (the bare id). */
  const locked = (bytes: Uint8Array, n: number) => {
    const z = unzipSync(bytes)
    const chain = parseYaml(new TextDecoder().decode(z['agent/decision-chain.yaml'])) as { decisions: Record<string, any>[] }
    const approve = (k: number) => ({ id: `d_lock${k}`, kind: 'approve', agent: 'human', actor: 'human:u_a', action: 'lock', targets: ['doc-first-light'], rationale: 'Locked.', timestamp: `2026-11-1${k}T12:00:00Z` })
    chain.decisions = [...Array.from({ length: n }, (_, k) => approve(n - k)), ...chain.decisions]
    z['agent/decision-chain.yaml'] = new TextEncoder().encode(stringifyYaml(chain))
    return zipSync(z)
  }

  it('a spun-off one filled v1 before the fix, with two locks carried, is put right once (UAT round 4 F24)', async () => {
    const { s, opened } = open(locked(await older('spinoff', 1), 2), async () => { throw new Error('asked') })
    expect(((await opened) as any).briefs[BRIEF].source.version).toBe(2)
    expect((await s.chain()).some((d) => d.action === BRIEF_VERSION_ACTION)).toBe(true)
  })

  it('a spun-off one at its carried version, or a linked one (Napkin’s own version), is left as it is', async () => {
    const same = open(locked(await older('spinoff', 2), 2), async () => { throw new Error('asked') })
    expect(((await same.opened) as any).briefs[BRIEF].source.version).toBe(2)
    expect((await same.s.chain()).some((d) => d.action === BRIEF_VERSION_ACTION)).toBe(false)
    const linked = open(locked(await older('link', 1), 2), async () => { throw new Error('asked') })
    expect(((await linked.opened) as any).briefs[BRIEF].source.version).toBe(1)
  })

  it('a document that already has a version is left untouched', async () => {
    const { s, opened } = open(await older('link', 4), async () => { throw new Error('asked') })
    const doc = (await opened) as any
    expect(doc.briefs[BRIEF].source.version).toBe(4)
    expect((await s.chain()).some((d) => d.action === BRIEF_VERSION_ACTION)).toBe(false)
  })
})

/** The bytes a persistence holds now. */
async function persistedBytes(p: ReturnType<typeof memoryPersistence>): Promise<Uint8Array> {
  const saved = await p.read()
  if (!saved) throw new Error('nothing was saved')
  return saved.bytes
}
