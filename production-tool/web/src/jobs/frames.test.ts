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
import { keepCharacter, keptFromFirst, suggestKey } from './cast'
import { continueDrawing, drawFrame, drawTheRest, PARALLEL_FRAMES, selectedFrame, selectFrame, type FrameDeps } from './frames'
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
    // Its own beat only (UAT round 3 R3-12): no whole script on a frame whose shot has words.
    expect(in1.script).toBeUndefined()
    expect(in1.shot?.action).toBeTruthy()
    expect(in1.ratio).toBe('16:9')
    await s.land()
    const f1 = s.frameOf(0)
    expect(f1).toMatchObject({ version: 1, crew: 'wren', kind: 'mock', job_id: j1 })

    const j2 = await drawFrame(s.deps, 1, 'next')
    const in2 = s.inputOf(j2)
    expect(in2.anchorFrame?.sha256).toBe(f1.asset)
    // Frame 1 is the frame before too: the request carries it once, as @anchor (UAT round 4, R4-F5: it went as @anchor
    // and @previous, the same sha twice, to the provider).
    expect(in2.previousFrame).toBeUndefined()
    const shas = [in2.anchorFrame, in2.previousFrame, ...(in2.refs ?? []).map((r) => r.asset)].filter(Boolean).map((a) => a!.sha256)
    expect(new Set(shas).size).toBe(shas.length)
    expect(in2.refs?.[0].asset.sha256).toBe(s.front)
    expect(in2.shot?.id).toBe(s.shotId(1))
    // A later frame reads shot 1's beat as @anchor's place, and not the rest of the script.
    expect(in2.script?.startsWith('Shot 1 (@anchor): ')).toBe(true)
    expect(in2.script).not.toContain(shotsOf(s.doc.get())[2].action!)
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
      // Shot 2's frame before is frame 1, the anchor: sent once (R4-F5).
      if (k === 1) expect(input.previousFrame).toBeUndefined()
      else expect(input.previousFrame?.sha256).toBe(s.frameOf(k - 1).asset)
      expect(selectedFrame(s.doc.get(), s.shotId(k))).toBeUndefined()
      await s.land()
      expect(selectedFrame(s.doc.get(), s.shotId(k))).toBeDefined()
    }
    expect(s.running()).toHaveLength(0)
    expect(s.ui.get().drawingRest).toBe(false)
    expect(s.requests().filter((r) => r.ctx.for === 'frame')).toHaveLength(4)
  })

  it('once frame 1’s person is kept, Draw the rest draws two at a time, each with its character (UAT round 3, UX 10)', async () => {
    const s = await setup(5)
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    await keepCharacter(s.doc, s.frameOf(0).asset, 'mia')
    expect(keptFromFirst(s.doc.get(), undefined)).toBeTruthy()
    await drawTheRest(s.deps)
    await vi.waitFor(() => expect(s.running().length).toBe(PARALLEL_FRAMES), { timeout: 2000, interval: 5 })
    const first = s.running()
    expect(first.map((r) => r.ctx.for === 'frame' && r.ctx.shotId)).toEqual([s.shotId(1), s.shotId(2)])
    for (const r of first) {
      const input = s.inputOf(r.id)
      expect(input.anchorFrame?.sha256).toBe(s.frameOf(0).asset)
      expect(input.refs?.some((x) => x.role === 'character')).toBe(true) // the shot's own @hero, else the kept person (cast.ts)
    }
    // Shot 3 has no frame before it yet: it goes with its anchor only, never waiting on shot 2.
    expect(s.inputOf(first[1].id).previousFrame).toBeUndefined()
    await s.land()
    await vi.waitFor(() => expect(s.running().length).toBe(2), { timeout: 2000, interval: 5 })
    await s.land()
    await vi.waitFor(() => expect(s.ui.get().drawingRest).toBe(false), { timeout: 2000, interval: 5 })
    expect(shotsOf(s.doc.get()).every((x) => selectedFrame(s.doc.get(), x.id))).toBe(true)
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
    expect(input.previousFrame).toBeUndefined() // the same picture as the anchor: sent once (R4-F5)
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

describe('who a later frame shows (UAT round 2 R2-4, reversed in round 3 R3-F1)', () => {
  it('frame 1 never goes as an unnamed person; a person shot sends the kept character by name; no picture twice', async () => {
    const s = await setup(3)
    // Shots that name nobody: the planned shots lose their refs; shot 2 implies a person, shot 3 is an insert.
    await updateDoc(s.doc, (d) => {
      const shots = shotsOf(d)
      for (const sh of shots) sh.refs = []
      shots[1].action = 'She opens a yellow umbrella.'
      shots[2].action = 'The kettle glows blue and boils without a sound.'
    })
    const j1 = await drawFrame(s.deps, 0, 'first')
    await s.land()
    expect(s.inputOf(j1).refs ?? []).toEqual([])
    const j2 = await drawFrame(s.deps, 1, 'first')
    expect((s.inputOf(j2).refs ?? []).filter((r) => r.role === 'character')).toEqual([])
    expect(s.inputOf(j2).anchorFrame?.sha256).toBe(s.frameOf(0).asset)
    await s.land()
    // Keep her as @mia: a person shot sends @mia_front, and frame 1 (the same picture) is not sent again as anchor.
    const name = await keepCharacter(s.doc, s.frameOf(0).asset, 'Mia')
    expect(name).toBe('mia_front')
    expect(keptFromFirst(s.doc.get(), shotsOf(s.doc.get())[0].storyboard_id)?.key).toBe('mia')
    await updateDoc(s.doc, (d) => { shotsOf(d)[2].action = 'She grins at the kettle.' })
    const j3 = await drawFrame(s.deps, 2, 'first')
    const in3 = s.inputOf(j3)
    expect((in3.refs ?? []).filter((r) => r.role === 'character').map((r) => r.name)).toEqual(['mia_front'])
    expect(in3.anchorFrame).toBeUndefined()
    const shas = [...(in3.refs ?? []).map((r) => r.asset.sha256), in3.anchorFrame?.sha256, in3.previousFrame?.sha256].filter(Boolean)
    expect(new Set(shas).size).toBe(shas.length)
    expect(suggestKey('Mia kneels by the puppy.')).toBe('mia')
    expect(suggestKey('A wide street.')).toBe('')
  })

  it('an insert that names no one sends no character, even the kept one', async () => {
    const s = await setup(3)
    await updateDoc(s.doc, (d) => {
      const shots = shotsOf(d)
      for (const sh of shots) sh.refs = []
      shots[1].action = 'The kettle glows blue and boils without a sound.'
      delete shots[1].direction
      for (const b of Object.values(d.beats)) if (b.shot_id === shots[1].id) delete d.beats[b.id]
    })
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    await keepCharacter(s.doc, s.frameOf(0).asset, 'Mia')
    const j2 = await drawFrame(s.deps, 1, 'first')
    expect((s.inputOf(j2).refs ?? []).filter((r) => r.role === 'character')).toEqual([])
  })
})

describe('namesPerson (R3-F1)', () => {
  it('reads people from names, mentions, speakers and person words; not from things', async () => {
    const { namesPerson } = await import('./cast')
    const d = snapshotDoc().get()
    addKey(d, 'maya')
    const shot = (action: string) => ({ id: 'shot_X', action, refs: [], kind: 'shot', duration_s: 2, camera: { size: 'insert' } }) as never
    expect(namesPerson(d, shot('The kettle glows blue and boils without a sound.'))).toBe(false)
    expect(namesPerson(d, shot('Through the thin wall, the snoring carries on, undisturbed.'))).toBe(false)
    expect(namesPerson(d, shot('1 a.m. A dark kitchen, lit only by the open fridge.'))).toBe(false)
    expect(namesPerson(d, shot('@maya flips the switch, wincing.'))).toBe(true)
    expect(namesPerson(d, shot('Maya whispers to the kettle.'))).toBe(true)
    expect(namesPerson(d, shot('A woman in a dressing gown.'))).toBe(true)
    expect(namesPerson(d, shot('Behind the thin wall, a flatmate keeps snoring, undisturbed.'))).toBe(true)
    expect(namesPerson(d, shot('Her finger presses the switch.'))).toBe(true)
  })
})

describe('castRefs (R3-F1)', () => {
  it('a person shot promotes the one offered character; an insert leaves it optional', async () => {
    const { castRefs } = await import('./cast')
    const d = snapshotDoc().get()
    addKey(d, 'maya')
    const asset = (n: string) => ({ sha256: `sha256:${n.repeat(64)}`, url: 'x', mime: 'image/png' })
    const refs = [
      { id: 'ref_a', name: 'maya_front', role: 'character', kind: 'picture', asset: asset('a'), optional: true },
      { id: 'ref_b', name: 'maya_full', role: 'character', kind: 'picture', asset: asset('b'), optional: true },
    ] as never[]
    const shot = (action: string) => ({ id: 'shot_X', action, refs: [], kind: 'shot', duration_s: 2, camera: { size: 'medium' } }) as never
    const person = await castRefs({} as never, d, undefined, 2, shot('She whispers to the kettle.'), refs)
    expect(person.map((r) => [r.name, !!r.optional])).toEqual([['maya_front', false], ['maya_full', false]])
    const insert = await castRefs({} as never, d, undefined, 2, shot('The kettle glows blue.'), refs)
    expect(insert.map((r) => !!r.optional)).toEqual([true, true])
  })
})

describe('castRefs: a character only when the shot names it (UAT round 4, R4-F2)', () => {
  const asset = (n: string) => ({ sha256: `sha256:${n.repeat(64)}`, url: 'x', mime: 'image/png' })
  const refs = [
    { id: 'ref_a', name: 'maya_front', role: 'character', kind: 'picture', asset: asset('a'), optional: true },
    { id: 'ref_b', name: 'maya_full', role: 'character', kind: 'picture', asset: asset('b'), optional: true },
  ] as never[]
  const shot = (action: string) => ({ id: 'shot_X', action, refs: [], kind: 'shot', duration_s: 1.5, camera: { size: 'medium' } }) as never

  it('round 4 repro: "a flatmate keeps snoring" sends no Maya and tells Dex the flatmate is someone else', async () => {
    const { castRefs, castShot } = await import('./cast')
    const d = snapshotDoc().get()
    addKey(d, 'maya')
    const flatmate = shot('Behind the thin wall, a flatmate keeps snoring, undisturbed.')
    const out = await castRefs({} as never, d, undefined, 3, flatmate, refs)
    expect(out.filter((r) => r.role === 'character')).toEqual([])
    const js = castShot(d, flatmate, { id: 'shot_X', kind: 'shot', duration_s: 1.5, camera: { size: 'medium' } as never, action: 'x', refs: [] }, refs)
    expect(js.direction).toBe('Cast: the flatmate here is someone else, not Maya; draw a different person.')
    expect(js.direction).not.toContain('@')
  })
  it('a shot that names the character gets all its pictures, required, a person noun beside it or not', async () => {
    const { castRefs } = await import('./cast')
    const d = snapshotDoc().get()
    addKey(d, 'maya')
    for (const words of ['@maya_front raises her mug to the snoring wall, grinning.', 'Maya whispers to the kettle.', '@maya tiptoes past her flatmate.']) {
      const out = await castRefs({} as never, d, undefined, 4, shot(words), refs)
      expect(out.map((r) => [r.name, !!r.optional]), words).toEqual([['maya_front', false], ['maya_full', false]])
    }
  })
  it('a pronoun or a hand carries on with the one offered character; an insert keeps it Dex\'s to leave out', async () => {
    const { castRefs } = await import('./cast')
    const d = snapshotDoc().get()
    addKey(d, 'maya')
    expect((await castRefs({} as never, d, undefined, 2, shot('Her finger presses the switch.'), refs)).map((r) => !!r.optional)).toEqual([false, false])
    expect((await castRefs({} as never, d, undefined, 2, shot('Insert on the kettle: the switch goes down.'), refs)).map((r) => !!r.optional)).toEqual([true, true])
  })
})

describe('a shot that shows no one (UAT round 5, R5-F3)', () => {
  it('the kettle insert after "She flicks the switch": no @previous with her in it, @anchor stays, Dex is told no one is seen', async () => {
    const s = await setup(3)
    await updateDoc(s.doc, (d) => {
      const [a, b, c] = shotsOf(d)
      d.shots[a.id].action = 'Our hero tiptoes into the dark kitchen.'
      d.shots[b.id].action = 'She flicks the switch and braces, shoulders up.'
      d.shots[c.id].action = 'The kettle glows soft blue, murmurs, then clicks off. No roar at all.'
      Object.assign(d.shots[c.id], { refs: [], direction: '' })
    })
    await drawFrame(s.deps, 0, 'first')
    await s.land()
    await drawFrame(s.deps, 1, 'next')
    await s.land()
    const j3 = await drawFrame(s.deps, 2, 'next')
    const in3 = s.inputOf(j3)
    expect(in3.anchorFrame?.sha256).toBe(s.frameOf(0).asset)
    expect(in3.previousFrame).toBeUndefined()
    expect(in3.shot?.direction).toContain('Cast: no one is seen in this shot; draw no people.')
    // Drawn without the frame before on purpose: not "drawn from an older frame".
    await s.land()
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBeUndefined()
    // A shot with a person keeps its frame before and says nothing of the kind.
    const j2 = s.requests().find((r) => (r.ctx as { shotId?: string } | undefined)?.shotId === s.shotId(1))!.id
    expect(s.inputOf(j2).shot?.direction ?? '').not.toContain('no one is seen')
  })

  it('two shots in a row with no one keep the frame before (the place, the kettle), and both say no one is seen', async () => {
    const s = await setup(3)
    await updateDoc(s.doc, (d) => {
      const [a, b, c] = shotsOf(d)
      d.shots[a.id].action = 'Our hero tiptoes into the dark kitchen.'
      d.shots[b.id].action = 'Insert on the kettle on the counter.'
      d.shots[c.id].action = 'The kettle glows soft blue, then clicks off.'
      for (const x of [b, c]) Object.assign(d.shots[x.id], { refs: [], direction: '' })
    })
    for (const i of [0, 1]) {
      await drawFrame(s.deps, i, i ? 'next' : 'first')
      await s.land()
    }
    const in3 = s.inputOf(await drawFrame(s.deps, 2, 'next'))
    expect(in3.previousFrame?.sha256).toBe(s.frameOf(1).asset)
    expect(in3.shot?.direction).toContain('no one is seen')
  })
})
