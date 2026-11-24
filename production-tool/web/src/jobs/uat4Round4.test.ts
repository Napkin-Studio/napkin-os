// UAT round 4, Production round 4 (local run): a plan's question that a later plan answered is withdrawn and no longer
// shown (L4), and "making" counts only what is being made (L6).
import { describe, expect, it } from 'vitest'
import type { Ask, ProductionDocument } from '../contracts/types'
import { openAsks, supersededAsk } from '../model/selectors'
import { id, job, MAYA, modelStore, seedStages } from '../test/model'
import { earlierPlanAsks } from './plan'
import { isMaking } from './runner'

const ask = (jobId: string, nodeId: string): Ask => ({
  id: id('ask'), v: 1, field_v: {}, job_id: jobId, crew: 'dex', state: 'open', answers: [],
  node: { kind: 'storyboard', id: nodeId }, question: { id: 'q1', text: 'The script is empty. What should happen in this 15-second film?', options: [] },
} as unknown as Ask)

describe('a plan question that a later plan answered (L4)', () => {
  it('is superseded once a later plan of the same storyboard is done, and withdrawn when that plan lands', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Copperell')
    await seedStages(s)
    const d = structuredClone(s.get()) as ProductionDocument
    const first = { ...job(d, 'shot_list', [], null, { state: 'needs_input', created_at: '2026-11-24T12:00:00Z' }), id: id('job') }
    d.jobs[first.id] = first
    const q = ask(first.id, first.node.id)
    d.asks[q.id] = q
    expect(openAsks(d).map((a) => a.id)).toEqual([q.id])
    const second = { ...job(d, 'shot_list', [], null, { state: 'completed', created_at: '2026-11-24T12:05:00Z' }), id: id('job') }
    d.jobs[second.id] = second
    expect(supersededAsk(d, q)).toBe(true)
    expect(openAsks(d)).toEqual([])
    expect(earlierPlanAsks(d, first.node.id, second.id)).toEqual([q.id])
    expect(earlierPlanAsks(d, first.node.id, first.id)).toEqual([])
  })
  it('an empty storyboard\'s "The script is empty" is answered once a script-driven storyboard is planned (local run)', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Copperell')
    await seedStages(s)
    const d = structuredClone(s.get()) as ProductionDocument
    const driven = Object.values(d.links).find((l) => l.role === 'drives' && l.to.kind === 'storyboard')!.to.id
    const empty = id('storyboard')
    d.storyboards[empty] = { ...d.storyboards[driven], id: empty, title: 'Film' }
    const first = { ...job(d, 'shot_list', [], null, { state: 'needs_input', created_at: '2026-11-24T12:58:00Z', node: { kind: 'storyboard', id: empty } }), id: id('job') }
    d.jobs[first.id] = first
    const q = ask(first.id, empty)
    d.asks[q.id] = q
    expect(supersededAsk(d, q)).toBe(false)
    const planned = { ...job(d, 'shot_list', [], null, { state: 'completed', created_at: '2026-11-24T13:05:00Z', node: { kind: 'storyboard', id: driven } }), id: id('job') }
    d.jobs[planned.id] = planned
    expect(supersededAsk(d, q)).toBe(true)
    expect(earlierPlanAsks(d, driven, planned.id)).toEqual([q.id])
  })

  it('a question of the latest plan stands', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Copperell')
    await seedStages(s)
    const d = structuredClone(s.get()) as ProductionDocument
    const only = { ...job(d, 'shot_list', [], null, { state: 'needs_input' }), id: id('job') }
    d.jobs[only.id] = only
    const q = ask(only.id, only.node.id)
    d.asks[q.id] = q
    expect(supersededAsk(d, q)).toBe(false)
    expect(openAsks(d).map((a) => a.id)).toEqual([q.id])
  })
})

describe('what counts as making (L6)', () => {
  it('a job waiting on a person or on its own outcome is not being made', () => {
    expect(isMaking('submitted')).toBe(true)
    expect(isMaking('queued')).toBe(true)
    expect(isMaking('needs_input')).toBe(false)
    expect(isMaking('uncertain')).toBe(false)
    expect(isMaking('completed')).toBe(false)
  })
})
