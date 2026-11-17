import { describe, expect, it } from 'vitest'
import type { UiState } from '../doc/ui'
import { initialUi } from '../doc/ui'
import { SnapshotStore, updateDoc } from '../doc/store'
import { putBlob } from '../lib/blobs'
import { currentFrame, shotsOf } from '../model/selectors'
import { purposeOf, purposeWords } from '../model/purpose'
import { MockRelay, mockShotList, type MockRenderer } from '../relay/mock'
import { addKey, addRef, addScene, addShots as planShots, snapshotDoc } from '../test/jobFixtures'
import {
  applyFrameEditStep, cameBackSame, changeFrame, frameEditCopy, frameEditMode, frameEditOf, framePriceUsd, landFrameEdit, proposalOf,
} from './frameEdit'
import { mockFrameEdit, mockRecasts } from './frameWords'
import { drawFrame, type FrameDeps } from './frames'
import { JobRunner } from './runner'
import { wireJobs } from './wire'

// Change this frame: Edit parts, or Redraw frame (features/frame-edit-or-redraw.clan, mock frame-edit-or-redraw-v2).

const SWAP = 'An Indian seller is selling the cloth to Nigerian buyers'
const flush = () => new Promise((r) => setTimeout(r, 0))

async function onMock() {
  let t = 1_000_000
  let same = false
  const renderer: MockRenderer = {
    async render() { return [{ blob: new Blob([same ? 'same' : `pic-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 16, h: 9 }] },
  }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const doc = snapshotDoc()
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, doc, ui)
  const deps: FrameDeps = { relay, doc, ui, runner }
  wireJobs(deps)
  const front = await putBlob(new Blob(['front'], { type: 'image/png' }))
  const script = 'Behind them, a line of shoppers waits, arms full of colour.'
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
  return { deps, doc, ui, runner, relay, land, shotId: shotsOf(doc.get())[0].id, sameNext: () => { same = true } }
}

describe('the words and the price', () => {
  it('say each mode as the mock does', () => {
    expect(frameEditCopy.mode).toEqual({ edit: 'Edit parts', redraw: 'Redraw frame' })
    expect(frameEditCopy.hint.redraw(5)).toMatch(/^Draws frame 5 again from the shot\./)
    expect(frameEditCopy.send).toEqual({ edit: 'Send', redraw: 'Redraw' })
    expect(frameEditCopy.recast.redraw).toBe('Redraw frame instead')
    expect(frameEditCopy.charged('Runway', 0.25)).toBe('Runway charged $0.25 for it. Say it another way, or redraw the frame.')
  })
  it('prices the change from the frame model on the sheet: Gemini 3 Pro at 20 credits is about $0.20', () => {
    expect(framePriceUsd()).toBe(0.2)
    expect(frameEditCopy.price(0.2)).toBe('≈ $0.20')
  })
})

describe('the mode is kept with the job', () => {
  it('a redraw purpose is "frame_edit redraw" and reads back', () => {
    const words = purposeWords({ for: 'frame_edit', shotId: 'shot_x', mode: 'redraw' })
    expect(words).toBe('frame_edit redraw')
    expect(purposeOf({ purpose: words, node: { kind: 'shot', id: 'shot_x' }, inputs: [] })).toEqual({ for: 'frame_edit', shotId: 'shot_x', mode: 'redraw' })
    expect(purposeWords({ for: 'frame_edit', shotId: 'shot_x' })).toBe('frame_edit')
  })
  it('a job is a redraw when its purpose says so, or Dex read it so', () => {
    expect(frameEditMode({ purpose: 'frame_edit redraw' })).toBe('redraw')
    expect(frameEditMode({ purpose: 'frame_edit', director: { model: 'm', promptVersion: 'director.v9.1', rationale: '', output: { frameEdit: { reading: 'redraw', runAs: 'frame' } } } } as never)).toBe('redraw')
    expect(frameEditMode({ purpose: 'frame_edit' })).toBe('edit')
  })
})

describe("the mock relay's reading (as the passthrough and Dex)", () => {
  const input = { text: SWAP, shot: { id: 'shot_x', kind: 'shot', duration_s: 2, camera: { size: 'medium_wide' }, action: '', refs: [] } } as never
  it('asks a recast for words that swap the people, redraw recommended, nothing to type', () => {
    const q = mockFrameEdit(input).question!
    expect(q.kind).toBe('recast')
    expect(q.recommended_option_id).toBe('redraw')
    expect(q.options.map((o) => [o.id, o.label])).toEqual([['redraw', 'Redraw frame instead'], ['edit', 'Edit anyway']])
  })
  it('redraws when asked to, or when the answer is redraw; edits when the answer is edit', () => {
    expect(mockFrameEdit({ ...(input as object), mode: 'redraw' } as never).edit).toMatchObject({ reading: 'redraw', runAs: 'frame' })
    expect(mockFrameEdit(input, 'redraw').edit?.reading).toBe('redraw')
    expect(mockFrameEdit(input, 'edit').edit?.reading).toBe('local')
    expect(mockRecasts({ text: 'make her scarf red', shot: {} } as never)).toBe(false)
    expect(mockRecasts({ text: SWAP } as never)).toBe(false) // not a shot's frame
  })
})

describe('Redraw frame on the mock relay', () => {
  it('sends mode redraw with the frame and the shot, keeps it in the purpose, and lands a proposal Dex read as redraw', async () => {
    const m = await onMock()
    const v1 = currentFrame(m.doc.get(), m.shotId)!
    const jobId = await changeFrame(m.deps, m.shotId, SWAP, { mode: 'redraw' })
    const req = m.ui.get().jobs[jobId].request!
    expect(req.input.mode).toBe('redraw')
    expect(req.input.image?.sha256).toBe(v1.asset)
    expect(req.input.previousFrame).toBeUndefined()
    expect(m.doc.get().jobs[jobId].purpose).toBe('frame_edit redraw')
    await m.land()
    const d = m.doc.get()
    expect(frameEditOf(d.jobs[jobId])).toMatchObject({ reading: 'redraw', runAs: 'frame' })
    expect(frameEditMode(d.jobs[jobId])).toBe('redraw')
    const p = proposalOf(d, jobId)!
    expect(p.parent_id).toBe(v1.id)
    await applyFrameEditStep(m.doc, jobId, m.shotId)
    expect(currentFrame(m.doc.get(), m.shotId)?.id).toBe(p.id)
  })

  it('an edit that swaps the people waits on the recast; Redraw frame instead resumes the same job as a redraw', async () => {
    const m = await onMock()
    const jobId = await changeFrame(m.deps, m.shotId, SWAP)
    await m.land()
    expect(m.doc.get().jobs[jobId].state).toBe('needs_input')
    expect(Object.values(m.doc.get().asks).find((a) => a.job_id === jobId)?.question.kind).toBe('recast')
    expect(proposalOf(m.doc.get(), jobId)).toBeUndefined()
    await m.runner.answer(jobId, { optionId: 'redraw' })
    await m.land()
    await m.land()
    expect(frameEditOf(m.doc.get().jobs[jobId])?.reading).toBe('redraw')
    expect(proposalOf(m.doc.get(), jobId)).toBeDefined()
  })

  it('Edit anyway resumes the same job as an edit', async () => {
    const m = await onMock()
    const jobId = await changeFrame(m.deps, m.shotId, SWAP)
    await m.land()
    await m.runner.answer(jobId, { optionId: 'edit' })
    await m.land()
    await m.land()
    expect(frameEditOf(m.doc.get().jobs[jobId])?.reading).toBe('local')
  })

  it('a picture that came back the same lands marked, so no Apply is offered', async () => {
    const m = await onMock()
    const jobId = await changeFrame(m.deps, m.shotId, 'make her scarf red [same]')
    await m.land()
    const p = proposalOf(m.doc.get(), jobId)!
    expect(cameBackSame(p)).toBe(true)
    const other = await changeFrame(m.deps, m.shotId, 'make her scarf red')
    await m.land()
    expect(cameBackSame(proposalOf(m.doc.get(), other))).toBe(false)
  })
})

describe('landFrameEdit keeps the mark', () => {
  it('writes unchanged into the edit, with the reading', async () => {
    const m = await onMock()
    const d = structuredClone(m.doc.get())
    const f = landFrameEdit(d, { jobId: 'job_x', op: 'frame_edit', crew: 'dex', outputs: [{ sha256: currentFrame(d, m.shotId)!.asset, url: 'x', mime: 'image/png' }], unchanged: true,
      director: { model: 'm', promptVersion: 'director.v9.1', rationale: '', output: { frameEdit: { reading: 'local', runAs: 'frame' } } } } as never, { shotId: m.shotId })!
    expect(f.edits?.[0]).toEqual({ op: 'frame_edit', params: { reading: 'local', unchanged: true } })
    expect(cameBackSame(f)).toBe(true)
  })
})

describe('the price on the mock provider', () => {
  it('is not shown when the routed model costs nothing, and is Runway\'s when Runway is routed', () => {
    expect(framePriceUsd({ routing: { frame_edit: ['mock'] } } as never)).toBeUndefined()
    expect(framePriceUsd({ routing: { frame_edit: ['runway'] } } as never)).toBe(0.2)
  })
})
