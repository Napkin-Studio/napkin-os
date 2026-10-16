// Delete and Undo on the real CLAN store (contract 3): each delete changes the
// document as the spec says and writes one decision; a person's delete is one
// LocalUndo step, and Undo puts it all back. The canvas side (CanvasDocSync) is
// driven with plain elements, deleted and brought back the way Excalidraw's
// Ctrl+Z does: not the person's undo steps, so they come back with restoreTo.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasDocSync, type SceneEl } from '../canvas/sync'
import { effectiveConfig } from '../capabilities'
import { SHEETS } from '../contracts/load'
import type { CustomData, DocJob, ProductionDocument, Review } from '../contracts/types'
import { JobRunner } from '../jobs/runner'
import { beatsOf, edlItemFor, framesOf, mainScript, scenesOf, shotNumber, shotsOf } from '../model/selectors'
import { rankBetween } from '../../../clan-store/src'
import type { ModelStore } from '../model/store'
import { addFrame, addShots, addTake, content, id, job, MAYA, modelStore, SHA, T } from '../test/model'
import { HttpRelay } from '../relay/http'
import { makeAjv, SCHEMA } from '../test/schemas'
import { cancelText, mayStillCharge } from '../ui/cancel'
import { deleteFrom, markStale, removeBeat, removeFrame, removeNote, removeRef, removeScene, removeShot, removeTake, sceneContents, sceneDeleteText, shotDeleteText, shotNeedsConfirm } from './remove'
import { SnapshotStore, systemUpdate } from './store'
import { initialUi, type UiState } from './ui'

const validate = makeAjv().getSchema(SCHEMA('document'))!

/** Someone part-way through: a named front, three shots, two with frames, one with clips, a note. */
function fixture(d: ProductionDocument) {
  const gFront = job(d, 'generate', [SHA('a')], SHA('b'))
  const gFront2 = job(d, 'generate', [SHA('a')], SHA('c'))
  for (const j of [gFront, gFront2]) d.jobs[j.id] = j
  const key = { id: id('key'), v: 1, field_v: {}, key: 'hero', role: 'character' as const }
  d.keys[key.id] = key
  const ref = { id: id('ref'), v: 1, field_v: {}, key: 'hero', variant: 'front', role: 'character' as const, asset: SHA('b'), node: gFront.id, named_at: T }
  d.refs[ref.id] = ref
  d.assets[SHA('b')] = { sha256: SHA('b'), kind: 'image', mime: 'image/png', origin: 'generated', locations: [] }
  const [s1, s2, s3] = addShots(d, 3)
  const fj = ['d', 'e', 'f'].map((c) => job(d, 'frame', [SHA('b')], SHA(c)))
  const cj = ['1', '2', '3'].map((c) => job(d, 'clip', [SHA('e'), SHA('b')], SHA(c)))
  for (const j of [...fj, ...cj]) d.jobs[j.id] = j
  const f1 = addFrame(d, s1, SHA('d'), { pick: true, job: fj[0] })
  const f2 = addFrame(d, s1, SHA('e'), { pick: true, job: fj[1], parent: f1 })
  const f3 = addFrame(d, s2, SHA('f'), { pick: true, job: fj[2] })
  const t1 = addTake(d, s1, SHA('1'), cj[0], { pick: true })
  const t2 = addTake(d, s1, SHA('2'), cj[1], { pick: true, parent: t1 })
  const t3 = addTake(d, s2, SHA('3'), cj[2], { pick: true })
  const note: Review = {
    id: id('rev'), v: 1, field_v: {}, target: { kind: 'take', id: t2.id }, shot_id: s1.id, at_s: 1.2, window: { from_s: 0, to_s: 2 }, by: `human:${MAYA.id}`, state: 'open', text: 'brighter please', created_at: T,
  }
  d.reviews[note.id] = note
  return { gFront, gFront2, ref, s1, s2, s3, f1, f2, f3, t1, t2, t3, note }
}

