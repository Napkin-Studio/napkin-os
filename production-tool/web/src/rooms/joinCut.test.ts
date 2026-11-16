// Join or cut (features/join-or-cut-shots.clan): the gap toggles write a join or a cut through the one join
// model and Undo takes it back; the tip says what a flip does; a joined run with frames goes as ONE take_refs
// generation with every frame (shot order) beside the characters (characters first), capped at what the model
// carries, the left-out frame named; a text-only joined run goes from the words; a join past its model's
// limits is never sent, and its box offers the model that can and where to cut; a joined box keeps the
// earlier box's model; takes stay filed as the joins change.
import { describe, expect, it, vi } from 'vitest'
import { CONFIGS } from '../contracts/load'
import type { Config, JobInput, ModelChoice, ProductionDocument, Shot } from '../contracts/types'
import { SnapshotDocumentStore } from '../doc/store'
import { makeRuns } from '../jobs/runs'
import { joinHere, setGap, splitHere } from '../jobs/runView'
import { mainScript, mainVideo } from '../model/selectors'
import { MAYA, addRef, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots } from '../test/model'
import { boxLimit, boxPictures, boxWords, flipWords, pickedFor, roomBoxModel, stripGaps, withPick } from './joinCut'
import { boxWindow, inBox, roomBoxes, roomGens, type Box } from './model'

vi.mock('../jobs/assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))

const on: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }
const wan3: ModelChoice = { provider: 'runway', model: 'wan3' }
const omni: ModelChoice = { provider: 'runway', model: 'gemini_omni_flash_1.1' }
const ui = { jobs: {} }

/** Shots of `lengths` seconds, each with a storyboard frame (unless `words`), and @mira's four views linked
 *  into the Script (the live Mira project's shape): the front carries a swatch strip. */
function film(lengths: number[], opts: { words?: boolean; views?: number } = {}) {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, lengths.length)
  // Each shot its own scene, so the crew cuts at every gap and only a person's joins join them.
  shots.forEach((s, i) => Object.assign(s, { duration_s: lengths[i], action: `@mira beat ${i + 1}.`, scene_id: `scene_${i}` }))
  if (!opts.words) shots.forEach((s, i) => addFrame(d, s, SHA('0123456789'[i]), { pick: true }))
  const script = mainScript(d)!.id
  const views = ['front', 'three-quarter', 'side', 'back'].slice(0, opts.views ?? 4).map((v, i) => addRef(d, 'mira', v, SHA('abcd'[i])))
  if (views[0]) views[0].swatches = [{ hex: '#c0392b', name: 'raincoat' }]
  for (const r of views) {
    d.links[`link_${r.id}`] = { id: `link_${r.id}`, v: 1, field_v: {}, from: { kind: 'ref', id: r.id }, to: { kind: 'script', id: script }, role: 'character' } as ProductionDocument['links'][string]
  }
  const store = new SnapshotDocumentStore(d, null, 0)
  const sent: { input: JobInput; modelChoice?: ModelChoice }[] = []
  let k = 0
  const runner = { submit: vi.fn(async (_op: string, input: JobInput, _p: string[], _purpose: unknown, _id?: string, modelChoice?: ModelChoice) => { sent.push({ input, modelChoice }); return `job_${++k}` }) }
  const deps = { relay: {} as never, doc: store as never, ui: { get: () => ({ jobs: {} }) } as never, runner: runner as never }
  const videoId = mainVideo(d)!.id
  const boxes = () => roomBoxes(store.get(), ui, videoId, on)
  return { store, shots, views, deps, sent, videoId, boxes }
}
const shape = (boxes: Box[]) => boxes.map((b) => b.shotIds.length)

