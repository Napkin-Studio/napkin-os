import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DocJob, Job, ProductionDocument, Shot } from '../contracts/types'
import { landUpdate, SnapshotStore, systemUpdate, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { putBlob } from '../lib/blobs'
import { currentFrame, framesOf, shotsOf, staleList } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { MockRelay, mockShotList, type MockRenderer } from '../relay/mock'
import { addKey, addRef, addScene, addShots as planShots, snapshotDoc } from '../test/jobFixtures'
import { addFrame, addShots, addTake, job, MAYA, modelStore, SHA } from '../test/model'
import {
  applyClipLine, applyFrameEdit, applyFrameEditStep, cameraDiff, changeFrame, discard, discardStep, frameEditCopy, frameEditLines,
  frameEditOf, keepBoth, keepBothStep, landFrameEdit, proposalOf,
} from './frameEdit'
import { mockFrameEdit, readingOf } from './frameWords'
import { drawFrame, type FrameDeps } from './frames'
import { JobRunner } from './runner'
import { wireJobs } from './wire'

// Change this frame (ui-behaviour 3.11, features/frame-change-edit.clan): the pure pieces the editors mount.

const here = dirname(fileURLToPath(import.meta.url))
const SPEC = readFileSync(join(here, '..', '..', '..', '..', 'docs', 'production-tool', 'ui-behaviour.md'), 'utf8')
const CAMERA = { size: 'close', angle: 'eye_level', movement: 'static', lens_mm: 35 } as Shot['camera']

describe('the words', () => {
  it('match ui-behaviour 3.11 word for word', () => {
    for (const s of [frameEditCopy.reading.camera, frameEditCopy.passthrough, frameEditCopy.applyMarksClip(4), frameEditCopy.stay(['movement', 'lens']),
      frameEditCopy.newVersion(2), 'Bigger how?']) expect(SPEC).toContain(s)
    expect(frameEditCopy.stay(['movement', 'lens'])).toBe('Movement and lens stay')
    for (const b of [frameEditCopy.apply, frameEditCopy.keepBoth, frameEditCopy.discard, frameEditCopy.redo]) expect(SPEC).toContain(`**${b}**`)
    expect(frameEditCopy.maskUnused).toBe('A camera change redraws the whole frame, so the area you marked was not used.')
  })
  it('never name a price', () => {
    const all = JSON.stringify(frameEditCopy) + frameEditCopy.applyMarksClip(4) + frameEditCopy.stay(['size'])
    expect(all).not.toMatch(/\$|cost|price/i)
  })
})

describe('cameraDiff', () => {
  it('gives a row per changed field, in chip labels, and the chips that stay', () => {
    const { rows, stay } = cameraDiff(CAMERA, { angle: 'overhead', size: 'wide' })
    expect(rows.map((r) => r.line)).toEqual(['size: close → wide', 'angle: eye level → overhead'])
    expect(stay).toBe('Movement and lens stay')
  })
  it('ignores a leaf that keeps its value, and names a lens in mm', () => {
    const { rows, stay } = cameraDiff(CAMERA, { size: 'close', lens_mm: 100, movement: 'push_in', movement_speed: 'slow' })
    expect(rows.map((r) => r.line)).toEqual(['movement: static → push in', 'speed: none → slow', 'lens: 35 mm → 100 mm'])
    expect(stay).toBe('Size and angle stay')
  })
  it('says nothing stays when every chip changes', () => {
    expect(cameraDiff(CAMERA, { size: 'wide', angle: 'low_angle', movement: 'pan', lens_mm: 24 }).stay).toBeUndefined()
  })
})

describe('the lines under the result', () => {
  const jobWith = (frameEdit: object, model = 'eu.anthropic.claude-sonnet-5-5') =>
    ({ director: { model, promptVersion: 'director.v7', rationale: '', output: { frameEdit } } }) as Pick<Job, 'director'>
  it('always name the reading, and say when the words went as they are or the mask was not used', () => {
    expect(frameEditLines(jobWith({ reading: 'camera', runAs: 'frame' }))).toEqual(['Dex read this as a camera change'])
    expect(frameEditLines(jobWith({ reading: 'local', runAs: 'frame', words_as_given: true }, 'passthrough')))
      .toEqual(['Dex read this as a local change', 'Dex sent your words as they are.'])
    expect(frameEditLines(jobWith({ reading: 'camera', runAs: 'frame', maskUnused: true }))).toContain(frameEditCopy.maskUnused)
  })
})

// ── the mutations, on the real document store ─────────────────────────────────────────────

interface World { s: ModelStore; shot: Shot; v1: string; take: string; fe: DocJob }

async function world(frameEdit: object, opts: { clip?: boolean; picture?: boolean } = {}): Promise<World> {
  const s = modelStore()
  await s.create(MAYA, 'Change this frame')
  let w: Omit<World, 's'> | undefined
  await systemUpdate(s, (d) => {
    const [shot] = addShots(d, 1, { camera: { ...CAMERA } })
    const first = job(d, 'frame', [], SHA('a'), { node: { kind: 'shot', id: shot.id } })
    d.jobs[first.id] = first
    const v1 = addFrame(d, shot, SHA('a'), { pick: true, job: first })
    let take = ''
    if (opts.clip !== false) {
      const clip = job(d, 'clip', [SHA('a')], SHA('c'), { node: { kind: 'shot', id: shot.id } })
      d.jobs[clip.id] = clip
      take = addTake(d, shot, SHA('c'), clip, { pick: true }).id
    }
    const fe = job(d, 'frame_edit', [SHA('a')], opts.picture === false ? null : SHA('b'), {
      crew: 'dex', node: { kind: 'shot', id: shot.id },
      director: { model: 'eu.anthropic.claude-sonnet-5-5', promptVersion: 'director.v7', rationale: 'camera', output: { op: 'frame_edit', frameEdit } },
    })
    d.jobs[fe.id] = fe
    w = { shot: d.shots[shot.id], v1: v1.id, take, fe }
  })
  const { shot, v1, fe } = w!
  if (opts.picture !== false) {
    await landUpdate(s, (d) => {
      landFrameEdit(d, { jobId: fe.id, outputs: [{ sha256: SHA('b'), url: 'https://x.test/b', mime: 'image/png' }], crew: 'dex', op: 'frame_edit', director: fe.director } as Job,
        { shotId: shot.id, parentFrameId: v1 })
    }, { action: 'render frame v2', agent: 'dex' })
  }
  await s.flush()
  return { s, ...w! }
}

const marksOn = (d: ProductionDocument, kind: string, id: string) => staleList(d).filter((m) => m.target.kind === kind && m.target.id === id)

describe('landFrameEdit', () => {
  it('lands the new version unpicked, as an edit of the frame, once only', async () => {
    const w = await world({ reading: 'camera', runAs: 'frame', camera: { angle: 'overhead' } })
    const d = w.s.get()
    const p = proposalOf(d, w.fe.id)!
    expect(p).toMatchObject({ kind: 'edited', version: 2, parent_id: w.v1, crew: 'dex', edits: [{ op: 'frame_edit', params: { reading: 'camera', camera: { angle: 'overhead' } } }] })
    expect(d.shots[w.shot.id].pick?.current).toBe(w.v1)
    expect(d.shots[w.shot.id].pick?.alternates ?? []).toEqual([])
    let again
    await landUpdate(w.s, (x) => { again = landFrameEdit(x, { jobId: w.fe.id, outputs: [{ sha256: SHA('b'), url: '', mime: 'image/png' }] } as unknown as Job, { shotId: w.shot.id }) },
      { action: 'render', agent: 'dex' })
    expect(again).toBeUndefined()
    expect(framesOf(w.s.get(), w.shot.id)).toHaveLength(2)
  })
})

describe('applyFrameEdit', () => {
  it('a camera change: fields, then the new frame picked with no mark; the clip is said to be behind it, never marked', async () => {
    const w = await world({ reading: 'camera', runAs: 'frame', camera: { angle: 'overhead', size: 'wide' } })
    let applied
    await updateDoc(w.s, (d) => { applied = applyFrameEdit(d, w.fe.id, w.shot.id) }, 'apply')
    const d = w.s.get()
    const p = proposalOf(d, w.fe.id)!
    expect(applied).toMatchObject({ frameId: p.id, fields: ['camera/size', 'camera/angle'], clipStale: true })
    expect(d.shots[w.shot.id].camera).toEqual({ ...CAMERA, angle: 'overhead', size: 'wide' })
    expect(currentFrame(d, w.shot.id)?.id).toBe(p.id)
    expect(marksOn(d, 'frame', p.id)).toEqual([])
    expect(marksOn(d, 'generation', w.take)).toEqual([]) // takes are never marked (features/make-and-edit.clan)
  })

  it('movement only: the fields change for the next take; nothing is marked, no frame changes', async () => {
    const w = await world({ reading: 'camera', runAs: 'none', camera: { movement: 'push_in', movement_speed: 'slow' } }, { picture: false })
    await updateDoc(w.s, (d) => { applyFrameEdit(d, w.fe.id, w.shot.id) }, 'apply')
    const d = w.s.get()
    expect(d.shots[w.shot.id].camera).toMatchObject({ movement: 'push_in', movement_speed: 'slow', size: 'close' })
    expect(currentFrame(d, w.shot.id)?.id).toBe(w.v1)
    expect(marksOn(d, 'frame', w.v1)).toEqual([])
    expect(marksOn(d, 'generation', w.take)).toEqual([])
  })

  it('both: the camera fields and the new frame, as one change', async () => {
    const w = await world({ reading: 'both', runAs: 'frame', camera: { size: 'medium' } })
    await updateDoc(w.s, (d) => { applyFrameEdit(d, w.fe.id, w.shot.id) }, 'apply')
    const d = w.s.get()
    expect(d.shots[w.shot.id].camera.size).toBe('medium')
    expect(currentFrame(d, w.shot.id)?.id).toBe(proposalOf(d, w.fe.id)!.id)
  })

  it('a local change writes no field; a shot with no clip has no clip line', async () => {
    const w = await world({ reading: 'local', runAs: 'frame' }, { clip: false })
    expect(applyClipLine(w.s.get(), w.shot.id)).toBeUndefined()
    let applied
    await updateDoc(w.s, (d) => { applied = applyFrameEdit(d, w.fe.id, w.shot.id) }, 'apply')
    expect(applied).toMatchObject({ fields: [], clipStale: false })
    expect(w.s.get().shots[w.shot.id].camera).toEqual(CAMERA)
  })

  it('is one undo step', async () => {
    const w = await world({ reading: 'camera', runAs: 'frame', camera: { angle: 'overhead' } })
    expect(applyClipLine(w.s.get(), w.shot.id)).toBe('Apply puts clip 1 out of date')
    const before = staleList(w.s.get()).length
    await applyFrameEditStep(w.s, w.fe.id, w.shot.id)
    await w.s.flush()
    expect(w.s.undoLabels().undo).toMatch(/^apply frame change/)
    await w.s.undo()
    await w.s.flush()
    const d = w.s.get()
    expect(d.shots[w.shot.id].camera).toEqual(CAMERA)
    expect(currentFrame(d, w.shot.id)?.id).toBe(w.v1)
    expect(staleList(d)).toHaveLength(before)
  })
})

describe('keepBoth and discard', () => {
  it('Keep both adds the new frame as an alternate and leaves the fields; undo takes it back', async () => {
    const w = await world({ reading: 'camera', runAs: 'frame', camera: { angle: 'overhead' } })
    await keepBothStep(w.s, w.fe.id, w.shot.id)
    await w.s.flush()
    const p = proposalOf(w.s.get(), w.fe.id)!
    expect(w.s.get().shots[w.shot.id].pick).toEqual({ current: w.v1, alternates: [p.id] })
    expect(w.s.get().shots[w.shot.id].camera).toEqual(CAMERA)
    await w.s.undo()
    await w.s.flush()
    expect(w.s.get().shots[w.shot.id].pick?.alternates ?? []).toEqual([])
  })

  it('Discard deletes the new frame and keeps the job (History); undo brings it back', async () => {
    const w = await world({ reading: 'camera', runAs: 'frame', camera: { angle: 'overhead' } })
    const p = proposalOf(w.s.get(), w.fe.id)!
    await discardStep(w.s, w.fe.id)
    await w.s.flush()
    expect(w.s.get().frames[p.id]).toBeUndefined()
    expect(w.s.get().jobs[w.fe.id]).toBeDefined()
    await w.s.undo()
    await w.s.flush()
    expect(w.s.get().frames[p.id]).toBeDefined()
  })

  it('a picked frame is never discarded, and Keep both of a picked frame does nothing', async () => {
    const w = await world({ reading: 'camera', runAs: 'frame', camera: { angle: 'overhead' } })
    await updateDoc(w.s, (d) => {
      applyFrameEdit(d, w.fe.id, w.shot.id)
      expect(keepBoth(d, w.fe.id, w.shot.id)).toBeUndefined()
      expect(discard(d, w.fe.id)).toBe(false)
    }, 'apply')
  })
})

describe('the passthrough reading the mock uses', () => {
  it('reads camera words, asks on size words with no default, and sends the rest as a local change', () => {
    expect(readingOf('make this an overhead aerial shot', CAMERA)).toEqual({ reading: 'camera', camera: { angle: 'overhead' } })
    expect(readingOf('give it a dutch tilt', CAMERA)).toEqual({ reading: 'camera', camera: { angle: 'dutch' } })
    expect(readingOf('make the bottle bigger', CAMERA).reading).toBe('ask')
    expect(readingOf('make the bottle bigger', { size: 'medium' }, 'camera')).toEqual({ reading: 'camera', camera: { size: 'medium_close' } })
    expect(readingOf('she slowly turns', CAMERA)).toEqual({ reading: 'local', camera: {} })
    expect(mockFrameEdit({ text: 'push in slowly', shot: { camera: CAMERA } as never }).edit?.runAs).toBe('none')
    const q = mockFrameEdit({ text: 'make it bigger' }).question!
    expect(q).toMatchObject({ kind: 'ambiguity', text: 'Bigger how?', allow_text: false })
    expect(q.options.map((o) => o.value)).toEqual(['camera', 'local', 'both'])
    expect('recommended_option_id' in q).toBe(false)
  })
})

// ── end to end on the mock relay: the request, the landing, Redo ────────────────────────────

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

async function onMock() {
  let t = 1_000_000
  const renderer: MockRenderer = {
    async render() { return [{ blob: new Blob([`pic-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 16, h: 9 }] },
  }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const doc = snapshotDoc()
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, doc, ui)
  const deps: FrameDeps = { relay, doc, ui, runner }
  wireJobs(deps)
  const front = await putBlob(new Blob(['front'], { type: 'image/png' }))
  const script = 'Our hero runs along the beach.'
  await updateDoc(doc, (d) => {
    addKey(d, 'hero')
    addRef(d, 'hero', 'front', front)
    addScene(d, script)
    planShots(d, mockShotList(script, 5, ['hero_front']).slice(0, 1))
  })
  const land = async () => {
    t += 5000
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
  }
  await drawFrame(deps, 0, 'first')
  await land()
  return { deps, doc, ui, land, shotId: shotsOf(doc.get())[0].id }
}

describe('Change this frame on the mock relay', () => {
  it('sends the frame, the shot and the words with no continuity, and lands the result unpicked', async () => {
    const m = await onMock()
    const v1 = currentFrame(m.doc.get(), m.shotId)!
    const jobId = await changeFrame(m.deps, m.shotId, 'make this an overhead aerial shot')
    const input = m.ui.get().jobs[jobId].request!.input
    expect(input.image?.sha256).toBe(v1.asset)
    expect(input.text).toBe('make this an overhead aerial shot')
    expect(input.shot?.camera).toEqual(m.doc.get().shots[m.shotId].camera)
    expect(input.anchorFrame).toBeUndefined()
    expect(input.previousFrame).toBeUndefined()
    await m.land()
    const d = m.doc.get()
    const p = proposalOf(d, jobId)!
    expect(p).toMatchObject({ kind: 'edited', parent_id: v1.id })
    expect(currentFrame(d, m.shotId)?.id).toBe(v1.id)
    expect(frameEditOf(d.jobs[jobId])).toMatchObject({ reading: 'camera', camera: { angle: 'overhead' }, words_as_given: true })
    expect(frameEditLines(d.jobs[jobId])).toContain(frameEditCopy.passthrough)
    await applyFrameEditStep(m.doc, jobId, m.shotId)
    expect(m.doc.get().shots[m.shotId].camera.angle).toBe('overhead')
    expect(currentFrame(m.doc.get(), m.shotId)?.id).toBe(p.id)
  })

  it('Redo is a new frame_edit job on the earlier one, which stays until discarded', async () => {
    const m = await onMock()
    const first = await changeFrame(m.deps, m.shotId, 'make it a low angle')
    await m.land()
    const second = await changeFrame(m.deps, m.shotId, 'make it a low angle, from below', { redoOf: first })
    expect(m.doc.get().jobs[second].parent_ids).toEqual([first])
    expect(m.ui.get().jobs[second].request!.parentIds).toEqual([first])
    await m.land()
    expect(proposalOf(m.doc.get(), first)).toBeDefined()
    expect(proposalOf(m.doc.get(), second)).toBeDefined()
  })

  it('a change of movement only lands no picture', async () => {
    const m = await onMock()
    const jobId = await changeFrame(m.deps, m.shotId, 'pan slowly')
    await m.land()
    const d = m.doc.get()
    expect(d.jobs[jobId].state).toBe('completed')
    expect(proposalOf(d, jobId)).toBeUndefined()
    expect(frameEditOf(d.jobs[jobId])?.runAs).toBe('none')
  })
})
