// Make and Edit (features/make-and-edit.clan) through the real CLAN store (napkin-wasm):
//   - the one migration: takes + video.edl → generations + video.timeline, on the owner's samurai project
//     (a copy in test/fixtures; the original is never written) and on the contract's examples
//   - every new write path (leaf rules) applied through LocalPatchBus and saved, so none is refused the
//     way seam was in production
//   - the timeline's arithmetic against contracts/examples/timeline.json (relay/time_rules.py passes it too)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  adTimeToSource, compileTimeline, integrity, itemLength, LocalPatchBus, migrateToGenerations, MIGRATION_ACTION, needsGenerations,
  problems, type Doc, type TimelineItem, type TimelineVideo,
} from '../src/index'
import { AT, MAYA, defaults, example, id, sha, store } from './fixtures'

const here = dirname(fileURLToPath(import.meta.url))
const SAMURAI = join(here, 'fixtures', 'samurai.clan')

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the move to generations: the owner\'s samurai project (a copy)', () => {
  it('opens moved: valid, intact, one generation per box made together, a V1 of the same 10 s, and reopens as it is', async () => {
    const before = readFileSync(SAMURAI)
    const s = store()
    const d = (await s.open(new Uint8Array(before))) as unknown as Any
    expect(d.takes).toBeUndefined()
    expect(problems(d)).toEqual([])
    expect(integrity(d as unknown as Doc)).toEqual([])
    expect(needsGenerations(d)).toBe(false)

    const gens = Object.values(d.generations) as Any[]
    // 20 takes: 6 single clips, three boxes made together (5, 5 and 2 shots), a change and a remade shot.
    expect(gens).toHaveLength(11)
    const together = gens.filter((g) => g.kind === 'together')
    expect(together.map((g) => g.shot_ids.length).sort()).toEqual([2, 5, 5])
    for (const g of together) {
      expect(g.segments).toHaveLength(g.shot_ids.length)
      expect(g.box_id).toMatch(/^run_/)
      expect(d.videos[Object.keys(d.videos)[0]].runs[g.box_id].job_id).toBe(g.job_id)
      g.segments.forEach((x: Any, i: number) => expect(x.shot_id).toBe(g.shot_ids[i]))
    }
    const changes = gens.filter((g) => g.kind === 'change')
    expect(changes).toHaveLength(2)
    for (const g of changes) expect(d.generations[g.parent_id]).toBeDefined()
    for (const g of gens) {
      expect(g).toMatchObject({ state: 'ready', by: 'human:p_301a8b975c' })
      expect(g.asset).toMatch(/^sha256:/)
    }

    // The cut: six clips on V1 end to end, 10 s, each the shot's slot; the end-card shot plays like any clip.
    const video = Object.values(d.videos)[0] as Any
    expect(video.edl).toBeUndefined()
    const v1 = (Object.values(video.timeline) as TimelineItem[]).sort((a, b) => a.start_s! - b.start_s!)
    expect(v1).toHaveLength(6)
    expect(v1.map((i) => i.start_s)).toEqual([0, 2, 3.5, 5, 6.5, 8.5])
    const shots = d.shots as Record<string, { duration_s: number; rank: string }>
    v1.forEach((i) => expect(itemLength(i)).toBeCloseTo(shots[(i as Any).follows.shot_id].duration_s, 3))
    expect(compileTimeline(video as unknown as TimelineVideo, d.generations).lengthS).toBe(10)
    // Shots 3 and 4 were made together: two clips of one generation, at their segments.
    const pair = v1.slice(2, 4).map((i) => i.source!)
    expect(pair[0].generation_id).toBe(pair[1].generation_id)
    expect(pair[0].in_s).toBe(0)
    expect(pair[1].in_s).toBe(1.5)
    // The person's notes now name their generation, in its own time.
    for (const r of Object.values(d.reviews) as Any[]) if (r.target.kind !== 'video') expect(r.target.kind).not.toBe('take')

    // One decision records the move, and the bytes reopen to the same document without moving again.
    const chain = await s.chain()
    expect(chain.filter((c) => c.action === MIGRATION_ACTION)).toHaveLength(1)
    const again = store()
    expect(await again.open(await s.exportClan())).toEqual(d)
    expect((await again.chain()).filter((c) => c.action === MIGRATION_ACTION)).toHaveLength(1)
    // The fixture file itself is never written.
    expect(readFileSync(SAMURAI).equals(before)).toBe(true)
  })

  it('then takes writes through the buses like any project', async () => {
    const s = store()
    await s.open(new Uint8Array(readFileSync(SAMURAI)))
    const bus = new LocalPatchBus(s)
    const video = Object.values(s.get().videos)[0] as Any
    const first = Object.entries(video.timeline as Record<string, Any>).find(([, i]) => i.start_s === 0)![0]
    const r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video.id, path: `timeline/${first}/fade_in_s`, value: 0.3, base_version: video.v }], why: { action: 'fade in shot 1' } })
    expect(r.refused).toEqual([])
    expect((s.get().videos[video.id] as Any).timeline[first].fade_in_s).toBe(0.3)
  })
})

