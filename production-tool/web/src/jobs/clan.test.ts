// The crew's landings on the CLAN store (the real napkin-wasm behind clan-store's buses):
// Dex's plan is ONE undo step and ONE decision by dex citing the job; Wren's take is the
// shot's pick in the cut, landed by wren; a person's shot edit and the mark it makes are one
// undo step (typing folds into it).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ClanDocumentStore } from '../../../clan-store/src'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { edlItemFor, jobsList, scenesOf, shotsOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { addScene, MAYA } from '../test/jobFixtures'
import { makeClip } from './clips'
import { drawFrame, selectedFrame, type FrameDeps } from './frames'
import { planShots } from './plan'
import { JobRunner } from './runner'
import { frameStale } from './stale'
import { wireJobs } from './wire'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

const SCRIPT = 'A razor rests on a marble sink. A hand picks it up slowly. The blade glides along a jaw.'

async function setup() {
  let t = 1_000_000
  let renders = 0
  const renderer: MockRenderer = {
    async render(req) {
      renders++
      const mime = req.op === 'clip' || req.op === 'stitch' ? 'video/mp4' : 'image/png'
      return [{ blob: new Blob([`${req.op}-${renders}-${Math.random()}`], { type: mime }), mime, w: 9, h: 16, ...(mime === 'video/mp4' ? { durationS: 5 } : {}) }]
    },
  }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const store = new ModelStore(new ClanDocumentStore({ wasm, persistence: null, person: MAYA }), { debounceMs: 5 })
  await store.create(MAYA, 'Razor')
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, store, ui)
  const deps: FrameDeps = { relay, doc: store, ui, runner }
  wireJobs(deps)
  await updateDoc(store, (d) => { addScene(d, SCRIPT, 'INT. BATHROOM - DAY') }, 'set')
  await store.flush()
  const land = async () => {
    t += 5000
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
    await store.flush()
  }
  /** Dex's plan, landed. */
  const plan = async () => {
    const id = await planShots(deps)
    await land()
    await vi.waitFor(() => expect(shotsOf(store.get()).length).toBeGreaterThan(0), { timeout: 4000, interval: 10 })
    await store.flush()
    return id
  }
  const shotId = (i: number) => shotsOf(store.get())[i].id
  const landed = (match: (action: string) => boolean) => store.chain().then((c) => c.filter((e) => match(e.action)))
  return { store, ui, runner, deps, land, plan, shotId, landed }
}

describe('the crew\'s landings on the CLAN store', () => {
  it('Dex\'s plan moves the script into the shots as one undo step and one decision by dex citing the job', async () => {
    const s = await setup()
    const jobId = await s.plan()
    const d = s.store.get()
    const shots = shotsOf(d)
    expect(shots.map((x) => x.action)).toEqual(['A razor rests on a marble sink.', 'A hand picks it up slowly.', 'The blade glides along a jaw.'])
    const scene = scenesOf(d)[0]
    for (const x of shots) expect(x).toMatchObject({ last_writer: 'dex', status: 'planned', scene_id: scene.id, kind: 'shot' })
    expect(scene.text ?? '').toBe('') // the words moved: one owner per span
    expect(Object.values(d.beats).filter((b) => b.shot_id === shots[0].id)).toHaveLength(1)

    const docId = s.store.documentId()
    const byDex = (await s.store.chain()).filter((e) => e.agent === 'dex')
    expect(byDex).toHaveLength(1)
    expect(byDex[0].action).toBe('plan 3 shots for the storyboard')
    expect(byDex[0].cites).toEqual([`${docId}#jobs[${jobId}]`])
    expect(byDex[0].rationale).toMatch(/mock on mock/)

    expect(s.store.undoLabels().undo).toBe('plan 3 shots for the storyboard')
    await s.store.undo()
    const back = s.store.get()
    expect(shotsOf(back)).toEqual([])
    expect(Object.keys(back.beats)).toEqual([])
    expect(scenesOf(back)[0].text).toBe(SCRIPT) // the words are back in the scene, in one step
    expect(back.jobs[jobId].state).toBe('completed') // the job's own bookkeeping is no one's undo
  })

  it('a re-plan keeps the shots a person wrote last and updates the rest by id', async () => {
    const s = await setup()
    await s.plan()
    const [first, second] = [s.shotId(0), s.shotId(1)]
    await updateDoc(s.store, (d) => { d.shots[first].action = 'A razor, close, on wet marble.' }, 'edit shot')
    await s.store.flush()
    expect(s.store.get().shots[first].last_writer).toBe('human:p_test01')
    await s.plan()
    const d = s.store.get()
    expect(shotsOf(d).map((x) => x.id).slice(0, 3)).toEqual([first, second, s.shotId(2)])
    expect(d.shots[first].action).toBe('A razor, close, on wet marble.') // the person's words stay
    expect(d.shots[second].last_writer).toBe('dex')
  })

  it('Wren\'s take is the shot\'s pick in the cut, landed by wren citing the job', async () => {
    const s = await setup()
    await s.plan()
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    await vi.waitFor(() => expect(selectedFrame(s.store.get(), s.shotId(0))).toBeDefined(), { timeout: 4000, interval: 10 })
    const clipJob = await makeClip(s.deps, s.shotId(0))
    await s.land()
    await vi.waitFor(() => expect(edlItemFor(s.store.get(), s.shotId(0))?.pick).toBeDefined(), { timeout: 4000, interval: 10 })
    await s.store.flush()
    const d = s.store.get()
    const item = edlItemFor(d, s.shotId(0))!
    const take = d.takes[item.pick!.current]
    expect(take).toMatchObject({ shot_id: s.shotId(0), job_id: clipJob, crew: 'wren', version: 1 })
    const entries = await s.landed((a) => a.startsWith('render take'))
    expect(entries).toEqual([expect.objectContaining({ agent: 'wren', action: 'render take v1 for shot 1', cites: [`${s.store.documentId()}#jobs[${clipJob}]`] })])
    const frames = await s.landed((a) => a.startsWith('render frame'))
    expect(frames).toEqual([expect.objectContaining({ agent: 'wren', action: 'render frame v1 for shot 1' })])
    expect(s.store.undoLabels().undo).not.toMatch(/^render/) // a landing is no one's undo step
    expect(jobsList(d).every((j) => j.started_by === 'human:p_local')).toBe(true)
  })

  it('undoing a shot edit takes its mark back with it; typing is one step', async () => {
    const s = await setup()
    await s.plan()
    for (const i of [0, 1]) {
      await drawFrame(s.deps, i, i === 0 ? 'first' : 'next')
      await s.land()
      await vi.waitFor(() => expect(selectedFrame(s.store.get(), s.shotId(i))).toBeDefined(), { timeout: 4000, interval: 10 })
    }
    const id = s.shotId(1)
    const words = s.store.get().shots[id].action
    const { editShot } = await import('./stale')
    for (const text of ['B', 'Be', 'Bea']) await updateDoc(s.store, (d) => editShot(d, id, { action: text }), 'edit shot')
    await s.store.flush()
    expect(s.store.get().shots[id].action).toBe('Bea')
    expect(frameStale(s.store.get(), id)?.reason).toBe("Shot 2's words changed")
    expect(s.store.undoLabels().undo).toBe('set shot 2')
    await s.store.undo()
    expect(s.store.get().shots[id].action).toBe(words)
    expect(Object.values(s.store.get().stale)).toEqual([])
    await s.store.redo()
    expect(s.store.get().shots[id].action).toBe('Bea')
    expect(frameStale(s.store.get(), id)?.reason).toBe("Shot 2's words changed")
  })
})
