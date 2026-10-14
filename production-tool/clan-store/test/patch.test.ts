// patch.ts against contracts/examples/patches.json (relay/time_rules.py passes the same windows and
// plans), and applyPatchTake's landing rules (features/clip-moment-edit.clan).
import { describe, expect, it } from 'vitest'
import {
  applyPatchTake, MAX_SEGMENTS, noteToTakeWindow, patchedRanges, patchPlan, spliceSegments,
  type NoteLike, type PatchDoc, type PatchTake, type Segment,
} from '../src/index'
import { example } from './fixtures'

interface Fixture {
  noteToTakeWindow: { why: string; note: NoteLike; take_s: number; item: { in_s?: number; out_s?: number } | null; want: unknown }[]
  patchPlan: { why: string; in: Parameters<typeof patchPlan>[0]; want: unknown }[]
  spliceSegments: { why: string; parent: { id: string; duration_s: number; segments: Segment[] }; takeId: string; window: { from_s: number; to_s: number }; jobId: string; want: Segment[] }[]
  patchedRanges: { segments: Segment[]; want: unknown }[]
}
const P = example<Fixture>('patches.json')

describe('noteToTakeWindow (examples/patches.json)', () => {
  for (const c of P.noteToTakeWindow) it(c.why, () => expect(noteToTakeWindow(c.note, { duration_s: c.take_s }, c.item)).toEqual(c.want))
})

describe('patchPlan (examples/patches.json)', () => {
  for (const c of P.patchPlan) it(c.why, () => expect(patchPlan(c.in)).toEqual(c.want))
})

describe('spliceSegments (examples/patches.json)', () => {
  for (const c of P.spliceSegments) {
    it(c.why, () => {
      const got = spliceSegments(c.parent, c.takeId, c.window, c.jobId)
      expect(got).toEqual(c.want)
      expect(got.length).toBeLessThanOrEqual(MAX_SEGMENTS)
      // the pieces tile the take, in order, with no gap
      expect(got[0].in_s).toBe(0)
      expect(got.at(-1)!.out_s).toBe(c.parent.duration_s)
      got.slice(1).forEach((s, i) => expect(s.in_s).toBe(got[i].out_s))
    })
  }
})

describe('patchedRanges (examples/patches.json)', () => {
  for (const c of P.patchedRanges) it(`${c.segments.length} segments`, () => expect(patchedRanges({ segments: c.segments })).toEqual(c.want))
})

const SHOT = 'shot_01K7F00000000000000000SH04'
const V1 = 'take_01K7F0000000000000000TK001'
const V2 = 'take_01K7F0000000000000000TK002'
const JOB = 'job_01K7F00000000000000000JB03'

function take(id: string, version: number, extra: Partial<PatchTake> = {}): PatchTake {
  return { id, v: 1, field_v: {}, shot_id: SHOT, version, asset: `sha256:${'a'.repeat(63)}${version}`, job_id: `job_01K7F00000000000000000JB0${version}`,
    crew: 'wren', kind: 'generated', model: 'veo3.1', provider: 'runway', duration_s: 6, segments: [], ...extra }
}

function doc(): PatchDoc & { reviews: Record<string, { state: string }> } {
  return {
    takes: { [V1]: take(V1, 1), [V2]: take(V2, 2, { parent_id: V1 }) },
    videos: { video_A: { edl: { edl_A: { rank: 'm', kind: 'shot', shot_id: SHOT, pick: { current: V2, alternates: [V1] } } } } },
    reviews: { rev_A: { state: 'open' } },
  }
}

const job = { jobId: JOB, kind: 'generated' as const, model: 'aleph2', provider: 'runway',
  outputs: [{ sha256: `sha256:${'b'.repeat(64)}`, durationS: 6 }], patch: { window: { from_s: 2, to_s: 4 }, model: 'aleph2' } }

describe('applyPatchTake', () => {
  it('lands v3 with parent v2, Edie, the window model and its segments, picked with v2 kept as an alternate', () => {
    const d = doc()
    let n = 0
    const t = applyPatchTake(d, job, { shotId: SHOT, parentTakeId: V2, videoId: 'video_A', newId: (p) => `${p}_NEW${n++}` })!
    expect(t).toMatchObject({ version: 3, parent_id: V2, crew: 'edie', model: 'aleph2', provider: 'runway', duration_s: 6, job_id: JOB, kind: 'generated' })
    expect(t.segments).toEqual([
      { source_take: V2, in_s: 0, out_s: 2 }, { source_take: t.id, in_s: 2, out_s: 4, job_id: JOB }, { source_take: V2, in_s: 4, out_s: 6 },
    ])
    expect(d.videos.video_A.edl.edl_A.pick).toEqual({ current: t.id, alternates: [V1, V2] })
    expect(d.reviews.rev_A.state).toBe('open') // the note stays open: Fix again, or Resolve
  })

  it('landing twice changes nothing', () => {
    const d = doc()
    applyPatchTake(d, job, { shotId: SHOT, parentTakeId: V2, videoId: 'video_A' })
    const before = JSON.stringify(d)
    expect(applyPatchTake(d, job, { shotId: SHOT, parentTakeId: V2, videoId: 'video_A' })).toBeUndefined()
    expect(JSON.stringify(d)).toBe(before)
  })

  it('keeps at most 8 alternates, the newest', () => {
    const d = doc()
    const alts = Array.from({ length: 8 }, (_, i) => `take_ALT${i}`)
    d.videos.video_A.edl.edl_A.pick = { current: V2, alternates: alts }
    const t = applyPatchTake(d, job, { shotId: SHOT, parentTakeId: V2, videoId: 'video_A' })!
    expect(d.videos.video_A.edl.edl_A.pick).toEqual({ current: t.id, alternates: [...alts.slice(1), V2] })
  })

  it('needs the job’s patch block, an output and the parent', () => {
    const d = doc()
    expect(applyPatchTake(d, { ...job, patch: undefined }, { shotId: SHOT, parentTakeId: V2 })).toBeUndefined()
    expect(applyPatchTake(d, { ...job, outputs: [] }, { shotId: SHOT, parentTakeId: V2 })).toBeUndefined()
    expect(applyPatchTake(d, job, { shotId: SHOT, parentTakeId: 'take_GONE' })).toBeUndefined()
  })

  it('a mock patch is a mock take', () => {
    const d = doc()
    expect(applyPatchTake(d, { ...job, kind: 'mock', provider: 'mock' }, { shotId: SHOT, parentTakeId: V2 })!.kind).toBe('mock')
  })
})