describe('the move to generations: pure', () => {
  it('a moved document comes back unchanged', () => {
    const ad = example<Doc>('document.ad.json')
    expect(needsGenerations(ad)).toBe(false)
    expect(migrateToGenerations(ad)).toEqual(ad)
  })

  it('a spliced take becomes a patch with its stretches; a dissolve seam a dissolve; a note on a take a note on its generation', () => {
    const T1 = 'take_01K7G00000000000000000TK01'
    const T2 = 'take_01K7G00000000000000000TK02'
    const SH = 'shot_01K7G00000000000000000SH01'
    const SH2 = 'shot_01K7G00000000000000000SH02'
    const old: Any = {
      project: { created_by: 'human:p_x', created_at: AT },
      jobs: { job_01K7G00000000000000000JB02: { op: 'clip_patch', started_by: 'human:p_y', created_at: '2026-10-14T10:00:00Z' } },
      shots: { [SH]: { duration_s: 4 }, [SH2]: { duration_s: 3 } },
      takes: {
        [T1]: { id: T1, v: 1, field_v: {}, shot_id: SH, version: 1, asset: sha(1), job_id: 'job_01K7G00000000000000000JB01', crew: 'wren', kind: 'generated', model: 'veo3.1', provider: 'runway', duration_s: 6, segments: [] },
        [T2]: { id: T2, v: 1, field_v: {}, shot_id: SH2, version: 1, parent_id: T1, asset: sha(2), job_id: 'job_01K7G00000000000000000JB02', crew: 'edie', kind: 'mock', model: 'aleph2', provider: 'mock', duration_s: 2,
          segments: [{ source_take: T1, in_s: 0, out_s: 1 }, { source_take: T2, in_s: 1, out_s: 2, job_id: 'job_01K7G00000000000000000JB02' }] },
      },
      videos: { video_01K7G00000000000000000VD01: { id: 'video_01K7G00000000000000000VD01', v: 3, field_v: { 'edl/edl_01K7G00000000000000000ED01/pick/current': 2, target_s: 1 }, edl: {
        edl_01K7G00000000000000000ED01: { rank: 'a0', kind: 'shot', shot_id: SH, pick: { current: T1 }, in_s: 1 },
        edl_01K7G00000000000000000ED02: { rank: 'a1', kind: 'shot', shot_id: SH2, pick: { current: T2 }, seam: { kind: 'dissolve', s: 0.75, by: 'human' } },
        edl_01K7G00000000000000000ED03: { rank: 'a2', kind: 'shot', shot_id: SH2 },
      } } },
      reviews: { rev_1: { target: { kind: 'take', id: T2 }, at_s: 1.2 } },
      stale: { stale_1: { target: { kind: 'take', id: T1 }, caused_by: { kind: 'frame', id: 'frame_1' } } },
    }
    const frozen = JSON.stringify(old)
    const d = migrateToGenerations(old) as Any
    expect(JSON.stringify(old)).toBe(frozen)
    const G1 = 'gen_01K7G00000000000000000TK01'
    const G2 = 'gen_01K7G00000000000000000TK02'
    expect(d.generations[G2]).toMatchObject({ kind: 'patch', parent_id: G1, mock: true, by: 'human:p_y', created_at: '2026-10-14T10:00:00Z',
      patched: [{ in_s: 1, out_s: 2, job_id: 'job_01K7G00000000000000000JB02', generation_id: G2 }], inputs: { model: 'aleph2', length_s: 2 } })
    expect(d.generations[G1]).toMatchObject({ kind: 'clip', by: 'human:p_x', created_at: AT })
    const tl = d.videos.video_01K7G00000000000000000VD01.timeline
    expect(tl).toEqual({
      item_01K7G00000000000000000ED01: { track: 'V1', start_s: 0, source: { generation_id: G1, in_s: 1, out_s: 5 }, follows: { shot_id: SH } },
      // 2 s of footage for a 3 s shot: held 1 s, as the render held it.
      item_01K7G00000000000000000ED02: { track: 'V1', start_s: 4, source: { generation_id: G2, in_s: 0, out_s: 2 }, follows: { shot_id: SH2 }, transition_in: { kind: 'dissolve', s: 0.75 }, hold_s: 1 },
    })
    expect(d.videos.video_01K7G00000000000000000VD01.field_v).toEqual({ target_s: 1 })
    expect(d.reviews.rev_1.target).toEqual({ kind: 'generation', id: G2 })
    expect(d.stale).toEqual({})
  })

  it('an end-framed take is retimed whole within 1.33x', () => {
    const T = 'take_01K7G00000000000000000TK05'
    const SH = 'shot_01K7G00000000000000000SH05'
    const d = migrateToGenerations({
      project: { created_by: 'human:p_x', created_at: AT }, jobs: {}, shots: { [SH]: { duration_s: 3 } },
      takes: { [T]: { id: T, shot_id: SH, asset: sha(5), job_id: 'job_01K7G00000000000000000JB05', duration_s: 5, segments: [], end: { kind: 'next_storyboard', at_s: 3.5 } } },
      videos: { v: { edl: { edl_01K7G00000000000000000ED05: { rank: 'a0', kind: 'shot', shot_id: SH, pick: { current: T } } } } },
    }) as Any
    const item = d.videos.v.timeline.item_01K7G00000000000000000ED05
    expect(item.source).toEqual({ generation_id: 'gen_01K7G00000000000000000TK05', in_s: 0, out_s: 3.542 })
    expect(item.speed).toBeCloseTo(3.542 / 3, 5)
    expect(itemLength(item)).toBeCloseTo(3, 4)
  })
})

