// A film's lengths and shapes (features/campaign-formats.clan, phases 5 and 6): the window and crop case
// table shared with the relay, the master's shots as the plan reads them, a size's edit and captions, the
// render request (windows, crops, a reframed shot's own clip, type timed in the film, captions on the
// social shapes only), and the free and paid jobs' purposes.

import { describe, expect, it } from 'vitest'
import cases from '../../../contracts/examples/cutdown-cases.json'
import type { CutdownPlan, FormatSet, ProductionDocument, PxBox, Size } from '../contracts/types'
import { isFreeRequest } from '../jobs/runner'
import { mainVideo } from '../model/selectors'
import { purposeOf, purposeWords } from '../model/purpose'
import type { Relay } from '../relay/types'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addShots, addTake, job } from '../test/model'
import { alephRatio, captionLayers, cropKeys, edlFor, filmLength, fitWindows, isSocialShape, masterShots, reframeKey, reframesOf } from './film'
import { cutdownInput, filmLayers } from './filmJobs'
import { checksFor } from './checks'
import { fileName } from './exportZip'

type FitCase = { name: string; shots: { shotId: string; inS: number; outS: number; takeS?: number; endCard?: boolean }[]; keep: string[]; lengthS: number; windows: { shotId: string; inS: number; outS: number }[]; over: number }
type CropCase = { name: string; take: { w: number; h: number }; aspect: { w: number; h: number }; subjects: PxBox[]; keys: { at: number; box: PxBox }[]; cuts: boolean }

describe('the relay\'s maths, from one case table', () => {
  for (const c of (cases.cases.fit as FitCase[])) {
    it(`windows: ${c.name}`, () => {
      const got = fitWindows(c.shots, new Set(c.keep), c.lengthS)
      expect(got.windows.map((w) => w.shotId)).toEqual(c.windows.map((w) => w.shotId))
      got.windows.forEach((w, i) => {
        expect(w.inS).toBeCloseTo(c.windows[i].inS, 3)
        expect(w.outS).toBeCloseTo(c.windows[i].outS, 3)
      })
      expect(got.over).toBeCloseTo(c.over, 3)
    })
  }
  for (const c of (cases.cases.crop as CropCase[])) {
    it(`crops: ${c.name}`, () => {
      const got = cropKeys(c.take, c.aspect, c.subjects)
      expect(got.cuts).toBe(c.cuts)
      expect(got.keys.map((k) => k.at)).toEqual(c.keys.map((k) => k.at))
      got.keys.forEach((k, i) => (['x', 'y', 'w', 'h'] as const).forEach((p) => expect(k.box[p]).toBeCloseTo(c.keys[i].box[p], 2)))
    })
  }
  it('Aleph 2 makes 4:5 at 3:4; captions are on the social shapes only', () => {
    expect(alephRatio({ w: 1080, h: 1350 })).toBe('3:4')
    expect(alephRatio({ w: 1080, h: 1920 })).toBe('9:16')
    expect(isSocialShape({ w: 1080, h: 1920 }) && isSocialShape({ w: 1080, h: 1350 }) && isSocialShape({ w: 1080, h: 1080 })).toBe(true)
    expect(isSocialShape({ w: 1920, h: 1080 })).toBe(false)
  })
})

const CDN = 'https://cdn.test/out'

/** A 30 s master of ten 3 s shots, each with its take (4 s, 1920x1080, on the relay), shot 3 with a spoken line. */
function master() {
  const store = snapshotDoc(MAYA)
  const d = structuredClone(store.get()) as ProductionDocument
  const shots = addShots(d, 10)
  shots.forEach((s) => { s.duration_s = 3 })
  for (const [i, s] of shots.entries()) {
    const sha = SHA(String.fromCharCode(97 + i))
    addTake(d, s, sha, job(d, 'clip', [], sha), { pick: true })
    d.assets[sha] = { ...d.assets[sha], kind: 'video', mime: 'video/mp4', w: 1920, h: 1080, duration_s: 4, locations: [`${CDN}/${sha}`] }
  }
  const beat = Object.values(d.beats ?? {}).find((b) => b.shot_id === shots[2].id)
  d.beats = { ...d.beats, beat_01K7C00000000000000000BT01: { ...(beat ?? {}), id: 'beat_01K7C00000000000000000BT01', v: 1, field_v: {}, shot_id: shots[2].id, rank: 'm', at_s: 0.5, kind: 'line', speaker: 'MAYA', text: 'I never miss the first light.' } as never }
  const video = mainVideo(d)!
  return { d, shots, video, deps: { relay: null as unknown as Relay, doc: { get: () => d } } as never }
}

