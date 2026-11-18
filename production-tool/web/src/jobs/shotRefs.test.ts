// The references a shot sends (owner 2026-10-15, features/canvas-nodes.clan): "The script — instead of just
// using '@samurai' — used different references for the frames, unless it offers a definite advantage (then
// it's fine)." Built like the owner's project: four samurai views linked to the script that drives the
// storyboard, and a hall picture linked there too.

import { describe, expect, it, vi } from 'vitest'
import type { Job, ProductionDocument } from '../contracts/types'
import { writeRefs } from '../script/skye'
import { shotRefRows } from '../stages/trayScope'
import { loadJson } from '../test/schemas'
import { refsFor, shotRefSet } from './select'

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SCRIPT = 'script_01K7A00000000000000000000Z'
const SB = 'storyboard_01K7A000000000000000000012'
const SHOT = 'shot_01K7A000000000000000000015'
const KEY = 'key_01M4YC0JWN7C9B2XTEV9QT2CPC'
const VIEWS = ['front', 'three-quarter', 'side', 'back'] as const
const sha = (c: string) => `sha256:${c.repeat(64)}`
vi.mock('./assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))
const relay = {}

function owners(shotRefs: string[] = [KEY]): ProductionDocument {
  const d = structuredClone(ex)
  d.links = {}
  d.refs = {}
  d.keys = { [KEY]: { id: KEY, v: 1, field_v: {}, key: 'samurai', role: 'character' } }
  const link = (id: string, from: { kind: 'ref' | 'script'; id: string }, to: { kind: 'script' | 'storyboard' | 'shot'; id: string }, role: string) => {
    d.links[id] = { id, v: 1, field_v: {}, from, to, role } as ProductionDocument['links'][string]
  }
  link('link_drives', { kind: 'script', id: SCRIPT }, { kind: 'storyboard', id: SB }, 'drives')
  VIEWS.forEach((v, i) => {
    const id = `ref_samurai_${i}`
    d.refs[id] = { id, v: 1, field_v: {}, key: 'samurai', variant: v, role: 'character', asset: sha(String(i + 1)) }
    link(`link_v${i}`, { kind: 'ref', id }, { kind: 'script', id: SCRIPT }, 'character')
  })
  d.refs.ref_hall = { id: 'ref_hall', v: 1, field_v: {}, key: 'hall', variant: 'wide', role: 'location', asset: sha('9') }
  link('link_hall', { kind: 'ref', id: 'ref_hall' }, { kind: 'script', id: SCRIPT }, 'location')
  d.shots[SHOT] = { ...d.shots[SHOT], action: '@samurai sweeps the hall in one clean arc.', refs: shotRefs }
  return d
}

const names = (set: ReturnType<typeof shotRefSet>) => set.map((x) => `${x.ref.key}_${x.ref.variant}:${x.from}`)

describe('a shot sends what its words name, and offers the rest', () => {
  it('a bare @samurai sends all four views, front first; the hall is only offered', () => {
    const d = owners()
    expect(names(shotRefSet(d, d.shots[SHOT]))).toEqual([
      'samurai_front:words', 'samurai_three-quarter:words', 'samurai_side:words', 'samurai_back:words', 'hall_wide:offered',
    ])
  })

  it('a shot that names one view sends that view; the other views are offered, never in its place', () => {
    const d = owners(['ref_samurai_2'])
    const set = shotRefSet(d, d.shots[SHOT])
    expect(set.filter((x) => x.from !== 'offered').map((x) => x.ref.variant)).toEqual(['side'])
    expect(set.filter((x) => x.from === 'offered').map((x) => x.ref.variant).sort()).toEqual(['back', 'front', 'three-quarter', 'wide'])
  })

  it('a reference linked into the shot itself is asked for, not offered', () => {
    const d = owners(['ref_samurai_0'])
    d.links.link_shot = { id: 'link_shot', v: 1, field_v: {}, from: { kind: 'ref', id: 'ref_hall' }, to: { kind: 'shot', id: SHOT }, role: 'location' } as ProductionDocument['links'][string]
    expect(names(shotRefSet(d, d.shots[SHOT])).slice(0, 2)).toEqual(['samurai_front:words', 'hall_wide:linked'])
  })

  it('what the person unticked is not offered again', () => {
    const d = owners()
    expect(names(shotRefSet(d, d.shots[SHOT], '', ['ref_hall']))).not.toContain('hall_wide:offered')
  })

  it('the job input marks offered refs optional; without `offer` (Change this frame) they stay out', async () => {
    const d = owners()
    const offered = await refsFor(relay as never, d, d.shots[SHOT], '', { offer: true })
    expect(offered.map((r) => [r.name, r.optional ?? false])).toEqual([
      ['samurai_front', false], ['samurai_three-quarter', false], ['samurai_side', false], ['samurai_back', false], ['hall_wide', true],
    ])
    expect((await refsFor(relay as never, d, d.shots[SHOT], '')).map((r) => r.name)).not.toContain('hall_wide')
  })
})

describe('the tray shows what goes and what Dex added', () => {
  const added = (d: ProductionDocument) => {
    d.jobs.job_frame = {
      id: 'job_frame', v: 1, field_v: {}, op: 'frame', crew: 'wren', state: 'completed', node: { kind: 'shot', id: SHOT },
      created_at: '2026-10-15T02:11:35Z', updated_at: '2026-10-15T02:12:00Z', input_hashes: [], parent_ids: [], outputs: [],
      director: {
        model: 'm', promptVersion: 'director.v8', rationale: 'r',
        output: { providerJob: { refs: [{ name: 'samurai_front', sha256: sha('1'), role: 'character' }, { name: 'hall_wide', sha256: sha('9'), role: 'object' }] },
          added: [{ name: 'hall_wide', why: 'the action is set in the hall' }] },
      },
    } as unknown as Job as never
  }

  it('one row for the whole key from its words, then "Added by Dex: @hall_wide · why", ticked', () => {
    const d = owners()
    added(d)
    expect(shotRefRows(d, SHOT).map((r) => [r.label, r.detail, r.kind, r.on])).toEqual([
      ['@samurai', 'front, three-quarter, side, back · from its words', 'asked', true],
      ['Added by Dex: @hall_wide', 'the action is set in the hall', 'added', true],
    ])
  })

  it('an unticked addition shows unticked', () => {
    const d = owners()
    added(d)
    expect(shotRefRows(d, SHOT, ['ref_hall']).at(-1)).toMatchObject({ kind: 'added', on: false, refIds: ['ref_hall'] })
  })
})

describe('Skye is told the whole key by its bare name', () => {
  it('lists @samurai with its views before the views themselves', () => {
    const refs = writeRefs(owners())
    expect(refs[0]).toEqual({ name: 'samurai', role: 'character', label: 'the whole character: front, three-quarter, side, back' })
    expect(refs.map((r) => r.name)).toEqual(expect.arrayContaining(['samurai_front', 'samurai_back', 'hall_wide']))
  })
})
