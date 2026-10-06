// The UI on the CLAN store: the real napkin-wasm (built by `npm run clan-store`),
// the panels' writes through updateDoc, the chain they leave, and the export
// the real `clan` CLI reads.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { ClanDocumentStore } from '../../../clan-store/src'
import type { DocJob, JobRequest } from '../contracts/types'
import { newId } from '../lib/ulid'
import { makeAjv, SCHEMA } from '../test/schemas'
import { ClanBackedStore } from './clan'
import { describeWrite } from './describe'
import { NO_HISTORY, openDocument } from './open'
import { emptyDocument, updateDoc } from './store'
import type { JobCtx } from './ui'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))
const tmp = mkdtempSync(join(tmpdir(), 'pt-web-clan-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const maya = { id: 'p_maya01', handle: 'maya' }

function hasClanCli(): boolean {
  try {
    execFileSync(process.env.CLAN_BIN || 'clan', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function make(ctx: Record<string, JobCtx> = {}) {
  return new ClanBackedStore(new ClanDocumentStore({ wasm, persistence: null }), { ctxOf: (id) => ctx[id], debounceMs: 5 })
}

function generateJob(state: DocJob['state'] = 'queued'): DocJob {
  return { id: newId('job'), op: 'generate', state, parent_ids: [], input_hashes: [SHA('a')], created_at: '2026-10-07T10:40:00Z' }
}

describe('the UI on the CLAN store', () => {
  const validate = makeAjv().getSchema(SCHEMA('document'))!

  it('panel writes land in the .clan: named ones as entries, bookkeeping without', async () => {
    const ctx: Record<string, JobCtx> = {}
    const s = make(ctx)
    await s.create({ participant: maya })
    const refId = newId('ref')

    // A picture comes in (bookkeeping), then the canvas syncs its refs (an entry).
    void updateDoc(s, (d) => { d.assets.push({ sha256: SHA('a'), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: ['idb://sha256/' + 'a'.repeat(64)] }) }, 'add picture')
    void updateDoc(s, (d) => { d.character.refs.push({ id: refId, asset: SHA('a'), tag: 'ref_a', role: 'other', kind: 'picture' }) }, 'sync refs')
    // Two writes in a row both see the one before (the memory copy is current).
    expect(s.get().character.refs).toHaveLength(1)
    expect(s.get().assets).toHaveLength(1)

    // Generate: the runner writes the job at submit.
    const job = generateJob()
    ctx[job.id] = { for: 'canvas', request: { contractVersion: '1', jobId: job.id, op: 'generate', parentIds: [], input: { refs: [{ id: refId, tag: 'ref_a', role: 'other', asset: { sha256: SHA('a'), url: 'https://x.invalid/a', mime: 'image/png' } }] } } as JobRequest }
    void updateDoc(s, (d) => { d.jobs.push(job) }, 'submit generate')
    // Polls: bookkeeping.
    void updateDoc(s, (d) => { d.jobs[0].state = 'submitted' })
    void updateDoc(s, (d) => { d.jobs[0].state = 'fetching' })
    // The provider finishes, with the director's block.
    void updateDoc(s, (d) => {
      d.assets.push({ sha256: SHA('b'), kind: 'image', mime: 'image/png', origin: 'generated', job_id: job.id, locations: ['https://x.invalid/b'] })
      Object.assign(d.jobs[0], {
        state: 'completed', outputs: [SHA('b')], provider: 'runway', model: 'gen4_image', updated_at: '2026-10-07T10:40:41Z',
        cost: { estimate: 0.08, confirmed: 0.07, currency: 'USD', unknown: false },
        agent: { model: 'claude-sonnet-4-5', promptVersion: 'director.v1', rationale: 'The sketch sets the pose.', output: { op: 'generate', providerJob: { provider: 'runway', prompt: '@ref_a, front view', refs: [{ sha256: SHA('a'), name: 'ref_a', role: 'character' }] }, needsUser: null, rationale: 'x', confidence: 0.9 } },
      })
    }, 'complete generate')
    void updateDoc(s, (d) => { d.character.views.front = { asset: SHA('b'), job_id: job.id, picked_at: '2026-10-07T10:41:00Z' } }, 'pick front')
    void updateDoc(s, (d) => { d.character.locked = true; d.character.locked_at = '2026-10-07T10:42:00Z'; d.stage = { current: 'storyboard' } }, 'lock character')

    const chain = await s.chain()
    const mine = chain.filter((e) => e.agent === 'maya').map((e) => e.action)
    expect(mine).toEqual(['locked the character', 'picked as Front', 'generated a front view', 'added a picture as @ref_a', 'started the document'])
    const gen = chain.find((e) => e.action === 'generated a front view')!
    expect(gen.rationale).toContain('from @ref_a')
    expect(gen.rationale).toContain(job.id)
    expect(chain.find((e) => e.action === 'locked the character')!.pinned).toBe(true)

    const director = chain.find((e) => e.agent === 'director · claude-sonnet-4-5 · director.v1')!
    expect(director.action).toBe(`directed generate ${job.id}`)
    expect(director.rationale).toContain('prompt: "@ref_a, front view"')
    const provider = chain.find((e) => e.agent === 'runway · gen4_image')!
    expect(provider.action).toBe(`made generate ${job.id}`)
    expect(provider.rationale).toContain('cost $0.07 confirmed')
    expect(provider.rationale).toContain(SHA('b'))

    // Once per job, however often it is seen again.
    void updateDoc(s, (d) => { d.stage.next_action = 'Write a script.' })
    expect((await s.chain()).filter((e) => e.action.endsWith(job.id))).toHaveLength(2)

    // The memory copy and the .clan agree, and both match the contract.
    expect(s.clan.get()).toEqual(JSON.parse(JSON.stringify(s.get())))
    expect(validate(s.get()), JSON.stringify(validate.errors)).toBe(true)

    // After a reload (reopen the bytes), the job is not recorded twice.
    const again = make()
    await again.clan.open(await s.exportClan())
    await again.load().catch(() => null)
    const reopened = new ClanBackedStore(again.clan, { debounceMs: 5 })
    await reopened.load()
    expect((await reopened.chain()).filter((e) => e.action.endsWith(job.id))).toHaveLength(2)

    if (hasClanCli()) {
      const file = join(tmp, 'maya.clan')
      writeFileSync(file, await s.exportClan())
      const read = execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', 'read', 'chain', file], { encoding: 'utf8' })
      expect(read).toContain('picked as Front')
      expect(read).toContain('director · claude-sonnet-4-5 · director.v1')
      expect(read).toContain('runway · gen4_image')
      const ok = execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', 'validate', '--strict', file], { encoding: 'utf8' })
      expect(ok).toMatch(/^OK$/m)
    }
  })

  it('typing into a shot folds into one entry', async () => {
    const s = make()
    await s.create({ participant: maya })
    const shot = { id: newId('shot'), order: 1, duration_s: 5, composition: 'medium' as const, action: '', camera_move: 'static' as const, lead_view: 'front' as const, status: 'planned' as const }
    void updateDoc(s, (d) => { d.shots = [shot, { ...shot, id: newId('shot'), order: 2 }] }, 'add shot')
    for (const text of ['A', 'A m', 'A ma', 'A man runs']) void updateDoc(s, (d) => { d.shots![0].action = text }, 'edit shot')
    const chain = await s.chain()
    expect(chain.filter((e) => e.action === 'edited shot 1')).toHaveLength(1)
    expect(chain[0].rationale).toContain('A man runs')
  })

  it('a write the contract refuses is undone and reported', async () => {
    const s = make()
    await s.create({ participant: maya })
    const seen: string[] = []
    s.onTrouble((m) => seen.push(m))
    void updateDoc(s, (d) => { (d.stage as { current: string }).current = 'editing' }, 'stage')
    await s.flush()
    expect(seen[0]).toMatch(/document.schema.json/)
    expect(s.get().stage.current).toBe('character')
  })

  it('falls back to the JSON store, with a visible note, when the wasm does not load', async () => {
    const opened = await openDocument(maya, () => undefined, () => { throw new Error('no wasm') })
    expect(opened.clan).toBeNull()
    expect(opened.storeNote).toBe(NO_HISTORY)
    expect(opened.storeNote).toMatch(/^Saving without history/)
    expect(opened.doc.get().participant).toEqual(maya)
  })

  it('opens the CLAN store when it loads', async () => {
    const opened = await openDocument(maya, () => undefined, () => make())
    expect(opened.clan).not.toBeNull()
    expect(opened.storeNote).toBeNull()
    expect((await opened.clan!.chain()).map((e) => e.action)).toContain('started the document')
  })
})

describe('describeWrite', () => {
  it('keeps bookkeeping out of the chain', () => {
    const d = emptyDocument(maya)
    for (const a of ['edit', 'stage', 'add picture', 'complete generate', 'frame', 'take', 'shot list']) expect(describeWrite(a, d, d)).toBeNull()
  })

  it('names refs added, retagged, re-roled and deleted', () => {
    const a = emptyDocument(maya)
    const b = structuredClone(a)
    b.character.refs.push({ id: 'ref_01K6XA7Q3M9V2D4R8T0B000001', asset: SHA('a'), tag: 'eyes', role: 'other', kind: 'sketch' })
    expect(describeWrite('sync refs', a, b)!.action).toBe('added a drawing as @eyes')
    const c = structuredClone(b)
    c.character.refs[0].role = 'shape'
    expect(describeWrite('sync refs', b, c)!.action).toBe('set @eyes as shape')
    expect(describeWrite('sync refs', c, a)!.action).toBe('deleted ref @eyes')
  })
})
