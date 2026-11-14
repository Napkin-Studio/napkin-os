// patch.ts against contracts/examples/patches.json (relay/time_rules.py passes the same windows and
// plans) and examples/timeline.json's momentWindow, and applyPatchGeneration's landing rules
// (features/clip-moment-edit.clan, on generations since features/make-and-edit.clan).
import { describe, expect, it } from 'vitest'
import {
  applyPatchGeneration, MAX_PATCHED, momentWindow, noteToTakeWindow, patchedRanges, patchedStretches, patchPlan,
  type NoteLike, type Patched, type PatchDoc, type PatchGeneration,
} from '../src/index'
import { example } from './fixtures'

interface Fixture {
  noteToTakeWindow: { why: string; note: NoteLike; take_s: number; item: { in_s?: number; out_s?: number } | null; want: unknown }[]
  patchPlan: { why: string; in: Parameters<typeof patchPlan>[0]; want: unknown }[]
  patchedStretches: { why: string; parent: { patched: Patched[] }; genId: string; window: { from_s: number; to_s: number }; jobId: string; want: Patched[] }[]
  patchedRanges: { patched: Patched[]; want: unknown }[]
}
const P = example<Fixture>('patches.json')
const T = example<{ momentWindow: { why: string; inS: number; outS: number; takeS: number; want: unknown }[] }>('timeline.json')

describe('noteToTakeWindow (examples/patches.json)', () => {
  for (const c of P.noteToTakeWindow) it(c.why, () => expect(noteToTakeWindow(c.note, { duration_s: c.take_s }, c.item)).toEqual(c.want))
})

describe('momentWindow (examples/timeline.json)', () => {
  for (const c of T.momentWindow) it(c.why, () => expect(momentWindow(c.inS, c.outS, c.takeS)).toEqual(c.want))
})

describe('patchPlan (examples/patches.json)', () => {
  for (const c of P.patchPlan) it(c.why, () => expect(patchPlan(c.in)).toEqual(c.want))
})

describe('patchedStretches (examples/patches.json)', () => {
  for (const c of P.patchedStretches) {
    it(c.why, () => {
      const got = patchedStretches(c.parent, c.genId, c.window, c.jobId)
      expect(got).toEqual(c.want)
      expect(got.length).toBeLessThanOrEqual(MAX_PATCHED)
      got.slice(1).forEach((s, i) => expect(s.in_s).toBeGreaterThanOrEqual(got[i].out_s))
    })
  }
})

describe('patchedRanges (examples/patches.json)', () => {
  for (const c of P.patchedRanges) it(`${c.patched.length} stretches`, () => expect(patchedRanges({ patched: c.patched })).toEqual(c.want))
})

const SHOT = 'shot_01K7F00000000000000000SH04'
const SHOT2 = 'shot_01K7F00000000000000000SH05'
const G1 = 'gen_01K7F00000000000000000GN01'
const G2 = 'gen_01K7F00000000000000000GN02'
const JOB = 'job_01K7F00000000000000000JB03'
const BY = 'human:p_maya001'
const NOW = '2026-10-20T10:00:00Z'

function gen(id: string, extra: Partial<PatchGeneration> = {}): PatchGeneration {
  return { id, v: 1, field_v: {}, kind: 'together', box_id: 'run_01K7F00000000000000000RN01', shot_ids: [SHOT, SHOT2],
    segments: [{ shot_id: SHOT, in_s: 0, out_s: 1.5, by: 'detected' }, { shot_id: SHOT2, in_s: 1.5, out_s: 3.5, by: 'detected' }],
    asset: `sha256:${'a'.repeat(64)}`, duration_s: 3.5, state: 'ready', job_id: 'job_01K7F00000000000000000JB01', provider: 'runway', crew: 'wren',
    created_at: NOW, by: BY, ...extra }
}

function doc(): PatchDoc & { reviews: Record<string, { state: string }> } {
  return { generations: { [G1]: gen(G1), [G2]: gen(G2, { kind: 'change', parent_id: G1 }) }, reviews: { rev_A: { state: 'open' } } }
}

const job = { jobId: JOB, kind: 'generated' as const, model: 'aleph2', provider: 'runway',
  outputs: [{ sha256: `sha256:${'b'.repeat(64)}`, durationS: 3.5 }], patch: { window: { from_s: 0, to_s: 2 }, model: 'aleph2' },
  remake: { parentId: G2, delta: [{ field: 'moment', to: { inS: 0.8, outS: 1.2, note: 'his shirt is deep red', window: { from_s: 0, to_s: 2 } } }] } }

describe('applyPatchGeneration', () => {
  it('lands a patch beside its parent: same length, shots, segments and box; the moment as its delta; never into the cut', () => {
    const d = doc()
    let n = 0
    const g = applyPatchGeneration(d, job, { parentId: G2, by: BY, now: NOW, note: 'Shirt red', newId: (p) => `${p}_NEW${n++}` })!
    expect(g).toMatchObject({ kind: 'patch', parent_id: G2, crew: 'edie', provider: 'runway', duration_s: 3.5, job_id: JOB, state: 'ready',
      shot_ids: [SHOT, SHOT2], box_id: 'run_01K7F00000000000000000RN01', inputs: { model: 'aleph2', length_s: 3.5 }, label: 'Shirt red 0:00-0:02' })
    expect(g.segments).toEqual(d.generations[G2].segments)
    expect(g.delta).toEqual([{ field: 'moment', to: job.remake.delta[0].to }])
    expect(g.patched).toEqual([{ in_s: 0, out_s: 2, job_id: JOB, generation_id: g.id }])
    expect(d.generations[G2].kind).toBe('change') // the parent is untouched
    expect(d.reviews.rev_A.state).toBe('open') // the note stays open: Fix again, or Resolve
  })

  it('landing twice changes nothing', () => {
    const d = doc()
    applyPatchGeneration(d, job, { parentId: G2, by: BY, now: NOW })
    const before = JSON.stringify(d)
    expect(applyPatchGeneration(d, job, { parentId: G2, by: BY, now: NOW })).toBeUndefined()
    expect(JSON.stringify(d)).toBe(before)
  })

  it('needs the job’s patch block, an output and the parent', () => {
    const d = doc()
    expect(applyPatchGeneration(d, { ...job, patch: undefined }, { parentId: G2, by: BY, now: NOW })).toBeUndefined()
    expect(applyPatchGeneration(d, { ...job, outputs: [] }, { parentId: G2, by: BY, now: NOW })).toBeUndefined()
    expect(applyPatchGeneration(d, job, { parentId: 'gen_GONE', by: BY, now: NOW })).toBeUndefined()
  })

  it('a mock patch is a mock generation', () => {
    const d = doc()
    expect(applyPatchGeneration(d, { ...job, kind: 'mock', provider: 'mock' }, { parentId: G2, by: BY, now: NOW })!.mock).toBe(true)
  })
})