async function seeded<X>(build: (d: ProductionDocument) => X): Promise<{ s: ModelStore } & X> {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  let out: X | undefined
  await systemUpdate(s, (d) => { out = build(d) }, 'sync')
  await s.flush()
  if (s.trouble) throw new Error(`the fixture was refused: ${s.trouble}`)
  return { s, ...out! }
}

/** The person's delete and restore decisions, oldest first. */
async function entries(s: ModelStore) {
  return (await s.chain()).filter((e) => e.agent === `human:${MAYA.id}` && /^(delete|create again) /.test(e.action)).reverse()
}

/** A script's scene with words, two shots planned from it (one with a frame), a line tied to a moment. */
function sceneFixture(d: ProductionDocument) {
  const script = mainScript(d)!
  const last = scenesOf(d, script.id).at(-1)?.rank ?? null
  const scene = { id: id('scene'), v: 1, field_v: {}, script_id: script.id, rank: rankBetween(last, null), heading: 'EXT. BEACH - DAY', text: 'Waves.' }
  d.scenes[scene.id] = scene
  const [a, b] = addShots(d, 2, { scene_id: scene.id, action: 'She walks.' })
  const [c] = addShots(d, 1)
  const fj = job(d, 'frame', [], SHA('9'))
  d.jobs[fj.id] = fj
  addFrame(d, a, SHA('9'), { pick: true, job: fj })
  const moment = { id: id('beat'), v: 1, field_v: {}, shot_id: b.id, rank: rankBetween(null, null), at_s: 1, kind: 'moment' as const, text: 'eyes open' }
  const line = { id: id('beat'), v: 1, field_v: {}, shot_id: b.id, rank: rankBetween(moment.rank, null), at_s: 1, kind: 'line' as const, speaker: 'MAYA', text: 'Again.', moment_id: moment.id }
  d.beats[moment.id] = moment
  d.beats[line.id] = line
  return { scene, a, b, c, moment, line }
}

describe('deleting in the script and the storyboard (scenes, lines, shots)', () => {
  it('a line goes alone; Undo puts it back with its words', async () => {
    const { s, b, line, moment } = await seeded(sceneFixture)
    const before = content(s.get())
    await deleteFrom(s, (doc) => removeBeat(doc, line.id))
    await s.flush()
    expect(s.trouble).toBeNull()
    expect(beatsOf(s.get(), b.id).map((x) => x.id)).toEqual([moment.id])
    expect(validate(s.get()), JSON.stringify(validate.errors)).toBe(true)
    expect((await entries(s)).map((x) => x.action)).toEqual(['delete line in shot 2'])
    await s.undo()
    expect(content(s.get())).toEqual(before)
    expect(s.get().beats[line.id].text).toBe('Again.')
  })

  it('a moment goes and the line tied to it stays, untied', async () => {
    const { s, line, moment } = await seeded(sceneFixture)
    const before = content(s.get())
    await deleteFrom(s, (doc) => removeBeat(doc, moment.id))
    await s.flush()
    expect(s.get().beats[moment.id]).toBeUndefined()
    expect(s.get().beats[line.id].moment_id).toBeUndefined()
    await s.undo()
    expect(content(s.get())).toEqual(before)
  })

  it('a scene takes its shots, their beats and frames; other shots stay; Undo restores all of it', async () => {
    const { s, scene, a, b, c } = await seeded(sceneFixture)
    const before = content(s.get())
    const what = sceneContents(s.get(), scene.id)
    expect(what).toEqual({ shots: [a.id, b.id], frames: 1, clips: 0 })
    expect(sceneDeleteText(2, what)).toBe('Delete scene 2 and its 2 shots, with 1 frame?')
    await deleteFrom(s, (doc) => removeScene(doc, scene.id))
    await s.flush()
    expect(s.trouble).toBeNull()
    const after = s.get()
    expect(after.scenes[scene.id]).toBeUndefined()
    expect(shotsOf(after).map((x) => x.id)).toEqual([c.id])
    expect(Object.values(after.beats).filter((x) => x.shot_id === b.id)).toEqual([])
    expect(validate(after), JSON.stringify(validate.errors)).toBe(true)
    const e = await entries(s)
    expect(e.map((x) => x.action)).toEqual(['delete scene EXT. BEACH - DAY'])
    expect(e[0].rationale).toContain('with 2 shots, 1 frame and 0 clips')
    await s.undo()
    expect(content(s.get())).toEqual(before)
  })

  it('an empty scene goes at once; a shot asks first only when it has frames or clips', async () => {
    const { s, a, b } = await seeded(sceneFixture)
    expect(sceneDeleteText(1, { shots: [], frames: 0, clips: 0 })).toBeNull()
    expect(shotNeedsConfirm(s.get(), a.id)).toBe(true)
    expect(shotNeedsConfirm(s.get(), b.id)).toBe(false)
  })
})

