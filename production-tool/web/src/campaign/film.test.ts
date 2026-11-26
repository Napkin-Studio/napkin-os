// A film's lengths and shapes (features/campaign-formats.clan, phases 5 and 6): the window and crop case
// table shared with the relay, the master's shots as the plan reads them, a size's edit and captions, the
// render request (windows, crops, a reframed shot's own clip, type timed in the film, captions on the
// social shapes only), and the free and paid jobs' purposes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetMedia, setMediaBase } from '../lib/media'
import cases from '../../../contracts/examples/cutdown-cases.json'
import type { CutdownPlan, FormatSet, ProductionDocument, PxBox, Size } from '../contracts/types'
import { isFreeRequest } from '../jobs/runner'
import { mainVideo } from '../model/selectors'
import { purposeOf, purposeWords } from '../model/purpose'
import type { Relay } from '../relay/types'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addShots, addTake, job } from '../test/model'
import { alephRatio, captionLayers, cropKeys, cutsBlocked, edlFor, filmLength, filmSeconds, fitWindows, isSocialShape, masterShots, reframeKey, reframesOf, startLengths } from './film'
import { cutdownInput, filmLayers, withoutRepeats } from './filmJobs'
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

// The relay's files are found by their hash at the media base (lib/media.ts); out/ answers for what it made.
beforeEach(() => {
  setMediaBase('https://cdn.test')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: String(url).startsWith('https://cdn.test/out/') }) as Response))
})
afterEach(() => { vi.unstubAllGlobals(); forgetMedia() })