describe('every new write path, through the real store', () => {
  async function setup() {
    const s = store()
    await s.create({ person: MAYA })
    const bus = new LocalPatchBus(s)
    const video = defaults(s).video
    return { s, bus, video }
  }
  const G = id('gen', 1)
  const G2 = id('gen', 2)
  const SH = id('shot', 1)
  const RUN = id('run', 1)
  const CLIP = id('item', 1)
  const OVER = id('item', 2)
  const TEXT = id('item', 3)
  const generation = (extra: Any = {}) => ({ kind: 'clip', shot_ids: [SH], state: 'making', created_at: AT, by: 'human:p_maya001', ...extra })
  const vOf = (s: ReturnType<typeof store>, video: string) => (s.get().videos[video] as Any).v as number

  it('creates a generation, then sets each of its fields; the bytes reopen with them', async () => {
    const { s, bus } = await setup()
    let r = await bus.apply({ patches: [{ op: 'create', entity: 'generations', id: G, value: generation(), base_version: 0 }], why: { action: 'make box 1' } })
    expect(r.refused).toEqual([])
    const sets: [string, unknown][] = [
      ['state', 'ready'], ['asset', sha(7)], ['duration_s', 5], ['job_id', id('job', 1)], ['provider', 'runway'], ['crew', 'wren'],
      ['label', 'First take'], ['box_id', RUN], ['shot_ids', [SH]], ['inputs', { model: 'seedance2_5', length_s: 5, camera: { [SH]: { size: 'wide', movement: 'static' } } }],
      ['segments', [{ shot_id: SH, in_s: 0, out_s: 5, by: 'detected' }]], ['patched', [{ in_s: 1, out_s: 3, job_id: id('job', 2) }]],
      ['end', { kind: 'none' }],
    ]
    // state ready needs asset and duration_s: written in one batch, as a landing does.
    r = await bus.apply({ patches: sets.map(([path, value], i) => ({ op: 'set' as const, entity: 'generations' as const, id: G, path, value, base_version: 1 + 0 * i })), why: { action: 'land box 1' } })
    expect(r.refused).toEqual([])
    r = await bus.apply({ patches: [{ op: 'create', entity: 'generations', id: G2, value: generation({ kind: 'change', parent_id: G, delta: [{ field: 'camera.movement', shot_id: SH, from: 'static', to: 'handheld' }] }), base_version: 0 }], why: { action: 'new take of box 1' } })
    expect(r.refused).toEqual([])
    r = await bus.apply({ patches: [
      { op: 'set', entity: 'generations', id: G2, path: 'delta', value: [{ field: 'words', shot_id: SH, from: 'a', to: 'b' }], base_version: 1 },
      { op: 'set', entity: 'generations', id: G2, path: 'parent_id', value: G, base_version: 1 },
      { op: 'set', entity: 'generations', id: G2, path: 'kind', value: 'feel', base_version: 1 },
      { op: 'set', entity: 'generations', id: G2, path: 'mock', value: true, base_version: 1 },
      { op: 'set', entity: 'generations', id: G2, path: 'state', value: 'failed', base_version: 1 },
    ], why: { action: 'change the take' } })
    expect(r.refused).toEqual([])
    const back = await store().open(await s.exportClan())
    expect((back.generations[G] as Any).inputs.model).toBe('seedance2_5')
    expect((back.generations[G2] as Any).state).toBe('failed')
  })

  it('a ready generation without its asset, or a patch with no parent, is refused', async () => {
    const { bus } = await setup()
    let r = await bus.apply({ patches: [{ op: 'create', entity: 'generations', id: G, value: generation({ state: 'ready' }), base_version: 0 }], why: { action: 'x' } })
    expect(r.refused[0]?.reason).toBe('invalid')
    r = await bus.apply({ patches: [{ op: 'create', entity: 'generations', id: G, value: generation({ kind: 'patch' }), base_version: 0 }], why: { action: 'x' } })
    expect(r.refused[0]?.reason).toBe('invalid')
  })

  it('writes a clip, a V2 clip and a text item by item and field by field, and the end card', async () => {
    const { s, bus, video } = await setup()
    await bus.apply({ patches: [
      { op: 'create', entity: 'generations', id: G, value: generation({ state: 'ready', asset: sha(7), duration_s: 6, box_id: RUN }), base_version: 0 },
      { op: 'create', entity: 'generations', id: G2, value: generation({ kind: 'change', parent_id: G, state: 'ready', asset: sha(8), duration_s: 6 }), base_version: 0 },
    ], why: { action: 'land' } })
    const clip = { track: 'V1', start_s: 0, source: { generation_id: G, in_s: 0, out_s: 2 }, follows: { shot_id: SH } }
    let r = await bus.apply({ patches: [
      { op: 'set', entity: 'videos', id: video, path: `timeline/${CLIP}`, value: clip, base_version: vOf(s, video) },
      { op: 'set', entity: 'videos', id: video, path: `timeline/${OVER}`, value: { track: 'V2', start_s: 1, source: { generation_id: G2, in_s: 0, out_s: 1 }, opacity: 0.8 }, base_version: vOf(s, video) },
      { op: 'set', entity: 'videos', id: video, path: `timeline/${TEXT}`, value: { track: 'text', words: 'Clean like a samurai.', style: 'super', from_s: 0.5, to_s: 1.5 }, base_version: vOf(s, video) },
    ], why: { action: 'assemble first cut' } })
    expect(r.refused).toEqual([])
    const fields: [string, unknown][] = [
      [`timeline/${CLIP}/start_s`, 0.2], [`timeline/${CLIP}/source/in_s`, 0.2], [`timeline/${CLIP}/source/out_s`, 1.8],
      [`timeline/${CLIP}/fade_in_s`, 0.3], [`timeline/${CLIP}/fade_out_s`, 0.3], [`timeline/${CLIP}/transition_in`, { kind: 'dip_white', s: 0.5 }],
      [`timeline/${CLIP}/speed`, 1.2], [`timeline/${CLIP}/hold_s`, 0.4], [`timeline/${CLIP}/follows/box_id`, RUN], [`timeline/${CLIP}/follows/shot_id`, SH],
      [`timeline/${CLIP}/follows`, { box_id: RUN, shot_id: SH }], [`timeline/${CLIP}/source/generation_id`, G2], [`timeline/${CLIP}/source`, { generation_id: G2, in_s: 0.2, out_s: 2 }],
      [`timeline/${OVER}/opacity`, 0.5], [`timeline/${OVER}/track`, 'V2'], [`timeline/${OVER}/source/asset`, null],
      [`timeline/${TEXT}/words`, 'Clean in one sweep.'], [`timeline/${TEXT}/style`, 'caption'], [`timeline/${TEXT}/from_s`, 0.6], [`timeline/${TEXT}/to_s`, 1.8],
      [`timeline/${TEXT}/fade_in_s`, 0.2], [`timeline/${TEXT}/fade_out_s`, 0.2],
      ['end_card', { headline: 'SuperSamurai', line: 'Clean in one sweep', cta: 'supersamurai.example', bg: '#0F1114', logo_asset: sha(9), s: 1.5, transition_in: { kind: 'dissolve', s: 0.5 } }],
    ]
    for (const [path, value] of fields) {
      r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path, value, base_version: vOf(s, video) }], why: { action: `set ${path}` } })
      expect([path, r.refused, r.conflicts]).toEqual([path, [], []])
    }
    const v = s.get().videos[video] as Any
    expect(v.timeline[CLIP]).toMatchObject({ start_s: 0.2, source: { generation_id: G2, in_s: 0.2, out_s: 2 }, speed: 1.2, hold_s: 0.4, transition_in: { kind: 'dip_white', s: 0.5 } })
    expect(v.end_card.line).toBe('Clean in one sweep')
    // Moving the V2 clip down onto V1 is refused (it would overlap, and opacity is V2's); removing an item is a null.
    r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: `timeline/${OVER}/track`, value: 'V1', base_version: vOf(s, video) }], why: { action: 'move down' } })
    expect(r.refused[0]?.reason).toBe('invalid')
    r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: `timeline/${OVER}`, value: null, base_version: vOf(s, video) }, { op: 'set', entity: 'videos', id: video, path: 'end_card', value: null, base_version: vOf(s, video) }], why: { action: 'remove from cut' } })
    expect(r.refused).toEqual([])
    const back = (await store().open(await s.exportClan())).videos[video] as Any
    expect(Object.keys(back.timeline).sort()).toEqual([CLIP, TEXT])
    expect(back.end_card).toBeUndefined()
  })

  it('the whole timeline in one write, a text with a source, and a speed past 1.33 are refused', async () => {
    const { s, bus, video } = await setup()
    let r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: 'timeline', value: {}, base_version: vOf(s, video) }], why: { action: 'x' } })
    expect(r.refused[0]?.reason).toBe('not_leaf')
    r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: `timeline/${TEXT}`, value: { track: 'text', words: 'x', style: 'title', from_s: 0, to_s: 1, source: { asset: sha(1), in_s: 0, out_s: 1 } }, base_version: vOf(s, video) }], why: { action: 'x' } })
    expect(r.refused[0]?.reason).toBe('invalid')
    r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: `timeline/${CLIP}`, value: { track: 'V1', start_s: 0, source: { asset: sha(1), in_s: 0, out_s: 1 }, speed: 2 }, base_version: vOf(s, video) }], why: { action: 'x' } })
    expect(r.refused[0]?.reason).toBe('invalid')
  })
})