describe('delete and undo, in the .clan', () => {
  it('a frame version: the pick moves to the version it came from; Undo puts it back', async () => {
    const { s, s1, f1, f2 } = await seeded(fixture)
    const before = content(s.get())
    await deleteFrom(s, (doc) => removeFrame(doc, f2.id))
    await s.flush()
    const after = s.get()
    expect(after.frames[f2.id]).toBeUndefined()
    expect(after.shots[s1.id].pick).toEqual({ current: f1.id, alternates: [] })
    expect(content(after.assets as never)).toEqual((before as ProductionDocument).assets) // files kept
    expect(validate(after), JSON.stringify(validate.errors)).toBe(true)
    const e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`delete frame ${f2.id} (shot 1, v2)`])
    expect(e[0].rationale).toContain(f2.id)
    expect(s.undoLabels().undo).toBe(`delete frame ${f2.id} (shot 1, v2)`)

    expect(await s.undo()).toMatchObject({ done: true })
    expect(content(s.get())).toEqual(before)
  })

  it('the last version may go: the shot has no pick; Undo puts it back', async () => {
    const { s, s2, f3 } = await seeded(fixture)
    const before = content(s.get())
    await deleteFrom(s, (doc) => removeFrame(doc, f3.id))
    await s.flush()
    expect(s.get().frames[f3.id]).toBeUndefined()
    expect(s.get().shots[s2.id].pick).toBeUndefined()
    expect(framesOf(s.get(), s2.id)).toEqual([])
    await s.undo()
    expect(content(s.get())).toEqual(before)
  })

  it('a shot takes its frames, clips, place in the cut and notes with it; the rest number by rank; Undo restores', async () => {
    const { s, s1, s2, s3, note } = await seeded(fixture)
    const before = content(s.get())
    expect(shotDeleteText(1, 2, 2)).toBe('Delete shot 1 and its 2 frames and 2 clips?')
    await deleteFrom(s, (doc) => removeShot(doc, s1.id))
    await s.flush()
    expect(s.trouble).toBeNull()
    const after = s.get()
    expect(shotsOf(after).map((x) => x.id)).toEqual([s2.id, s3.id])
    expect(shotNumber(after, s2.id)).toBe(1)
    expect(Object.values(after.frames).every((f) => f.shot_id !== s1.id)).toBe(true)
    expect(Object.keys(after.frames)).toHaveLength(1)
    expect(Object.values(after.takes).map((t) => t.shot_id)).toEqual([s2.id])
    expect(after.reviews[note.id]).toBeUndefined()
    expect(edlItemFor(after, s1.id)).toBeUndefined()
    expect(content(after.jobs as never)).toEqual((before as ProductionDocument).jobs)
    expect(validate(after), JSON.stringify(validate.errors)).toBe(true)
    const e = await entries(s)
    expect(e.map((x) => x.action)).toEqual(['delete shot 1'])
    expect(e[0].rationale).toContain('with 2 frames and 2 clips')

    await s.undo()
    expect(content(s.get())).toEqual(before)
  })

  it('a clip version: its notes go, the cut falls back to its parent clip; the last one may go too', async () => {
    const { s, s1, t1, t2, t3, note } = await seeded(fixture)
    const before = content(s.get())
    await deleteFrom(s, (doc) => removeTake(doc, t2.id))
    await s.flush()
    expect(Object.keys(s.get().takes)).toEqual([t1.id, t3.id])
    expect(edlItemFor(s.get(), s1.id)!.pick).toEqual({ current: t1.id, alternates: [] })
    expect(s.get().reviews[note.id]).toBeUndefined()
    await deleteFrom(s, (doc) => removeTake(doc, t1.id)) // the last clip may go too
    await s.flush()
    expect(Object.keys(s.get().takes)).toEqual([t3.id])
    expect(edlItemFor(s.get(), s1.id)!.pick).toBeUndefined()
    expect((await entries(s)).map((x) => x.action)).toEqual([`delete clip ${t2.id} (shot 1, v2)`, `delete clip ${t1.id} (shot 1, v1)`])
    await s.undo()
    await s.undo()
    expect(content(s.get())).toEqual(before)
  })

  it('a note (and with it, its timeline marker)', async () => {
    const { s, note } = await seeded(fixture)
    const before = content(s.get())
    await deleteFrom(s, (doc) => removeNote(doc, note.id))
    await s.flush()
    expect(s.get().reviews).toEqual({})
    const e = await entries(s)
    expect(e.map((x) => x.action)).toEqual(['delete note at 0:01.2 (shot 1)'])
    expect(e[0].rationale).toContain('"brighter please"')
    await s.undo()
    expect(content(s.get())).toEqual(before)
  })

  it('a name: the ref goes, its picture stays until Clean up', async () => {
    const { s, ref } = await seeded(fixture)
    await deleteFrom(s, (doc) => removeRef(doc, ref.id))
    await s.flush()
    expect(s.get().refs).toEqual({})
    expect(s.get().assets[ref.asset]).toBeDefined()
    expect((await entries(s)).map((x) => x.action)).toEqual(['delete the name @hero_front'])
  })
})

