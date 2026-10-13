// The PatchBus contract (contracts/collab.md §7-8, patch.schema.json). Every
// PatchBus runs it: LocalPatchBus here (bus.test.ts), and the sync service's
// bus at live-sync, so the two can never mean different things by a patch.
import { describe, expect, it } from 'vitest'
import type { ChainEntry, Doc, PatchBus } from '../src/index'
import { id, jobValue, shotValue } from './fixtures'

export interface BusUnderTest {
  bus: PatchBus
  docId: string
  person: string
  chain(): Promise<ChainEntry[]>
}

export function busContract(name: string, make: () => Promise<BusUnderTest>) {
  const sb = (d: Doc) => Object.keys(d.storyboards)[0]
  const withShot = async () => {
    const t = await make()
    const shot = id('shot', 1)
    const r = await t.bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(sb(t.bus.doc()), 'a0'), base_version: 0 }], why: { action: 'create shots[shot 1]' } })
    expect(r.applied).toBe(true)
    return { ...t, shot }
  }

  describe(`PatchBus contract: ${name}`, () => {
    it('a set lands on one leaf, bumps v and field_v, and records one decision with its targets', async () => {
      const { bus, shot, docId, chain, person } = await withShot()
      const r = await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'camera/size', value: 'close', base_version: 1 }], why: { action: 'set shots camera size' } })
      expect(r.applied).toBe(true)
      expect(r.v).toEqual({ [`shots/${shot}`]: 2 })
      const s = bus.doc().shots[shot]
      expect((s.camera as { size: string }).size).toBe('close')
      expect(s.v).toBe(2)
      expect(s.field_v).toEqual({ 'camera/size': 2 })
      const [e] = await chain()
      expect(e.action).toBe('set shots camera size')
      expect(e.agent).toBe(person)
      expect(e.targets).toEqual([`${docId}#shots[${shot}]`, `${docId}#shots[${shot}].camera.size`])
    })

    it('a set on a leaf someone wrote since is a conflict with the winning value; another leaf still applies', async () => {
      const { bus, shot } = await withShot()
      await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'camera/size', value: 'close', base_version: 1 }], why: { action: 'set size' } })
      const late = await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'camera/size', value: 'wide', base_version: 1 }], why: { action: 'set size again' } })
      expect(late.applied).toBe(false)
      expect(late.conflicts).toEqual([{ index: 0, entity: 'shots', id: shot, path: 'camera/size', base_version: 1, field_v: 2, current: 'close' }])
      expect((bus.doc().shots[shot].camera as { size: string }).size).toBe('close')
      const other = await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 4, base_version: 1 }], why: { action: 'set duration' } })
      expect(other.applied).toBe(true)
    })

    it('refuses what a patch may not write, in the contract\'s words', async () => {
      const { bus, shot } = await withShot()
      const reason = async (p: Record<string, unknown>) => (await bus.apply({ patches: [{ base_version: 9, ...p } as never], why: { action: 'try' } })).refused[0]?.reason
      expect(await reason({ op: 'set', entity: 'shots', id: shot, path: 'action', value: 'typed over' })).toBe('owned_by_text')
      expect(await reason({ op: 'set', entity: 'shots', id: shot, path: 'camera', value: { size: 'wide' } })).toBe('not_leaf')
      expect(await reason({ op: 'set', entity: 'shots', id: shot, path: 'v', value: 9 })).toBe('not_leaf')
      expect(await reason({ op: 'set', entity: 'shots', id: id('shot', 77), path: 'rank', value: 'a1' })).toBe('not_found')
      expect(await reason({ op: 'create', entity: 'shots', id: shot, value: {} })).toBe('exists')
      expect(await reason({ op: 'create', entity: 'shots', id: id('shot', 78), value: { ...shotValue(sb(bus.doc()), 'a2'), action: 'typed' } })).toBe('owned_by_text')
      expect(await reason({ op: 'set', entity: 'shots', id: shot, path: 'camera/size', value: 'enormous' })).toBe('invalid')
      expect(await reason({ op: 'set', entity: 'shots', id: shot, path: 'rank', value: 'a 1' })).toBe('invalid')
    })

    it('a batch is atomic: one bad patch and nothing lands', async () => {
      const { bus, shot } = await withShot()
      const before = structuredClone(bus.doc())
      const r = await bus.apply({ patches: [
        { op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 5, base_version: 1 },
        { op: 'set', entity: 'shots', id: shot, path: 'camera/size', value: 'enormous', base_version: 1 },
      ], why: { action: 'two writes' } })
      expect(r.applied).toBe(false)
      expect(bus.doc()).toEqual(before)
    })

    it('a job landing is one decision by the crew member, citing the job', async () => {
      const { bus, docId, chain } = await withShot()
      const job = id('job', 5)
      await bus.apply({ patches: [{ op: 'create', entity: 'jobs', id: job, value: jobValue(5, { op: 'shot_list', crew: 'dex', node: { kind: 'storyboard', id: sb(bus.doc()) } }), base_version: 0 }], why: { action: 'start plan', quiet: true } })
      const shots = [2, 3, 4].map((n) => id('shot', n))
      const r = await bus.apply({
        patches: shots.map((s, i) => ({ op: 'create' as const, entity: 'shots' as const, id: s, value: shotValue(sb(bus.doc()), `a${i + 2}`), base_version: 0 })),
        why: { action: 'plan 3 shots', agent: 'dex', cites: [`${docId}#jobs[${job}]`], rationale: 'three beats in the script' },
      })
      expect(r.applied).toBe(true)
      const [e] = await chain()
      expect(e.agent).toBe('dex')
      expect(e.cites).toEqual([`${docId}#jobs[${job}]`])
      expect(e.targets).toEqual(shots.map((s) => `${docId}#shots[${s}]`))
    })

    it('past 8 leaves, the targets are one per entity', async () => {
      const { bus, shot, docId, chain } = await withShot()
      const paths: [string, unknown][] = [['camera/size', 'wide'], ['camera/angle', 'low_angle'], ['camera/movement', 'pan'], ['camera/movement_speed', 'slow'],
        ['camera/lens_mm', 35], ['camera/macro', false], ['duration_s', 4], ['status', 'needs_review'], ['rank', 'a1']]
      await bus.apply({ patches: paths.map(([path, value]) => ({ op: 'set' as const, entity: 'shots' as const, id: shot, path, value, base_version: 1 })), why: { action: 'edit camera' } })
      expect((await chain())[0].targets).toEqual([`${docId}#shots[${shot}]`])
    })

    it('a quiet batch writes the data and no decision', async () => {
      const { bus, shot, chain } = await withShot()
      const n = (await chain()).length
      const r = await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'status', value: 'locked', base_version: 1 }], why: { action: 'set status', quiet: true } })
      expect(r.applied).toBe(true)
      expect(bus.doc().shots[shot].status).toBe('locked')
      expect(await chain()).toHaveLength(n)
    })

    it('the inverse undoes the batch', async () => {
      const { bus, shot } = await withShot()
      const before = structuredClone(bus.doc().shots[shot])
      const r = await bus.apply({ patches: [
        { op: 'set', entity: 'shots', id: shot, path: 'camera/size', value: 'close', base_version: 1 },
        { op: 'set', entity: 'shots', id: shot, path: 'pick/current', value: null, base_version: 1 },
        { op: 'create', entity: 'beats', id: id('beat', 1), value: { shot_id: shot, rank: 'a0', at_s: 1, kind: 'moment' }, base_version: 0 },
      ], why: { action: 'set and add' } })
      expect(r.applied).toBe(true)
      const back = await bus.apply(r.inverse!)
      expect(back.applied).toBe(true)
      const s = bus.doc().shots[shot]
      expect({ ...s, v: before.v, field_v: before.field_v }).toEqual(before)
      expect(bus.doc().beats[id('beat', 1)]).toBeUndefined()
    })
  })
}