/** A 30 s master of ten 3 s shots, each with its take (4 s, 1920x1080, on the relay), shot 3 with a spoken line. */
function master() {
  const store = snapshotDoc(MAYA)
  const d = structuredClone(store.get()) as ProductionDocument
  const shots = addShots(d, 10)
  shots.forEach((s) => { s.duration_s = 3 })
  for (const [i, s] of shots.entries()) {
    const sha = SHA(String.fromCharCode(97 + i))
    addTake(d, s, sha, job(d, 'clip', [], sha), { pick: true })
    d.assets[sha] = { ...d.assets[sha], kind: 'video', mime: 'video/mp4', w: 1920, h: 1080, duration_s: 4 }
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

describe('the master as the Director agent reads it', () => {
  it('every shot with its window, its take and its spoken line, in cut order', () => {
    const { d, shots, video } = master()
    const m = masterShots(d, video.id)
    expect(m.map((s) => s.shotId)).toEqual(shots.map((s) => s.id))
    expect(m[0]).toMatchObject({ inS: 0, outS: 3, takeS: 4, takeSize: { w: 1920, h: 1080 } })
    expect(m[2].spoken).toBe('MAYA: I never miss the first light.')
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
  it('keeps the planned shots, windows fitted to 15 s (no studio card after them), each cropped at 9:16', () => {
    const { size, ms, over } = sized()
    expect(size.edl!.map((w) => w.shot_id)).toEqual([0, 2, 4, 7, 9].map((i) => ms[i].shotId))
    expect(filmLength(size.edl)).toBeCloseTo(15, 2)
    expect(over).toBeCloseTo(0, 3)
    expect(size.edl![0]).toMatchObject({ in_s: 0, out_s: 3, crop: { x: 656.25, w: 607.5 }, crop_by: 'rule', take_size: { w: 1920, h: 1080 } })
  })
  it('captions each spoken line in its time in the cut, and the Review agent counts them for sound off', () => {
    const { d, size, set } = sized()
    const caps = captionLayers(d, size.edl!, { x: 0.1, y: 0.6, w: 0.8, h: 0.08 })
    expect(caps).toHaveLength(1)
    expect(caps[0]).toMatchObject({ kind: 'captions', text: 'I never miss the first light.', fromS: 3.5, toS: 6 }) // shot 2 starts at 3 s, its line 0.5 s in
    expect(checksFor(size, set, d).sound_off?.result).toBe('pass')
    expect(checksFor(size, set, d).end_card?.result).toBe('pass') // stitch draws the card at its size
    expect(checksFor({ ...size, layers: { captions: { hidden: true } } }, set, d).sound_off?.result).toBe('flag')
  })
  it('the render request: windows, crops, a reframed shot\'s own clip filled from its middle, type timed, no words for a model', async () => {
    const { d, size, set, ms, deps } = sized()
    const key = reframeKey(ms[4].takeId!, size.delivery)
    set.reframes = { [key]: { generation_id: ms[4].takeId!, shot_id: ms[4].shotId, aspect: { w: 1080, h: 1920 }, method: 'outpaint', job_id: 'job_01K7C00000000000000000JB01' } }
    expect(reframesOf(set, size)).toEqual([{ key, done: false }])
    const out = SHA('z')
    d.assets[out] = { sha256: out, kind: 'video', mime: 'video/mp4', origin: 'mock' } as never
    set.reframes[key].asset = out
    set.reframes[key].size = { w: 612, h: 1088 }
    expect(reframesOf(set, size)).toEqual([{ key, done: true }])
    const input = await cutdownInput(deps, set, size)
    const cut = input.cutdown!
    expect(cut.step).toBe('render')
    expect(cut.clips!.map((c) => c.asset.sha256)).toEqual([0, 2, 4, 7, 9].map((i) => (i === 4 ? out : ms[i].takeAsset)))
    expect(cut.clips![0]).toMatchObject({ inS: 0, outS: 3, takeSize: { w: 1920, h: 1080 }, crop: { x: 656.25 } })
    expect(cut.clips![2]).toEqual({ asset: { sha256: out, url: `${CDN}/${out}`, mime: 'video/mp4' }, inS: 0, outS: 3, takeSize: { w: 612, h: 1088 } })
    expect(cut).toMatchObject({ endCard: true, fadeOutS: 0.5, lengthS: 15 })
    const line = cut.layers!.find((l) => l.kind === 'line')!
    expect(line).toMatchObject({ text: 'First light. First sip.', toS: 15 }) // the last 2.5 s of the clips (15 s now: no studio card after them), after any caption (R5-F6)
    expect(line.fromS).toBeGreaterThanOrEqual(10)
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

describe('the words shown once (re-test N-G)', () => {
  const box = { x: 0.1, y: 0.8, w: 0.8, h: 0.1 }
  const line = { kind: 'line' as const, box, text: 'Lumo. Calm, on.', fromS: 0, toS: 2 }
  it('a caption of the same words as the line on screen goes; other captions stay', () => {
    const caps = [
      { kind: 'captions' as const, box, text: 'lumo — calm, on', fromS: 0, toS: 2 },
      { kind: 'captions' as const, box, text: 'Every night, a little light.', fromS: 0, toS: 2 },
    ]
    expect(withoutRepeats(caps, [line]).map((c) => c.text)).toEqual(['Every night, a little light.'])
  })
  it('one that starts before the line ends where the line starts; one at another time stays whole', () => {
    const late = { ...line, fromS: 5, toS: 8 }
    const caps = [{ kind: 'captions' as const, box, text: 'Lumo. Calm, on.', fromS: 3, toS: 8 }, { kind: 'captions' as const, box, text: 'Lumo. Calm, on.', fromS: 0, toS: 2 }]
    expect(withoutRepeats(caps, [late]).map((c) => [c.fromS, c.toS])).toEqual([[3, 5], [0, 2]])
  })
})

describe('the film\'s own length in Make all sizes (UAT 2026-11-18, U6: "Film · 15 s" for a 12.7 s cut)', () => {
  const shot = (n: number, inS: number, outS: number, endCard = false) => ({ shotId: `shot_${n}`, number: n, inS, outS, ...(endCard ? { endCard } : {}) })
  it('is its shots as cut now, without the end card shot', () => {
    expect(filmSeconds([shot(1, 0, 4), shot(2, 0.5, 4.2), shot(3, 0, 5), shot(4, 0, 2.5, true)], 15)).toBe(12.7)
  })
  it('is the render\'s length (or target) when no shot has a take: it carries no studio card', () => {
    expect(filmSeconds([shot(4, 0, 2.5, true)], 15.2)).toBeCloseTo(15.2)
    expect(filmSeconds([])).toBe(0)
  })
})

describe('Make all sizes picks the shapes the brief asks for (UAT 2026-11-21)', () => {
  it('reads its format and mandatories', async () => {
    const { briefShapes } = await import('./film')
    expect(briefShapes({ mandatories: ['Deliver in 16:9, 9:16 and 1:1.'] })).toEqual(['film-16x9', 'film-9x16', 'film-1x1'])
    expect(briefShapes({ format: '4x5 feed and 1 : 1' })).toEqual(['film-4x5', 'film-1x1'])
    expect(briefShapes({ format: '30 s TV spot' })).toEqual(['film-16x9', 'film-9x16'])
    expect(briefShapes(undefined)).toEqual(['film-16x9', 'film-9x16'])
  })
})

describe('a short size keeps its picture and says its line once (UAT round 3, R3-F12)', () => {
  it('the film\'s card is the last picture, no studio card after it; on a very short size it shortens to keep the picture', async () => {
    const { cardLength, MIN_PICTURE_S } = await import('./film')
    expect(cardLength(6, 2.5)).toBe(2)
    expect(cardLength(15, 2.5)).toBe(2)
    expect(cardLength(6, undefined)).toBe(0)
    expect(cardLength(4, 2.5)).toBe(1) // 4 - 1.333 would leave 2.667 of picture: the card goes to 1 s, the picture gets 3
    expect(4 - cardLength(4, 2.5)).toBeLessThan(MIN_PICTURE_S)
    const { windows } = fitWindows([{ shotId: 'a', inS: 0, outS: 5, takeS: 5 }, { shotId: 'e', inS: 0, outS: 2.5, endCard: true }], new Set(['a']), 6)
    expect(windows[0].outS - windows[0].inS).toBeCloseTo(4, 3) // 6 s less the film's own 2 s card: no studio card
  })
  it('a 6 s size with the film\'s card: its card is the last picture, and the line is not burnt in as well', async () => {
    const ctx = master()
    const { d, shots, video, deps } = ctx
    shots[9].kind = 'end_card'
    shots[9].action = 'End card with the super: "Quietboil. Let them sleep."'
    shots[9].duration_s = 2.5
    const ms = masterShots(d, video.id)
    const beats = ms.filter((s) => !s.endCard).map((s, i) => ({ shot_id: s.shotId, keep: i === 0 || i === 8, why: 'Kept.', by: 'dex' as const }))
    const shape = { w: 1080, h: 1920 }
    const { edl } = edlFor(ms, beats, 6, shape, [])
    expect(edl.reduce((a, w) => a + (w.out_s - w.in_s), 0)).toBeCloseTo(4, 2)
    const set: FormatSet = { id: 'fset_01K7C00000000000000000FS01', v: 1, field_v: {}, master: { kind: 'video', id: video.id, w: 1920, h: 1080 }, pack: { pack_id: 'film', pack_version: '1' }, copy: { line: 'Quietboil. Let them sleep.' } }
    const size: Size = { id: 'size_01K7C00000000000000000SZ01', v: 1, field_v: {}, set_id: set.id, rank: 'm', format: { pack_id: 'film', pack_version: '1', format_id: 'film-9x16' },
      aspect: shape, delivery: { width: 1080, height: 1920 }, method: 'reframe', media: 'video', length_s: 6, edl, beats }
    d.format_sets = { [set.id]: set }
    d.sizes = { [size.id]: size }
    const cut = (await cutdownInput(deps, set, size)).cutdown!
    expect(cut.clientCard).toMatchObject({ headline: 'Quietboil', line: 'Let them sleep.', s: 2 })
    expect('studioS' in cut).toBe(false)
    expect((await filmLayers(deps, set, size)).some((l) => l.kind === 'line')).toBe(true) // the size's own line…
    expect((cut.layers ?? []).some((l) => l.kind === 'line')).toBe(false) // …left to the card
    expect(cut.lengthS).toBe(6)
  })
  it('only the words the card says leave the picture; a logo and the spoken captions stay', async () => {
    const { withoutCardWords } = await import('./filmJobs')
    const box = { x: 0, y: 0, w: 1, h: 0.1 }
    const laid = [
      { kind: 'line' as const, box, text: 'Quietboil. Let them sleep.' },
      { kind: 'legal' as const, box, text: 'Terms apply.' },
      { kind: 'logo' as const, box },
      { kind: 'captions' as const, box, text: 'Let them sleep.' },
    ]
    expect(withoutCardWords(laid as never, { headline: 'Quietboil', line: 'Let them sleep.' }).map((l) => l.kind)).toEqual(['legal', 'logo', 'captions'])
    expect(withoutCardWords(laid as never, undefined)).toHaveLength(4)
  })
  it('one version is "1 version"', async () => {
    const { versionsWord } = await import('./film')
    expect([versionsWord(1), versionsWord(2), versionsWord(0)]).toEqual(['1 version', '2 versions', '0 versions'])
  })
})

describe('the line and the captions apart (UAT round 5, R5-F6)', () => {
  const box = { x: 0.035, y: 0.85, w: 0.93, h: 0.11 }
  it('round 5\'s 6 s 9:16: 3.5 s of picture, "Good boy." captioned 0-1.48 s: the line holds 1.48-3.5 s, not 0.5-3.5 s', async () => {
    const { linesApart, LINE_S } = await import('./filmJobs')
    expect(LINE_S).toBe(2.5)
    const line = { kind: 'line' as const, box, text: 'Quietboil. Let them sleep.', fromS: 3.5 - LINE_S, toS: 3.5 }
    const cap = { kind: 'captions' as const, box: { x: 0.06, y: 0.6, w: 0.88, h: 0.12 }, text: 'Good boy.', fromS: 0, toS: 1.48 }
    const out = linesApart([line], [cap], 3.5)
    expect(out.laid[0]).toMatchObject({ fromS: 1.48, toS: 3.5 })
    expect(out.caps[0]).toMatchObject({ fromS: 0, toS: 1.48 })
  })
  it('a caption too near the end ends where the line starts; a late one ends the line; the logo is left alone', async () => {
    const { linesApart } = await import('./filmJobs')
    const line = { kind: 'line' as const, box, text: 'End.', fromS: 3.5, toS: 6 }
    const near = { kind: 'captions' as const, box, text: 'Hi.', fromS: 2.5, toS: 5 }
    expect(linesApart([line], [near], 6).caps[0]).toMatchObject({ fromS: 2.5, toS: 3.5 })
    const late = { kind: 'captions' as const, box, text: 'Hi.', fromS: 5.5, toS: 6 }
    const ended = linesApart([{ ...line, fromS: 2 }], [late], 6)
    expect(ended.laid[0]).toMatchObject({ fromS: 2, toS: 5.5 })
    const logo = { kind: 'logo' as const, box, fromS: 0, toS: 3 }
    expect(linesApart([logo as never], [near], 6).laid[0]).toMatchObject({ fromS: 0, toS: 3 })
  })
})

describe('a size keeps its spoken-line caption and says the end line once (UAT walkthrough 2026-11-21, R6-F1)', () => {
  const setup = async (withCard: boolean) => {
    const ctx = master()
    const { d, shots, video, deps } = ctx
    if (withCard) {
      shots[9].kind = 'end_card'
      shots[9].action = 'End card with the super: "Quietboil. Let them sleep."'
      shots[9].duration_s = 2.5
    }
    const ms = masterShots(d, video.id)
    const beats = ms.filter((s) => !s.endCard).map((s, i) => ({ shot_id: s.shotId, keep: i === 2 || i === 8, why: 'Kept.', by: 'dex' as const }))
    const shape = { w: 1080, h: 1920 }
    const { edl } = edlFor(ms, beats, 6, shape, [])
    const set: FormatSet = { id: 'fset_01K7C00000000000000000FS01', v: 1, field_v: {}, master: { kind: 'video', id: video.id, w: 1920, h: 1080 }, pack: { pack_id: 'film', pack_version: '1' }, copy: { line: 'Quietboil. Let them sleep.' } }
    const size: Size = { id: 'size_01K7C00000000000000000SZ01', v: 1, field_v: {}, set_id: set.id, rank: 'm', format: { pack_id: 'film', pack_version: '1', format_id: 'film-9x16' },
      aspect: shape, delivery: { width: 1080, height: 1920 }, method: 'reframe', media: 'video', length_s: 6, edl, beats }
    d.format_sets = { [set.id]: set }
    d.sizes = { [size.id]: size }
    return { deps, set, size }
  }
  it('the card says the line: the 9:16 keeps the caption of the spoken line whole, and the line is not also a super', async () => {
    const { deps, set, size } = await setup(true)
    const cut = (await cutdownInput(deps, set, size)).cutdown!
    const caps = (cut.layers ?? []).filter((l) => l.kind === 'captions')
    expect(caps.length).toBeGreaterThan(0)
    expect(caps[0].text).toContain('I never miss the first light')
    expect((caps[0].toS ?? 0) - (caps[0].fromS ?? 0)).toBeGreaterThan(1)
    expect((cut.layers ?? []).some((l) => l.kind === 'line')).toBe(false)
    expect(cut.clientCard).toMatchObject({ line: 'Let them sleep.' })
  })
  it('no card says the line: the caption stays and the line is never on screen with it', async () => {
    const { deps, set, size } = await setup(false)
    const cut = (await cutdownInput(deps, set, size)).cutdown!
    const layers = cut.layers ?? []
    const caps = layers.filter((l) => l.kind === 'captions')
    expect(caps.length).toBeGreaterThan(0)
    for (const l of layers.filter((x) => x.kind === 'line' || x.kind === 'legal')) {
      for (const c of caps) expect((l.toS ?? 99) <= (c.fromS ?? 0) + 1e-6 || (c.toS ?? 99) <= (l.fromS ?? 0) + 1e-6).toBe(true)
    }
  })
  it('R6-F1\'s numbers: a caption starting 0.48 s into the line is kept and the line gives way', async () => {
    const { linesApart } = await import('./filmJobs')
    const box = { x: 0, y: 0.85, w: 1, h: 0.1 }
    const line = { kind: 'line' as const, box, text: 'Quietboil. Let them sleep.', fromS: 0.52, toS: 3.02 }
    const cap = { kind: 'captions' as const, box, text: 'Good boy.', fromS: 1, toS: 3.02 }
    const out = linesApart([line], [cap], 3.02)
    expect(out.caps).toEqual([cap])
    expect(out.laid).toEqual([])
  })
})

describe('a crop the plan says cuts the subject is fitted whole (UAT round 5, R5-F6)', () => {
  it('round 5\'s shot 5 at 9:16: the box holds the whole 1190 px subject, not the 607 px crop', async () => {
    const { edlFor, fitBox } = await import('./film')
    const take = { w: 1920, h: 1080 }
    const subject = { x: 652.8, y: 54, w: 1190.4, h: 1004.4 }
    const box = fitBox(take, { w: 9, h: 16 }, subject)
    expect(box.x).toBeLessThanOrEqual(subject.x)
    expect(box.x + box.w).toBeGreaterThanOrEqual(subject.x + subject.w)
    expect(box.h).toBe(1080)
    const shots = [{ shotId: 'shot_5', number: 5, inS: 0, outS: 1.48, takeS: 2.02, takeId: 'gen_5', takeSize: take }, { shotId: 'shot_7', number: 7, inS: 0.958, outS: 2.978, takeS: 3, takeId: 'gen_7', takeSize: take }]
    const crops = [
      { shotId: 'shot_5', aspect: { w: 9, h: 16 }, keys: [{ at: 0, box: { x: 944.25, y: 0, w: 607.5, h: 1080 } }], subject, cuts: true },
      { shotId: 'shot_7', aspect: { w: 9, h: 16 }, keys: [{ at: 0, box: { x: 627.45, y: 0, w: 607.5, h: 1080 } }], subject: { x: 691.2, y: 140.4, w: 480, h: 777.6 }, cuts: false },
    ]
    const beats = [{ shot_id: 'shot_5', keep: true }, { shot_id: 'shot_7', keep: true }] as never
    const { edl } = edlFor(shots as never, beats, 6, { w: 1080, h: 1920 }, crops)
    expect(edl[0].crop).toEqual(box)
    expect(edl[1].crop).toEqual({ x: 627.45, y: 0, w: 607.5, h: 1080 })
  })
})

describe('the cut plan reads who speaks and what is voiced (UAT round 5, R5-F8)', () => {
  it('"Good boy." on WAN 3 is Maya\'s, voiced; the end line on Omni is the NARRATOR\'s V.O., not voiced', async () => {
    const { spokenWords } = await import('./film')
    const { d, shots } = master()
    d.beats = {
      ...d.beats,
      beat_01K7C00000000000000000BT05: { id: 'beat_01K7C00000000000000000BT05', v: 1, field_v: {}, shot_id: shots[4].id, rank: 'm', at_s: 0, kind: 'line', speaker: 'MAYA', parenthetical: '(whispering, to the kettle)', text: 'Good boy.' },
      beat_01K7C00000000000000000BT07: { id: 'beat_01K7C00000000000000000BT07', v: 1, field_v: {}, shot_id: shots[6].id, rank: 'm', at_s: 0.5, kind: 'vo', speaker: 'NARRATOR', text: 'Quietboil. Let them sleep.' },
    } as never
    expect(spokenWords(d, shots[4].id, { provider: 'runway', inputs: { model: 'wan3' } })).toBe('MAYA (whispering, to the kettle): Good boy.')
    expect(spokenWords(d, shots[6].id, { provider: 'runway', inputs: { model: 'gemini_omni_flash_1.1' } }))
      .toBe('NARRATOR (V.O.; not voiced in its take): Quietboil. Let them sleep.')
  })
})

describe('Make all sizes for a short film (UAT acceptance A57: a 5 s film picked no length, "0 versions", no reason)', () => {
  it('starts on the defaults shorter than the film, else on the film\'s own length', () => {
    expect(startLengths(20)).toEqual([15, 6])
    expect(startLengths(8)).toEqual([6])
    expect(startLengths(6)).toEqual([6])
    expect(startLengths(5)).toEqual([5])
  })
  it('says why Plan the cuts cannot go, and nothing when it can', () => {
    expect(cutsBlocked({ shots: 0, lengths: 1, shapes: 1, versions: 1 })).toBe('The ad has no shots to cut from.')
    expect(cutsBlocked({ shots: 3, lengths: 0, shapes: 1, versions: 0 })).toBe('Pick a length.')
    expect(cutsBlocked({ shots: 3, lengths: 1, shapes: 0, versions: 0 })).toBe('Pick a shape.')
    expect(cutsBlocked({ shots: 3, lengths: 1, shapes: 1, versions: 0 })).toBe('That is the ad itself: pick another shape or a shorter length.')
    expect(cutsBlocked({ shots: 3, lengths: 1, shapes: 3, versions: 2 })).toBeNull()
  })
})