// ── the canvas ──

function genEl(j: DocJob, extra: Partial<Extract<CustomData, { kind: 'gen' }>> = {}): SceneEl {
  const customData: CustomData = { kind: 'gen', id: j.id, op: j.op as 'generate', parentIds: [], state: j.state, ...(j.outputs?.[0] ? { asset: j.outputs[0] } : {}), ...extra }
  return { id: j.id, type: 'image', customData }
}

const del = (els: SceneEl[], elId: string, isDeleted = true) => els.map((e) => (e.id === elId ? { ...e, isDeleted } : e))

function canvas(s: ModelStore) {
  const cancelled: string[] = []
  const sync = new CanvasDocSync({ doc: s, cancel: (jobId) => cancelled.push(jobId) })
  return { sync, cancelled }
}

describe('canvas delete ↔ document', () => {
  it('a sketch area drawn on our own engine gets its sketches row at its ratio, once, so a link into it holds', async () => {
    const { s } = await seeded(() => ({}))
    const sync = new CanvasDocSync({ doc: s, cancel: () => {}, drawnBy: () => 'human:p_sai0001' })
    const sk = id('sketch')
    const area: SceneEl = { id: 'el_area', type: 'rectangle', customData: { kind: 'sketch', id: sk }, ratio: '9:16' }
    await sync.sketches([])
    await sync.sketches([area])
    expect(s.get().sketches[sk]).toMatchObject({ aspect: { w: 9, h: 16 }, ratio: '9:16', drawn_by: 'human:p_sai0001' })
    // Deleted and brought back: the delete's own row comes back, not a second one.
    await sync.sketches([{ ...area, isDeleted: true }])
    expect(s.get().sketches[sk]).toBeUndefined()
    await sync.sketches([area])
    expect(Object.keys(s.get().sketches)).toEqual([sk])
  })

  it('a named image: its name stays in References, nothing else changes; Ctrl+Z restores', async () => {
    const { s, gFront, gFront2, ref } = await seeded(fixture)
    const before = content(s.get())
    const { sync } = canvas(s)
    let els = [genEl(gFront), genEl(gFront2)]
    await sync.gens(els)

    els = del(els, gFront.id)
    await sync.gens(els)
    expect(content(s.get())).toEqual(before)
    expect(s.get().refs[ref.id].node).toBe(gFront.id)
    let e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`delete generated image ${gFront.id}`])
    expect(e[0].rationale).toContain('its name @hero_front stays in References')
    // The canvas's own undo puts it back, not the person's.
    expect(s.undoLabels().undo).toBeNull()

    els = del(els, gFront.id, false)
    await sync.gens(els)
    expect(content(s.get())).toEqual(before)
    e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`delete generated image ${gFront.id}`, `create again generated image ${gFront.id}`])
  })

  it('something still generating is cancelled when its image is deleted; a retry is not a delete', async () => {
    const { s, running, failed } = await seeded((d) => {
      const running = job(d, 'generate', [SHA('a')], SHA('b'), { state: 'submitted' })
      const failed = job(d, 'generate', [SHA('a')], SHA('c'), { state: 'failed' })
      d.jobs[running.id] = running
      d.jobs[failed.id] = failed
      return { running, failed }
    })
    const { sync, cancelled } = canvas(s)
    let els = [genEl(running), genEl(failed)]
    await sync.gens(els)
    sync.moved.add(failed.id)
    els = del(del(els, running.id), failed.id)
    await sync.gens(els)
    expect(cancelled).toEqual([running.id])
    expect((await entries(s)).map((x) => x.action)).toEqual([`delete generated image ${running.id}`])
  })

  it('a name that moves to another image marks what was made from the old one out of date, once', async () => {
    const { s, ref, f1, f2, f3 } = await seeded(fixture)
    const d = structuredClone(s.get())
    const added = markStale(d, ref.asset!, { kind: 'ref', id: ref.id }, '@hero_front now shows another image.', T)
    expect(added.map((m) => m.target.id)).toEqual(expect.arrayContaining([f1.id, f2.id, f3.id]))
    expect(added.every((m) => m.caused_by.kind === 'ref' && m.caused_by.id === ref.id && d.stale[m.id] === m)).toBe(true)
    expect(markStale(d, ref.asset!, { kind: 'ref', id: ref.id }, 'again', T)).toEqual([])
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
  })
})

