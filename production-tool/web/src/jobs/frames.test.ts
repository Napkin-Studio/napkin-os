import { describe, expect, it, vi } from 'vitest'
import type { JobInput, ProductionDocument } from '../contracts/types'
import { describeWrite } from '../doc/describe'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { putBlob } from '../lib/blobs'
import { jobsList, shotsOf } from '../model/selectors'
import { MockRelay, mockShotList, type MockRenderer } from '../relay/mock'
import { addKey, addRef, addScene, addShots, snapshotDoc } from '../test/jobFixtures'
import { makeAjv, SCHEMA } from '../test/schemas'
import { continueDrawing, drawFrame, drawTheRest, selectedFrame, selectFrame, type FrameDeps } from './frames'
import { JobRunner } from './runner'
import { frameDrift, frameStale } from './stale'
import { wireJobs } from './wire'

// Sequential storyboard frames (decided 2026-10-07): frame 1 from the shot's named refs; every
// later frame with anchorFrame = shot 1's frame and previousFrame = the shot before's.

/** Let the runner's fetch-and-store finish (promises only; no clock). */
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

async function setup(shotCount = 3) {
  let t = 1_000_000
  let renders = 0
  const renderer: MockRenderer = {
    async render() {
      renders++
      return [{ blob: new Blob([`frame-${renders}-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 9, h: 16 }]
    },
  }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const doc = snapshotDoc()
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, doc, ui)
  const deps: FrameDeps = { relay, doc, ui, runner }
  wireJobs(deps)

  const front = await putBlob(new Blob(['front view'], { type: 'image/png' }))
  const script = 'It rains on a city street. Our hero opens a yellow umbrella. She splashes through a puddle. She grins.'
  await updateDoc(doc, (d) => {
    addKey(d, 'hero')
    addRef(d, 'hero', 'front', front)
    addScene(d, script)
    addShots(d, mockShotList(script, 20, ['hero_front']).slice(0, shotCount))
  })

  /** Every frame job running now finishes and lands (and the chain, if on, starts the next). */
  const land = async () => {
    t += 5000
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
  }
  const requests = () => jobsList(doc.get()).map((j) => ({ id: j.id, state: j.state, ctx: runner.ctx(j.id)! }))
  const inputOf = (jobId: string): JobInput => ui.get().jobs[jobId].request!.input
  const shotId = (i: number) => shotsOf(doc.get())[i].id
  const frameOf = (i: number) => selectedFrame(doc.get(), shotId(i))!
  const running = () => requests().filter((r) => !['completed', 'failed', 'cancelled'].includes(r.state))
  return { deps, doc, ui, runner, land, requests, inputOf, shotId, frameOf, running, front }
}

describe('sequential storyboard frames', () => {
  it('frame 1 comes from the shot\'s refs only; shot 2 and shot k carry frame 1 and the frame before', async () => {
    const s = await setup(3)
    const j1 = await drawFrame(s.deps, 0, 'first')
    const in1 = s.inputOf(j1)
    expect(in1.anchorFrame).toBeUndefined()
    expect(in1.previousFrame).toBeUndefined()
    expect(in1.refs?.map((r) => [r.name, r.asset.sha256])).toEqual([['hero_front', s.front]])
    expect(in1.shot?.refs).toEqual(['hero'])
    expect(in1.script).toContain('yellow umbrella')
    expect(in1.ratio).toBe('16:9')
    await s.land()
    const f1 = s.frameOf(0)
    expect(f1).toMatchObject({ version: 1, crew: 'wren', kind: 'mock', job_id: j1 })

    const j2 = await drawFrame(s.deps, 1, 'next')
    const in2 = s.inputOf(j2)
    expect(in2.anchorFrame?.sha256).toBe(f1.asset)
    expect(in2.previousFrame?.sha256).toBe(f1.asset)
    expect(in2.refs?.[0].asset.sha256).toBe(s.front)
    expect(in2.shot?.id).toBe(s.shotId(1))
    await s.land()
    const f2 = s.frameOf(1)

    const j3 = await drawFrame(s.deps, 2, 'next')
    const in3 = s.inputOf(j3)
    expect(in3.anchorFrame?.sha256).toBe(f1.asset)
    expect(in3.previousFrame?.sha256).toBe(f2.asset)
    expect(f2.asset).not.toBe(f1.asset)
    // The relay records both anchors as the job's input hashes.
    expect(s.doc.get().jobs[j3].input_hashes).toEqual(expect.arrayContaining([f1.asset, f2.asset]))
  })

  it('the document keeps what each frame job is for, and the request is contract 3', async () => {
    const s = await setup(2)
    const j1 = await drawFrame(s.deps, 0, 'first')
    const job = s.doc.get().jobs[j1]
    expect(job).toMatchObject({
      op: 'frame', purpose: 'frame first', node: { kind: 'shot', id: s.shotId(0) }, started_by: 'human:p_local',
      tenant_id: '00000000-0000-0000-0000-000000000000', crew: 'wren',
    })
    expect(job.nonce).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(job.inputs).toEqual([expect.objectContaining({ kind: 'ref', used_as: 'character', included: true })])
    const request = s.ui.get().jobs[j1].request
    expect(request).toMatchObject({ contractVersion: '3', projectId: s.doc.get().project.id, nonce: job.nonce, purpose: 'frame first', node: job.node })
    expect(makeAjv().compile({ $ref: SCHEMA('relay-api') + '#/$defs/JobRequest' })(request)).toBe(true)
  })

  it('a later shot cannot be drawn before the shot ahead of it', async () => {
    const s = await setup(3)
    await expect(drawFrame(s.deps, 1, 'next')).rejects.toThrow('Draw shot 1 first.')
  })

  it('Draw the rest starts shot k+1 only after shot k has landed, then stops', async () => {
    const s = await setup(4)
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    await drawTheRest(s.deps)
    expect(s.ui.get().drawingRest).toBe(true)
    for (const k of [1, 2, 3]) {
      // The chain submits shot k from a completion hook, which runs asynchronously: wait for it
      // to appear (CI was faster to check than the hook was to submit), then check it is the only one.
      await vi.waitFor(() => expect(s.running().length).toBeGreaterThan(0), { timeout: 2000, interval: 5 })
      const now = s.running()
      expect(now).toHaveLength(1) // one at a time
      expect(now[0].ctx.for === 'frame' && now[0].ctx.shotId).toBe(s.shotId(k))
      expect(now[0].ctx.for === 'frame' && now[0].ctx.how).toBe(k === 1 ? 'rest' : 'chain')
      const input = s.inputOf(now[0].id)
      expect(input.anchorFrame?.sha256).toBe(s.frameOf(0).asset)
      expect(input.previousFrame?.sha256).toBe(s.frameOf(k - 1).asset)
      expect(selectedFrame(s.doc.get(), s.shotId(k))).toBeUndefined()
      await s.land()
      expect(selectedFrame(s.doc.get(), s.shotId(k))).toBeDefined()
    }
    expect(s.running()).toHaveLength(0)
    expect(s.ui.get().drawingRest).toBe(false)
    expect(s.requests().filter((r) => r.ctx.for === 'frame')).toHaveLength(4)
  })

  it('Draw the rest picks up after a reload from what is drawn', async () => {
    const s = await setup(3)
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    // The page reloaded with the chain on and nothing moving: boot calls continueDrawing.
    s.ui.update((u) => { u.drawingRest = true })
    await continueDrawing(s.deps)
    const now = s.running()
    expect(now).toHaveLength(1)
    expect(now[0].ctx.for === 'frame' && now[0].ctx.shotId).toBe(s.shotId(1))
    // A second boot call while that frame is drawing starts nothing more.
    await continueDrawing(s.deps)
    expect(s.running()).toHaveLength(1)
  })

  it('a new version of frame k never marks frame k+1 or redraws it: frame k+1 is only "drawn from an older frame k", and going back clears that', async () => {
    const s = await setup(3)
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    await drawFrame(s.deps, 1, 'next')
    await s.land()
    await drawFrame(s.deps, 2, 'next')
    await s.land()
    const oldF2 = s.frameOf(1)
    const f3 = s.frameOf(2)
    const jobsBefore = Object.keys(s.doc.get().jobs).length

    const again = await drawFrame(s.deps, 1, 'again', { text: 'closer', parent: oldF2 })
    const input = s.inputOf(again)
    expect(input.anchorFrame?.sha256).toBe(s.frameOf(0).asset)
    expect(input.previousFrame?.sha256).toBe(s.frameOf(0).asset)
    expect(input.text).toBe('closer')
    await s.land()
    const newF2 = s.frameOf(1)
    expect(newF2.id).not.toBe(oldF2.id)
    expect(newF2).toMatchObject({ version: 2, parent_id: oldF2.id })
    expect(s.doc.get().shots[s.shotId(1)].pick).toEqual({ current: newF2.id })
    expect(s.doc.get().stale).toEqual({}) // one to one: frame 3's own shot did not change
    expect(frameStale(s.doc.get(), s.shotId(2))).toBeUndefined()
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBe(2) // the quiet note: drawn from an older frame 2
    expect(frameDrift(s.doc.get(), s.shotId(1))).toBeUndefined() // frame 2 itself was drawn from frame 1 as it is
    expect(Object.keys(s.doc.get().jobs).length).toBe(jobsBefore + 1) // only the regenerate: shot 3 is not redrawn
    expect(f3.id).toBe(s.frameOf(2).id)

    await selectFrame(s.doc, s.shotId(1), oldF2.id) // back to the version shot 3 was drawn from
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBeUndefined()
    await selectFrame(s.doc, s.shotId(1), newF2.id)
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBe(2)
    expect(s.doc.get().stale).toEqual({})
  })

  it('a new frame 1 leaves the later frames up to date: each says it was drawn from an older frame', async () => {
    const s = await setup(3)
    for (let i = 0; i < 3; i++) {
      await drawFrame(s.deps, i, i === 0 ? 'first' : 'next')
      await s.land()
    }
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    expect(s.doc.get().stale).toEqual({})
    expect(frameDrift(s.doc.get(), s.shotId(1))).toBe(1) // the frame before it
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBe(1) // frame 2 is as it was; frame 1, its anchor, is not
  })

  it('the decision chain names the frame steps', async () => {
    const s = await setup(3)
    const said: string[] = []
    let before: ProductionDocument = s.doc.get()
    const note = () => {
      const d = describeWrite('submit frame', before, s.doc.get())
      if (d) said.push(d.action)
      before = s.doc.get()
    }
    await drawFrame(s.deps, 0, 'first'); note()
    await s.land(); before = s.doc.get()
    await drawFrame(s.deps, 1, 'next'); note()
    await s.land(); before = s.doc.get()
    await drawTheRest(s.deps); note()
    expect(said).toEqual(['start frame for shot 1', 'start frame for shot 2', 'start frame for shot 3'])
  })

  it('anchorFrame is in the contract (types and schema agree)', () => {
    const validate = makeAjv().compile({ $ref: SCHEMA('relay-api') + '#/$defs/JobInput' })
    const ref = { sha256: `sha256:${'a'.repeat(64)}`, url: 'https://x.invalid/a', mime: 'image/png' as const }
    const input: JobInput = { anchorFrame: ref, previousFrame: ref, ratio: '9:16', script: 'Rain.' }
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...input, anchorFrame: { sha256: 'nope' } })).toBe(false)
  })
})

describe('a shot names its refs', () => {
  it('a name in the typed change is sent too, and a name no picture has stops the frame with a clear message', async () => {
    const s = await setup(1)
    const lamp = await putBlob(new Blob(['lamp'], { type: 'image/png' }))
    await updateDoc(s.doc, (d) => {
      addKey(d, 'lamp', 'prop')
      addRef(d, 'lamp', 'on', lamp, 'prop')
    })
    const j = await drawFrame(s.deps, 0, 'first', { text: 'and @lamp_on glows' })
    expect(s.inputOf(j).refs?.map((r) => r.name)).toEqual(['hero_front', 'lamp_on'])
    // A key with no front: the whole character cannot be sent.
    await updateDoc(s.doc, (d) => {
      const k = addKey(d, 'ghost')
      addRef(d, 'ghost', 'side', lamp)
      d.shots[s.shotId(0)].refs = [k.id]
    })
    await expect(drawFrame(s.deps, 0, 'again', { text: 'x' })).rejects.toThrow(/front for ghost/)
  })
})

describe('script length (2026-10-09)', () => {
  it('a script is up to 1500 characters; a frame request carries its first 600', async () => {
    const { FRAME_SCRIPT_MAX, SCRIPT_MAX, scriptText } = await import('./frames')
    expect([SCRIPT_MAX, FRAME_SCRIPT_MAX]).toEqual([1500, 600])
    const d = snapshotDoc().get()
    addScene(d, 'x'.repeat(1400))
    expect(scriptText(d)).toHaveLength(600)
  })
})
