// A panel's change as the buses carry it: creates, deletes, one set per leaf, and live text.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'
import { addFrame, addShots, addTake, id, job, MAYA, SHA } from '../test/model'
import { changeOf, proseFromText } from './diff'
import { mainVideo } from './selectors'

function base() {
  const d = emptyDocument(MAYA, 'Rain')
  const [s1, s2] = addShots(d, 2)
  const f1 = addFrame(d, s1, SHA('a'), { pick: true })
  const f2 = addFrame(d, s1, SHA('b'))
  const j = job(d, 'clip', [], SHA('1'))
  d.jobs[j.id] = j
  const t1 = addTake(d, s1, SHA('1'), j, { pick: true })
  const t2 = addTake(d, s1, SHA('2'), j)
  const ref = { id: id('ref'), v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character' as const, asset: SHA('a') }
  d.refs[ref.id] = ref
  const key = { id: id('key'), v: 1, field_v: {}, key: 'maya', role: 'character' as const }
  d.keys[key.id] = key
  return { d, s1, s2, f1, f2, t1, t2, ref, key }
}

const after = (d: ProductionDocument, fn: (x: ProductionDocument) => void) => {
  const x = structuredClone(d)
  fn(x)
  return x
}

describe('changeOf', () => {
  it('nothing changed: nothing to write', () => {
    const { d } = base()
    expect(changeOf(d, structuredClone(d))).toEqual({ patches: [], text: [] })
  })

  it('a new entity is one create, without what the bus owns (id, v, field_v)', () => {
    const { d, s1 } = base()
    let frameId = ''
    const { patches, text } = changeOf(d, after(d, (x) => { frameId = addFrame(x, x.shots[s1.id], SHA('c')).id }))
    const create = patches.find((p) => p.op === 'create' && p.entity === 'frames')!
    expect(create).toMatchObject({ id: frameId, base_version: 0 })
    expect(create.value).not.toHaveProperty('id')
    expect(create.value).not.toHaveProperty('v')
    expect(create.value).not.toHaveProperty('field_v')
    expect(create.value).toMatchObject({ shot_id: s1.id, version: 3, asset: SHA('c') })
    // The new asset is created whole (assets are not versioned entities).
    expect(patches.find((p) => p.entity === 'assets')).toMatchObject({ op: 'create', id: SHA('c'), value: { sha256: SHA('c') } })
    expect(text).toEqual([])
  })

  it('a deleted entity is one delete at the version it had', () => {
    const { d, f2 } = base()
    const before = after(d, (x) => { x.frames[f2.id].v = 4 })
    const { patches } = changeOf(before, after(before, (x) => { delete x.frames[f2.id] }))
    expect(patches).toEqual([{ op: 'delete', entity: 'frames', id: f2.id, base_version: 4 }])
  })

  it('the camera is set leaf by leaf', () => {
    const { d, s1 } = base()
    const { patches } = changeOf(d, after(d, (x) => {
      x.shots[s1.id].camera.size = 'close'
      x.shots[s1.id].camera.movement = 'push_in'
      x.shots[s1.id].duration_s = 3
    }))
    expect(patches.map((p) => [p.op, p.path, p.op === 'set' ? p.value : undefined])).toEqual(expect.arrayContaining([
      ['set', 'camera/size', 'close'], ['set', 'camera/movement', 'push_in'], ['set', 'duration_s', 3],
    ]))
    expect(patches).toHaveLength(3)
    expect(patches.every((p) => p.entity === 'shots' && p.id === s1.id && p.base_version === 1)).toBe(true)
  })

  it('a shot\'s pick is set part by part, and taken away part by part', () => {
    const { d, s1, s2, f1, f2 } = base()
    const picked = changeOf(d, after(d, (x) => { x.shots[s1.id].pick = { current: f2.id, alternates: [f1.id] } })).patches
    expect(picked.map((p) => [p.path, p.op === 'set' ? p.value : undefined])).toEqual([['pick/current', f2.id], ['pick/alternates', [f1.id]]])
    const first = changeOf(d, after(d, (x) => { x.shots[s2.id].pick = { current: f1.id } })).patches
    expect(first.map((p) => [p.path, p.op === 'set' ? p.value : undefined])).toEqual([['pick/current', f1.id]])
    const gone = changeOf(d, after(d, (x) => { delete x.shots[s1.id].pick })).patches
    expect(gone.map((p) => [p.path, p.op === 'set' ? p.value : undefined])).toEqual(expect.arrayContaining([['pick/current', null]]))
  })

  it('the cut: a clip is set by its parts; a clip added or taken away is set whole', () => {
    const { d, s1, t2 } = base()
    const v = mainVideo(d)!
    const [itemId] = Object.keys(v.timeline)
    const swap = changeOf(d, after(d, (x) => { x.videos[v.id].timeline[itemId].source!.generation_id = t2.id })).patches
    expect(swap.map((p) => [p.entity, p.path, p.op === 'set' ? p.value : undefined])).toEqual([['videos', `timeline/${itemId}/source/generation_id`, t2.id]])
    const moved = changeOf(d, after(d, (x) => { x.videos[v.id].timeline[itemId].start_s = 2 })).patches
    expect(moved.map((p) => p.path)).toEqual([`timeline/${itemId}/start_s`])
    const newId = id('item')
    const clip = { track: 'V1' as const, start_s: 9, source: { generation_id: t2.id, in_s: 0, out_s: 1 }, follows: { shot_id: s1.id } }
    const added = changeOf(d, after(d, (x) => { x.videos[v.id].timeline[newId] = clip })).patches
    expect(added.map((p) => [p.path, p.op === 'set' ? p.value : undefined])).toEqual([[`timeline/${newId}`, clip]])
    const removed = changeOf(d, after(d, (x) => { delete x.videos[v.id].timeline[itemId] })).patches
    expect(removed.map((p) => [p.path, p.op === 'set' ? p.value : undefined])).toEqual([[`timeline/${itemId}`, null]])
  })

  it('words a panel changes go to the text bus, never a patch; @names become mentions', () => {
    const { d, s1, ref, key } = base()
    const { patches, text } = changeOf(d, after(d, (x) => {
      x.shots[s1.id].action = '@maya_front runs. @maya waves.'
      x.shots[s1.id].direction = 'Handheld,\nclose.'
    }))
    expect(patches).toEqual([])
    expect(text).toHaveLength(1)
    expect(text[0]).toMatchObject({ kind: 'shot', id: s1.id })
    const blocks = text[0].prose.content as { type: string; content?: { type: string; attrs?: { id: string } }[] }[]
    expect(blocks.map((b) => b.type)).toEqual(['action', 'direction'])
    expect(blocks[0].content!.filter((n) => n.type === 'mention').map((n) => n.attrs!.id)).toEqual([ref.id, key.id])
  })

  it('a new note with words is a create and a text write', () => {
    const { d, t1 } = base()
    const revId = id('rev')
    const { patches, text } = changeOf(d, after(d, (x) => {
      x.reviews[revId] = { id: revId, v: 1, field_v: {}, target: { kind: 'generation', id: t1.id }, by: `human:${MAYA.id}`, state: 'open', text: 'Brighter.', created_at: '2026-10-13T10:00:00Z' }
    }))
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ op: 'create', entity: 'reviews', id: revId })
    expect(patches[0].value).not.toHaveProperty('text')
    expect(text).toEqual([{ kind: 'review', id: revId, prose: proseFromText(d, [{ type: 'action', text: 'Brighter.' }]) }])
  })

  it('the project is set field by field', () => {
    const { d } = base()
    const { patches } = changeOf(d, after(d, (x) => { x.project.title = 'Sun' }))
    expect(patches).toEqual([{ op: 'set', entity: 'project', id: d.project.id, path: 'title', value: 'Sun', base_version: 0 }])
  })
})