describe('cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls DELETE /jobs/{id}', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' })
      const jobId = decodeURIComponent(String(url).split('/').pop()!)
      return new Response(JSON.stringify({
        contractVersion: '3', jobId, participantId: MAYA.id, tenantId: MAYA.tenant_id, projectId: 'proj_x', startedBy: `human:${MAYA.id}`, crew: 'wren',
        node: { kind: 'shot', id: 'shot_x' }, nonce: 'n_cancelled01', op: 'clip', quotaClass: 'video', state: 'cancelled', inputHashes: [],
        cost: { currency: 'USD', unknown: true }, kind: 'generated', provider: 'runway', model: 'veo3.1', createdAt: T, updatedAt: T,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { s, j } = await seeded((d) => {
      const j = job(d, 'clip', [], SHA('a'), { state: 'submitted' })
      d.jobs[j.id] = j
      return { j }
    })
    const runner = new JobRunner(new HttpRelay('http://relay.test'), s, new SnapshotStore<UiState>(initialUi()))
    await runner.cancel(j.id)
    expect(calls).toEqual([{ url: `http://relay.test/jobs/${j.id}`, method: 'DELETE' }])
    expect(s.get().jobs[j.id].state).toBe('cancelled')
  })

  it('says "may still be charged" when the provider cannot cancel (results.cancel false)', () => {
    // No routed sheet says so today; a Runway that could not cancel stands in for one.
    const sheets = { ...SHEETS, runway: { ...SHEETS.runway, results: { ...SHEETS.runway.results, cancel: false } } }
    const runway = effectiveConfig('live', 'runway', sheets)
    expect(runway.routing.clip?.[0]).toBe('runway')
    expect(mayStillCharge({ op: 'clip' }, runway, sheets)).toMatch(/Runway .*may still be charged/)
    expect(cancelText({ op: 'clip', provider: 'runway' }, runway, true, sheets)).toMatch(/^Stop making this and remove it\? Runway .*may still be charged/)
    expect(mayStillCharge({ op: 'clip' }, runway)).toBeNull()
    expect(cancelText({ op: 'generate', provider: 'mock' }, runway, false, sheets)).toBe('Stop making this?')
  })
})

