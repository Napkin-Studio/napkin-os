// Spec 3.20's sequence (artboard 15), written through LocalPatchBus on the real
// napkin-wasm, then read back as a tree from /chain: Skye's draft kept, Dex's
// plan, Fin's v1, Jude's flag, the ask answered, v2, Rhea's v3, Jude passes,
// Keep both (pinned), then restore v2.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ClanDocumentStore, keepSuggestion, landPlan, LocalPatchBus, LocalTextBus, LocalUndo, proseFromLines, proseHash, ranksBetween,
} from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { lineage } from './lineage'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let n = 0
const id = (prefix: string) => {
  let x = ++n
  let tail = ''
  for (let i = 0; i < 6; i++) { tail = CROCKFORD[x % 32] + tail; x = Math.floor(x / 32) }
  return `${prefix}_01K7D00000000000000000${tail.slice(2)}`
}
const sha = (c: string) => `sha256:${c.repeat(64)}`
const TENANT = '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f'
const MAYA = { id: 'p_maya001', handle: 'maya', tenant_id: TENANT }
const ME = 'human:p_maya001'

describe('the decision tree from /chain (spec 3.20)', () => {
  it('rebuilds artboard 15\'s tree, counts each Kind, reaches every node by target, and restores as a new decision', async () => {
    const store = new ClanDocumentStore({ wasm, persistence: null, person: MAYA, newId: id })
    await store.create({ person: MAYA, title: 'Lumen' })
    const bus = new LocalPatchBus(store)
    const text = new LocalTextBus(bus)
    const undo = new LocalUndo()
    undo.bind(bus, text)
    const doc = () => bus.doc() as unknown as ProductionDocument
    const docId = store.documentId()
    const script = Object.keys(doc().scripts)[0]
    const storyboard = Object.keys(doc().storyboards)[0]
    const job = (op: string, crew: string, node: { kind: string; id: string }, extra: Record<string, unknown> = {}) => {
      const jid = id('job')
      return { id: jid, patch: { op: 'create' as const, entity: 'jobs' as const, id: jid, base_version: 0, value: {
        op, state: 'completed', node, started_by: ME, tenant_id: TENANT, nonce: `n_${jid.slice(-10)}`, crew, parent_ids: [], input_hashes: [],
        created_at: '2026-10-13T10:00:00Z', ...extra } } }
    }
    const asset = (c: string) => ({ op: 'create' as const, entity: 'assets' as const, id: sha(c), base_version: 0,
      value: { sha256: sha(c), kind: 'image', mime: 'image/png', origin: 'generated', locations: [`idb://sha256/${c.repeat(64)}`] } })

    // 1. The script line, and Skye's draft of it, which Maya keeps.
    const scene = id('scene')
    await bus.apply({ patches: [{ op: 'create', entity: 'scenes', id: scene, base_version: 0, value: { script_id: script, rank: 'a0', heading: 'INT. KITCHEN' } }], why: { action: 'create scenes[scene 1]' } })
    await text.replace('scene', scene, proseFromLines('action', ['The bottle.']), ME)
    const write = job('write', 'skye', { kind: 'script', id: script })
    const sug = id('sug')
    await bus.apply({ patches: [write.patch, { op: 'create', entity: 'suggestions', id: sug, base_version: 0, value: {
      target: { kind: 'scene', id: scene }, crew: 'skye', job_id: write.id, for: ME, base_hash: await proseHash(text.prose('scene', scene)),
      proposed: { prose: proseFromLines('action', ['The bottle opens; the fizz rises.']), text: 'The bottle opens; the fizz rises.' }, note: 'A product moment.', state: 'open' } }],
    why: { action: 'write a draft of the line', agent: 'skye', cites: [`${docId}#jobs[${write.id}]`] } })
    await keepSuggestion(bus, text, sug)

    // 2. Dex plans shot 3 from the line.
    const plan = job('shot_list', 'dex', { kind: 'storyboard', id: storyboard })
    await bus.apply({ patches: [plan.patch], why: { action: 'start plan', quiet: true } }, { undo: false })
    const shot = id('shot')
    await landPlan(bus, text, {
      scenes: [{ id: scene, remainder: { type: 'doc', content: [] } }],
      shots: [{ id: shot, value: { storyboard_id: storyboard, rank: ranksBetween(null, null, 1)[0], kind: 'shot', scene_id: scene, duration_s: 2,
        camera: { size: 'insert', angle: 'high_angle', movement: 'static', lens_mm: 100, macro: true }, status: 'planned' },
      prose: proseFromLines('action', ['The bottle opens; the fizz rises.']) }],
    }, { action: 'plan shots[shot 3]', agent: 'dex', cites: [`${docId}#jobs[${plan.id}]`], rationale: 'An insert on the bottle: the fizz is the product moment.' })

    // 3. Fin films v1.
    const frame = async (version: number, crew: string, kind: string, c: string, parent?: string) => {
      const j = job(kind === 'edited' ? 'cutout' : 'frame', crew, { kind: 'shot', id: shot })
      const fid = id('frame')
      await bus.apply({ patches: [j.patch, asset(c), { op: 'create', entity: 'frames', id: fid, base_version: 0, value: {
        shot_id: shot, version, kind, asset: sha(c), job_id: j.id, crew, ...(parent ? { parent_id: parent } : {}) } },
      { op: 'set', entity: 'shots', id: shot, path: 'pick/current', value: fid, base_version: doc().shots[shot].v }],
      why: { action: `${crew === 'rhea' ? 'retouch' : 'render'} frames[v${version}] for shot 3`, agent: crew, cites: [`${docId}#jobs[${j.id}]`] } })
      return fid
    }
    const v1 = await frame(1, 'wren', 'generated', '1')

    // 4. Jude's check flags it.
    const check = async (target: string, result: 'pass' | 'flag', reason: string) => {
      const cid = id('check')
      await bus.apply({ patches: [{ op: 'create', entity: 'checks', id: cid, base_version: 0, value: {
        target: { kind: 'frame', id: target }, crew: 'jude', result, reason_code: reason, note: `${result} · ${reason}` } }],
      why: { action: `check frames[${target}]: ${result}`, agent: 'jude' } })
    }
    await check(v1, 'flag', 'logo_clear_space')

    // 5. Dex asks "Bigger how?"; Maya answers Camera.
    const q = `q_${id('x').slice(2)}`
    const askJob = job('frame_edit', 'dex', { kind: 'shot', id: shot }, { state: 'needs_input' })
    await bus.apply({ patches: [askJob.patch, { op: 'create', entity: 'asks', id: q, base_version: 0, value: {
      question: { id: q, kind: 'ambiguity', text: 'Bigger how?', options: [{ id: 'camera', label: 'Move the camera in', value: 'camera' }, { id: 'local', label: 'Make it bigger', value: 'local' },
        { id: 'both', label: 'Both', value: 'both' }], allow_text: false },
      node: { kind: 'shot', id: shot }, job_id: askJob.id, crew: 'dex', state: 'open', answers: [] } }],
    why: { action: 'ask Bigger how?', agent: 'dex', cites: [`${docId}#jobs[${askJob.id}]`] } }, { undo: false })
    await bus.apply({ patches: [
      { op: 'set', entity: 'asks', id: q, path: 'answers', value: [{ option_id: 'camera', by: ME, at: '2026-10-13T10:05:00Z' }], base_version: 1 },
      { op: 'set', entity: 'asks', id: q, path: 'state', value: 'answered', base_version: 1 },
    ], why: { action: 'answer Bigger how?: Move the camera in' } }, { undo: false })

    // 6-8. Fin's v2, Rhea's v3 (patched), and Jude passes v3.
    const v2 = await frame(2, 'wren', 'generated', '2', v1)
    const v3 = await frame(3, 'rhea', 'edited', '3', v2)
    await check(v3, 'pass', 'logo_clear_space')

    // 9. Keep both: v3 in the cut, v2 kept beside it; pinned.
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'pick/alternates', value: [v2], base_version: doc().shots[shot].v }],
      why: { action: 'keep_both frames v3 and v2 in shot 3', pinned: true } })

    // 10. Restore v2: a new pick decision, citing v2, marking what v3 fed as out of date, in one batch.
    const take = id('take')
    const stale = id('stale')
    const restore = await bus.apply({ patches: [
      { op: 'set', entity: 'shots', id: shot, path: 'pick/current', value: v2, base_version: doc().shots[shot].v },
      { op: 'set', entity: 'shots', id: shot, path: 'pick/alternates', value: [v3], base_version: doc().shots[shot].v },
      { op: 'create', entity: 'stale', id: stale, base_version: 0, value: { target: { kind: 'take', id: take }, caused_by: { kind: 'frame', id: v2 }, reason: 'frame 3 restored to v2' } },
    ], why: { action: 'restore frames v2 in shot 3', cites: [`${docId}#frames[${v2}]`] } })
    expect(restore.applied).toBe(true)

    // Pin the plan after the fact.
    const chain0 = await store.chain()
    const planEntry = chain0.find((e) => e.action.startsWith('plan '))!
    await store.record({ action: 'pin_decision', cites: [planEntry.id!] })

    const tree = lineage(await store.chain(), doc(), docId)
    const by = (verbStart: string) => tree.nodes.filter((x) => x.action.startsWith(verbStart))

    // The expected tree: the frame chain v1 → v2 → v3 under the shot's plan, each check under its frame.
    const [planNode] = by('plan ')
    const v1Node = tree.nodes.find((x) => x.action.startsWith('render frames[v1]'))!
    const v2Node = tree.nodes.find((x) => x.action.startsWith('render frames[v2]'))!
    const v3Node = tree.nodes.find((x) => x.action.startsWith('retouch frames[v3]'))!
    expect(v1Node.parent).toBe(planNode.id)
    expect(v2Node.parent).toBe(v1Node.id)
    expect([v1Node.version, v2Node.version, v3Node.version]).toEqual(['v1', 'v2', 'v3'])
    expect(v3Node.parent).toBe(v2Node.id)
    const [flag, pass] = by('check ')
    expect(flag.parent).toBe(v1Node.id)
    expect(pass.parent).toBe(v3Node.id)
    expect(flag.actor).toBe('crew')
    // Skye's draft and Maya's Keep are about the scene; Dex's plan follows them.
    const kept = by('keep_suggestion')[0]
    expect(kept.agent).toBe(ME)
    expect(tree.byId.get(planNode.parent!)?.entities.some((e) => e.includes(scene))).toBe(true)

    // The Kind counts (Decisions, Checks, Asks, Picks).
    expect(tree.counts.check).toBe(2)
    expect(tree.counts.ask).toBe(2) // the ask and its answer
    expect(tree.counts.pick).toBe(2) // keep both and restore
    expect(tree.counts.decision).toBe(tree.nodes.length - 6)

    // Every node is reachable by a target, and every frame by its own address.
    for (const node of tree.nodes.filter((x) => x.verb !== 'pin_decision')) expect([node.action, node.entities.length > 0]).toEqual([node.action, true])
    for (const f of [v1, v2, v3]) expect(tree.about(`${docId}#frames[${f}]`).length).toBeGreaterThan(0)
    expect(tree.about(`${docId}#shots[${shot}]`).map((x) => x.verb)).toEqual(expect.arrayContaining(['plan', 'render', 'retouch', 'keep_both', 'restore']))

    // Keep both is pinned; the plan is pinned after the fact (a new decision, not an edit).
    expect(by('keep_both')[0].pinned).toBe(true)
    expect(planNode.pinned).toBe(true)
    expect(by('pin_decision')[0].cites).toEqual([planNode.id])

    // The restore is a new decision citing v2, and its batch wrote the stale mark; history kept every version.
    const restoreNode = by('restore')[0]
    expect(restoreNode.kind).toBe('pick')
    expect(restoreNode.cites).toEqual([`${docId}#frames[${v2}]`])
    expect(restoreNode.entities).toEqual(expect.arrayContaining([`${docId}#shots[${shot}]`, `${docId}#stale[${stale}]`]))
    expect(doc().shots[shot].pick).toEqual({ current: v2, alternates: [v3] })
    expect(Object.keys(doc().frames)).toEqual(expect.arrayContaining([v1, v2, v3]))
    // ... and it is one undo step.
    expect(undo.peek()).toBe('restore frames v2 in shot 3')
  })
})