describe('the gap toggles', () => {
  it('every gap starts cut when nothing is joined; a flip writes a join, the next a cut, through the one join model', async () => {
    const a = film([3.5, 3.5, 4, 4])
    expect(stripGaps(a.store.get(), a.boxes(), a.videoId, on).map((g) => [g.n, g.joined])).toEqual([[2, false], [3, false], [4, false]])
    await joinHere(a.store, a.videoId, a.shots[1].id)
    expect(shape(a.boxes())).toEqual([2, 1, 1])
    expect(stripGaps(a.store.get(), a.boxes(), a.videoId, on).map((g) => g.joined)).toEqual([true, false, false])
    await joinHere(a.store, a.videoId, a.shots[2].id)
    expect(shape(a.boxes())).toEqual([3, 1])
    await splitHere(a.store, a.videoId, a.shots[1].id)
    expect(shape(a.boxes())).toEqual([1, 2, 1])
  })

  it('a flip changes that gap only, even where the crew joined a scene shown whole across new angles', async () => {
    const a = film([3, 3, 3, 3])
    // One scene, four camera sizes: the crew's own joins are cuts between new angles, yet the planner shows the
    // scene as one box. Cutting before shot 3 must leave shots 1-2 and 3-4 each one video.
    a.store.update((d) => { a.shots.forEach((s, i) => Object.assign(d.shots[s.id], { scene_id: 'scene_one', camera: { size: ['wide', 'close', 'medium', 'wide'][i] } })) })
    expect(shape(a.boxes())).toEqual([4])
    await setGap(a.store, a.videoId, a.shots[2].id, 'cut', a.boxes().map((b) => b.shotIds))
    expect(shape(a.boxes())).toEqual([2, 2])
    await setGap(a.store, a.videoId, a.shots[1].id, 'cut', a.boxes().map((b) => b.shotIds))
    expect(shape(a.boxes())).toEqual([1, 1, 2])
    await setGap(a.store, a.videoId, a.shots[2].id, 'continue', a.boxes().map((b) => b.shotIds))
    expect(shape(a.boxes())).toEqual([1, 3])
    const gaps = stripGaps(a.store.get(), a.boxes(), a.videoId, on)
    expect(flipWords(a.store.get(), ui, a.videoId, on, gaps[0], {}).sub).toBe('One video · 4 shots · 12 s, every frame a guide.')
  })

  it('a gap before an end card is always a cut, and says why', () => {
    const a = film([3, 3])
    a.store.update((d) => { Object.values(d.shots).find((s) => s.id === a.shots[1].id)!.kind = 'end_card' })
    const [g] = stripGaps(a.store.get(), a.boxes(), a.videoId, on)
    expect(g.blocked).toBe('An end card is always its own video')
    expect(flipWords(a.store.get(), ui, a.videoId, on, g, {}).head).toBe('Always a cut: shots 1 and 2')
  })

  it('the tip says what a flip makes, and warns when the join is past the model the box keeps', async () => {
    const a = film([3.5, 3.5, 4, 4])
    await joinHere(a.store, a.videoId, a.shots[1].id)
    const [g12, g23] = stripGaps(a.store.get(), a.boxes(), a.videoId, on)
    expect(flipWords(a.store.get(), ui, a.videoId, on, g12, {})).toEqual({ verb: 'Cut here', head: 'Cut here: two videos', sub: 'Shots 1 and 2 are made apart: shot 1 (3.5 s), then shot 2 (3.5 s).' })
    expect(flipWords(a.store.get(), ui, a.videoId, on, g23, {})).toEqual({ verb: 'Join', head: 'Join: shots 2 and 3 become one video', sub: 'One video · 3 shots · 11 s, every frame a guide.' })
    // Box 1 is on Omni Flash (10 s): joining shot 3 makes 11 s, past it; WAN 3 can.
    const models = withPick({}, a.boxes()[0], omni)
    expect(flipWords(a.store.get(), ui, a.videoId, on, g23, models).warn).toBe('11 s is longer than Gemini Omni Flash 1.1 makes in one go (10 s); WAN 3 can. The box will say so before Make.')
  })
})

describe('what a box says it will make', () => {
  it('frames: "One video · N shots · S s / Every frame used as a guide"; one shot: "Separate video"', async () => {
    const a = film([3.5, 3.5, 4])
    await joinHere(a.store, a.videoId, a.shots[1].id)
    const [b1, b2] = a.boxes()
    expect(boxWords(a.store.get(), b1)).toEqual({ title: 'One video · 2 shots · 7 s', sub: 'Every frame used as a guide' })
    expect(boxWords(a.store.get(), b2)).toEqual({ title: 'Separate video', sub: '4 s' })
  })

  it("text only: \"One video from the words / … with @mira's pictures\"", async () => {
    const a = film([3, 3, 3.5], { words: true })
    await joinHere(a.store, a.videoId, a.shots[1].id)
    const [b1, b2] = a.boxes()
    expect(boxWords(a.store.get(), b1)).toEqual({ title: 'One video from the words', sub: '2 shots · 6 s · with @mira’s pictures' })
    expect(boxWords(a.store.get(), b2)).toEqual({ title: 'Separate video', sub: '3.5 s · its words' })
  })
})