const PLAN = (shotIds: string[]): CutdownPlan => ({
  lengths: [{ lengthS: 15, beats: shotIds.map((id, i) => ({ shotId: id, keep: [0, 2, 4, 7, 9].includes(i), why: i === 2 ? 'The line.' : 'Kept.', inS: 0, outS: 2.5 })) }],
  crops: shotIds.map((id, i) => ({ shotId: id, aspect: { w: 1080, h: 1920 }, keys: [{ at: 0, box: { x: 656.25, y: 0, w: 607.5, h: 1080 } }], cuts: i === 4 })),
})

describe('the master as Dex reads it', () => {
  it('every shot with its window, its take and its spoken line, in cut order', () => {
    const { d, shots, video } = master()
    const m = masterShots(d, video.id)
    expect(m.map((s) => s.shotId)).toEqual(shots.map((s) => s.id))
    expect(m[0]).toMatchObject({ inS: 0, outS: 3, takeS: 4, takeSize: { w: 1920, h: 1080 } })
    expect(m[2].spoken).toBe('I never miss the first light.')
  })
})

describe('a 15 s at 9:16', () => {
  function sized() {
    const ctx = master()
    const ms = masterShots(ctx.d, ctx.video.id)
    const plan = PLAN(ms.map((s) => s.shotId))
    const beats = plan.lengths[0].beats.map((b) => ({ shot_id: b.shotId, keep: b.keep, why: b.why, by: 'dex' as const }))
    const shape = { w: 1080, h: 1920 }
    const { edl, over } = edlFor(ms, beats, 15, shape, plan.crops)
    const set: FormatSet = { id: 'fset_01K7C00000000000000000FS01', v: 1, field_v: {}, master: { kind: 'video', id: ctx.video.id, w: 1920, h: 1080 }, pack: { pack_id: 'film', pack_version: '1' }, copy: { line: 'First light. First sip.' } }
    const size: Size = { id: 'size_01K7C00000000000000000SZ01', v: 1, field_v: {}, set_id: set.id, rank: 'm', format: { pack_id: 'film', pack_version: '1', format_id: 'film-9x16' },
      aspect: shape, delivery: { width: 1080, height: 1920 }, method: 'reframe', media: 'video', length_s: 15, edl, beats }
    ctx.d.format_sets = { [set.id]: set }
    ctx.d.sizes = { [size.id]: size }
    return { ...ctx, ms, set, size, over }
  }
  it('keeps the planned shots, windows fitted to 15 s with the end card, each cropped at 9:16', () => {
    const { size, ms, over } = sized()
    expect(size.edl!.map((w) => w.shot_id)).toEqual([0, 2, 4, 7, 9].map((i) => ms[i].shotId))
    expect(filmLength(size.edl)).toBeCloseTo(15, 2)
    expect(over).toBeCloseTo(0, 3)
    expect(size.edl![0]).toMatchObject({ in_s: 0, out_s: 2.5, crop: { x: 656.25, w: 607.5 }, crop_by: 'rule', take_size: { w: 1920, h: 1080 } })
  })
  it('captions each spoken line in its time in the cut, and Jude counts them for sound off', () => {
    const { d, size, set } = sized()
    const caps = captionLayers(d, size.edl!, { x: 0.1, y: 0.6, w: 0.8, h: 0.08 })
    expect(caps).toHaveLength(1)
    expect(caps[0]).toMatchObject({ kind: 'captions', text: 'I never miss the first light.', fromS: 3, toS: 5 }) // shot 3 starts at 2.5 s, its line 0.5 s in
    expect(checksFor(size, set, d).sound_off?.result).toBe('pass')
    expect(checksFor(size, set, d).end_card?.result).toBe('pass') // stitch draws the card at its size
    expect(checksFor({ ...size, layers: { captions: { hidden: true } } }, set, d).sound_off?.result).toBe('flag')
  })
  it('the render request: windows, crops, a reframed shot\'s own clip filled from its middle, type timed, no words for a model', async () => {
    const { d, size, set, ms, deps } = sized()
    const key = reframeKey(ms[4].takeId!, size.delivery)
    set.reframes = { [key]: { take_id: ms[4].takeId!, shot_id: ms[4].shotId, aspect: { w: 1080, h: 1920 }, method: 'outpaint', job_id: 'job_01K7C00000000000000000JB01' } }
    expect(reframesOf(set, size)).toEqual([{ key, done: false }])
    const out = SHA('z')
    d.assets[out] = { sha256: out, kind: 'video', mime: 'video/mp4', origin: 'mock', locations: [`${CDN}/${out}`] } as never
    set.reframes[key].asset = out
    set.reframes[key].size = { w: 612, h: 1088 }
    expect(reframesOf(set, size)).toEqual([{ key, done: true }])
    const input = await cutdownInput(deps, set, size)
    const cut = input.cutdown!
    expect(cut.step).toBe('render')
    expect(cut.clips!.map((c) => c.asset.sha256)).toEqual([0, 2, 4, 7, 9].map((i) => (i === 4 ? out : ms[i].takeAsset)))
    expect(cut.clips![0]).toMatchObject({ inS: 0, outS: 2.5, takeSize: { w: 1920, h: 1080 }, crop: { x: 656.25 } })
    expect(cut.clips![2]).toEqual({ asset: { sha256: out, url: `${CDN}/${out}`, mime: 'video/mp4' }, inS: 0, outS: 2.5, takeSize: { w: 612, h: 1088 } })
    expect(cut).toMatchObject({ endCard: true, fadeOutS: 0.5, lengthS: 15 })
    const line = cut.layers!.find((l) => l.kind === 'line')!
    expect(line).toMatchObject({ text: 'First light. First sip.', fromS: 9.5, toS: 12.5 }) // the last 3 s of the clips
    expect(cut.layers!.some((l) => l.kind === 'captions')).toBe(true)
  })
  it('the TV shape carries no captions unless a person turns them on', async () => {
    const { size, set, deps } = sized()
    const tv = { ...size, delivery: { width: 1920, height: 1080 }, aspect: { w: 1920, h: 1080 }, format: { ...size.format, format_id: 'film-16x9' } }
    expect((await filmLayers(deps, set, tv)).some((l) => l.kind === 'captions')).toBe(false)
    expect((await filmLayers(deps, set, { ...tv, layers: { captions: { hidden: false } } })).some((l) => l.kind === 'captions')).toBe(true)
  })
  it('exports as an MP4 named by its length', () => {
    const { size } = sized()
    expect(fileName('First Light', size, 1080, 1920)).toBe('first-light_film-9x16_15s_1080x1920.mp4')
  })
})

describe('the jobs', () => {
  it('the plan and the renders are free; an outpaint is paid', () => {
    expect(isFreeRequest({ op: 'cutdown', input: { cutdown: { step: 'plan' } } })).toBe(true)
    expect(isFreeRequest({ op: 'cutdown', input: { cutdown: { step: 'render' } } })).toBe(true)
    expect(isFreeRequest({ op: 'cutdown', input: { cutdown: { step: 'outpaint' } } })).toBe(false)
  })
  it('a reframe and a plan land again after a reload, from their purpose', () => {
    const r = { for: 'reframe' as const, setId: 'fset_01K7C00000000000000000FS01', key: 'take_01K7C00000000000000000TK01@1080x1920' }
    expect(purposeOf({ purpose: purposeWords(r), node: { kind: 'format_set', id: r.setId }, inputs: [] })).toEqual(r)
    expect(purposeOf({ purpose: 'film_plan', node: { kind: 'video', id: 'video_01K7C00000000000000000VD01' }, inputs: [] })).toEqual({ for: 'film_plan', videoId: 'video_01K7C00000000000000000VD01' })
  })
})