interface TimelineFixture {
  adTimeToSource: { timeline: Record<string, TimelineItem>; cases: { why: string; adS: number; want: unknown }[] }
}
const TL = example<TimelineFixture>('timeline.json')

describe('adTimeToSource (examples/timeline.json)', () => {
  for (const c of TL.adTimeToSource.cases) it(c.why, () => expect(adTimeToSource(TL.adTimeToSource.timeline, c.adS)).toEqual(c.want))
})

describe('compileTimeline', () => {
  it('V1 in start order with its footage, texts in time order, the end card after the last clip, and the length', () => {
    const ad = example<Any>('document.ad.json')
    const video = ad.videos.video_01K7A000000000000000000027
    const plan = compileTimeline(video, ad.generations)
    expect(plan.clips.map((c) => [c.startS, c.inS, c.outS])).toEqual([[0, 0, 5], [5, 0, 2], [7, 0, 4.5]])
    expect(plan.clips[0].sha256).toBe(ad.generations[video.timeline.item_01K7A000000000000000000028.source.generation_id].asset)
    expect(plan.clips[0].transitionIn).toBeUndefined()
    expect(plan.clips[2]).toMatchObject({ fadeInS: 0.3, transitionIn: { kind: 'dissolve', s: 0.5 } })
    expect(plan.texts).toEqual([{ item_id: 'item_01K7A00000000000000000004D', words: 'First light, every day.', style: 'super', fromS: 7.5, toS: 10, fadeInS: 0.2, fadeOutS: 0.2 }])
    expect(plan.endCard).toMatchObject({ line: 'Wake up with it.', s: 2.5, transitionIn: { kind: 'dip_black', s: 0.5 } })
    expect(plan.lengthS).toBe(14)
    expect(plan.missing).toEqual([])
  })

  it('leaves out a clip whose generation is still being made, and names it', () => {
    const plan = compileTimeline(
      { timeline: { [id('item', 9)]: { track: 'V1', start_s: 0, source: { generation_id: id('gen', 9), in_s: 0, out_s: 1 } } } },
      { [id('gen', 9)]: { state: 'making' } },
    )
    expect(plan.clips).toEqual([])
    expect(plan.missing).toEqual([id('item', 9)])
  })
})