describe('a joined run is one generation with every frame as a guide', () => {
  it('on WAN 3 (10 pictures): take_refs, no frame pinned, the characters first (clean views before the swatch sheet), then every frame in shot order', async () => {
    const a = film([3, 3, 3])
    await joinHere(a.store, a.videoId, a.shots[1].id)
    await joinHere(a.store, a.videoId, a.shots[2].id)
    const failed = await makeRuns(a.deps, { videoId: a.videoId, shotIds: [a.shots[0].id], config: on, again: true, modelChoice: wan3 })
    expect(failed).toEqual([])
    expect(a.sent).toHaveLength(1)
    const { input } = a.sent[0]
    expect(input.mode).toBe('take_refs')
    expect(input.image).toBeUndefined()
    expect(input.shots).toHaveLength(3)
    expect(input.refs!.map((r) => r.role === 'composition' ? r.label : `@${a.store.get().refs[r.id].variant}`)).toEqual(
      ['@three-quarter', '@side', '@back', '@front', 'Shot 1 frame', 'Shot 2 frame', 'Shot 3 frame'])
    expect(input.refs!.filter((r) => r.role === 'composition').map((r) => r.asset.sha256)).toEqual([SHA('0'), SHA('1'), SHA('2')])
  })

  it('on Omni Flash (5 pictures): the characters stay, the frames past the cap go, and the box names the one left out', async () => {
    const a = film([3, 3, 3])
    await joinHere(a.store, a.videoId, a.shots[1].id)
    await joinHere(a.store, a.videoId, a.shots[2].id)
    await makeRuns(a.deps, { videoId: a.videoId, shotIds: [a.shots[0].id], config: on, again: true, modelChoice: omni })
    const refs = a.sent[0].input.refs!
    expect(refs).toHaveLength(5)
    expect(refs.filter((r) => r.role === 'character')).toHaveLength(4)
    expect(refs.filter((r) => r.role === 'composition').map((r) => r.label)).toEqual(['Shot 1 frame'])
    const [box] = a.boxes()
    const lim = boxLimit(a.store.get(), box, omni, on)!
    expect(lim.hard).toBe(false)
    expect(lim.leftOut).toEqual([a.shots[1].id, a.shots[2].id])
    expect(lim.why).toBe('Gemini Omni Flash 1.1 takes 5 pictures. This box has 7: the characters’ first, then the frames in order, so the frames of shots 2 and 3 are left out.')
    expect(lim.alt?.label).toBe('WAN 3')
    // With three views, one frame is left out and named.
    const b = film([3, 3, 3], { views: 3 })
    await joinHere(b.store, b.videoId, b.shots[1].id)
    await joinHere(b.store, b.videoId, b.shots[2].id)
    expect(boxLimit(b.store.get(), b.boxes()[0], omni, on)!.why).toContain('so shot 3’s frame is left out.')
    expect(boxLimit(b.store.get(), b.boxes()[0], wan3, on)).toBeUndefined()
  })

  it('a text-only joined run is one take_refs generation from the words and the characters', async () => {
    const a = film([3, 3], { words: true })
    await joinHere(a.store, a.videoId, a.shots[1].id)
    await makeRuns(a.deps, { videoId: a.videoId, shotIds: [a.shots[0].id], config: on, again: true, modelChoice: wan3 })
    const { input } = a.sent[0]
    expect(input.mode).toBe('take_refs')
    expect(input.image).toBeUndefined()
    expect(input.refs!.every((r) => r.role === 'character')).toBe(true)
    expect(input.cuts!.map((c) => c.text)).toEqual(['@mira beat 1.', '@mira beat 2.'])
  })

  it('a single-shot box still starts on its frame', async () => {
    const a = film([3, 3])
    await splitHere(a.store, a.videoId, a.shots[1].id)
    await makeRuns(a.deps, { videoId: a.videoId, shotIds: [a.shots[0].id], config: on, again: true, modelChoice: wan3 })
    expect(a.sent[0].input.mode).not.toBe('take_refs')
    expect(a.sent[0].input.image?.sha256).toBe(SHA('0'))
  })
})

describe('limits before Make', () => {
  it('a join longer than the box keeps on its model stays one box, says so, offers the model that can and where to cut, and is never sent', async () => {
    const a = film([3.5, 3.5, 4, 4], { views: 2 })
    await joinHere(a.store, a.videoId, a.shots[1].id)
    let models = withPick({}, a.boxes()[0], omni)
    await joinHere(a.store, a.videoId, a.shots[2].id)
    await joinHere(a.store, a.videoId, a.shots[3].id)
    const [box] = a.boxes()
    expect(box.shotIds).toHaveLength(4) // a person's join is never split by the planner
    // The joined box keeps the earlier box's model.
    expect(roomBoxModel(a.store.get(), box, on, models)).toEqual(omni)
    const lim = boxLimit(a.store.get(), box, omni, on)!
    expect(lim.hard).toBe(true)
    expect(lim.why).toBe('15 s is longer than Gemini Omni Flash 1.1 makes in one go (10 s). It also takes 5 pictures, so shot 4’s frame would be left out.')
    expect(lim.alt).toEqual({ choice: wan3, label: 'WAN 3', maxS: 15 })
    expect(lim.cutBefore).toBe(a.shots[2].id)
    // Use WAN 3: the box is on it and fits.
    models = withPick(models, box, lim.alt!.choice)
    expect(pickedFor(models, box)).toEqual(wan3)
    expect(boxLimit(a.store.get(), box, roomBoxModel(a.store.get(), box, on, models), on)).toBeUndefined()
    // Cut before shot 3: two boxes, the first keeps Omni and fits it.
    await splitHere(a.store, a.videoId, lim.cutBefore!)
    expect(shape(a.boxes())).toEqual([2, 2])
    const first = a.boxes()[0]
    expect(boxLimit(a.store.get(), first, roomBoxModel(a.store.get(), first, on, withPick({}, first, omni)), on)).toBeUndefined()
  })

  it('more shots than any model makes in one go: no model to offer, only the cut; the planner never sends it', async () => {
    const a = film([1, 1, 1, 1, 1, 1, 1], { views: 1 })
    for (const s of a.shots.slice(1)) await joinHere(a.store, a.videoId, s.id)
    const [box] = a.boxes()
    expect(box.shotIds).toHaveLength(7)
    const lim = boxLimit(a.store.get(), box, wan3, on)!
    expect(lim.why).toBe('7 shots is more than WAN 3 makes in one go (6).')
    expect(lim.alt).toBeUndefined()
    expect(lim.cutBefore).toBe(a.shots[6].id)
    const failed = await makeRuns(a.deps, { videoId: a.videoId, shotIds: [a.shots[0].id], config: on, again: true, modelChoice: wan3 })
    expect(a.sent).toHaveLength(0)
    expect(failed).toEqual(['Shots 1–7: 7 shots is more than WAN 3 makes in one go (6). Cut it into two videos first.'])
  })

  it('what Fin sends lists the characters (clean views first), then Image k for each shot', async () => {
    const a = film([3, 3], { views: 2 })
    await joinHere(a.store, a.videoId, a.shots[1].id)
    expect(boxPictures(a.store.get(), a.boxes()[0]).map((p) => p.label)).toEqual(['@mira · three-quarter', '@mira · front', 'Image 1', 'Image 2'])
  })
})

describe('takes stay filed when the joins change', () => {
  it("a take of shots 1-3 made together stays one of each box's takes when shot 3 is cut off, and plays only that box's window", async () => {
    const a = film([3, 3, 3])
    await joinHere(a.store, a.videoId, a.shots[1].id)
    await joinHere(a.store, a.videoId, a.shots[2].id)
    a.store.update((d) => {
      d.generations.gen_t = { id: 'gen_t', v: 1, field_v: {}, kind: 'together', shot_ids: a.shots.map((s: Shot) => s.id), asset: SHA('v'), duration_s: 9, state: 'ready', created_at: '2026-11-16T10:00:00Z', by: 'human:x',
        segments: a.shots.map((s: Shot, i: number) => ({ shot_id: s.id, in_s: i * 3, out_s: i * 3 + 3, by: 'detected' as const })) } as ProductionDocument['generations'][string]
    })
    const g = () => roomGens(a.store.get(), ui, a.videoId, a.boxes()).find((x) => x.id === 'gen_t')!
    expect(inBox(g(), a.boxes()[0].key)).toBe(true)
    await splitHere(a.store, a.videoId, a.shots[2].id)
    const [b12, b3] = a.boxes()
    expect([inBox(g(), b12.key), inBox(g(), b3.key)]).toEqual([true, true])
    expect(boxWindow(g(), b3)).toEqual({ inS: 6, outS: 9 })
  })
})
