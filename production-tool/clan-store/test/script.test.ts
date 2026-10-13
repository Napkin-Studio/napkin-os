// What the Script editor needs from the store (features/script-editor.clan):
// typing bursts as LocalUndo text steps, the flat length checkpoint counts,
// and moveShot as one batch and one undo step.
import { describe, expect, it } from 'vitest'
import {
  checkpoint, flatLength, hydrate, integrity, LIMITS, LocalPatchBus, LocalTextBus, LocalUndo, moveShot, proseFromLines, unknownNames, type Prose,
} from '../src/index'
import { MAYA, defaults, id, shotValue, store } from './fixtures'

async function project() {
  const s = store()
  await s.create({ person: MAYA })
  const bus = new LocalPatchBus(s)
  const undo = new LocalUndo()
  const text = new LocalTextBus(bus)
  undo.bind(bus, text)
  return { s, bus, text, undo, ...defaults(s) }
}

const t = (text: string) => ({ type: 'text', text })
const mention = (refId: string, label: string) => ({ type: 'mention', attrs: { id: refId, label } })

describe('flatLength', () => {
  const refs = { [id('ref', 1)]: { key: 'maya', variant: 'laughing' } }
  it('counts a mention as checkpoint flattens it (@key_variant), not as its label', () => {
    const prose: Prose = { type: 'doc', content: [
      { type: 'action', content: [t('Walks.')] },
      { type: 'direction', content: [mention(id('ref', 1), 'm'), t(' smiles')] },
    ] }
    expect(flatLength(prose, refs, 'direction')).toBe('@maya_laughing smiles'.length)
    expect(flatLength(prose, refs, 'direction')).toBe(String(checkpoint('shot', prose, { refs }).fields.direction).length)
    expect(flatLength(prose.content![1], refs)).toBe(21)
  })

  it('a direction whose labels count under 4,000 but flattens past it is caught by the same count', () => {
    // 200 mentions labelled "m" (2 shown characters each) flatten to "@maya_laughing" (14 each).
    const many = Array.from({ length: 200 }, () => [mention(id('ref', 1), 'm'), t(' ')]).flat()
    const prose: Prose = { type: 'doc', content: [{ type: 'direction', content: [...many, t('x'.repeat(3990 - 600))] }] }
    expect(flatLength(prose, refs, 'direction')).toBeGreaterThan(LIMITS.shot.direction)
    expect(checkpoint('shot', prose, { refs }).overflow[0]).toMatchObject({ field: 'direction' })
  })

  it('unknownNames lists the names that match no ref', () => {
    const prose: Prose = { type: 'doc', content: [{ type: 'action', content: [mention('gone', 'jogger'), t(' and '), mention(id('ref', 1), 'maya')] }] }
    expect(unknownNames(prose, refs)).toEqual(['jogger'])
  })
})

describe('recordTyping', () => {
  it('a burst an editor made is one text step; undo puts the words back and writes the flat field', async () => {
    const { bus, text, undo, storyboard } = await project()
    const shot = id('shot', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot' } })
    await text.replace('shot', shot, proseFromLines('action', ['She runs.']), 'dex', { undo: false })
    const before = text.prose('shot', shot)
    // The editor's binding types (its origin is not a string: the person is the writer).
    text.ydoc.transact(() => hydrate(text.fragment('shot', shot), proseFromLines('action', ['She runs to the sea.'])), { binding: true })
    const after = text.prose('shot', shot)
    expect(text.recordTyping('shot', shot, before, after)).toBe(true)
    expect(text.recordTyping('shot', shot, after, after)).toBe(false)
    await text.checkpoint()
    expect(bus.doc().shots[shot]).toMatchObject({ action: 'She runs to the sea.', last_writer: `human:${MAYA.id}` })
    expect(undo.peek()).toBe('typing')
    expect(await undo.undo()).toMatchObject({ done: true })
    expect(bus.doc().shots[shot].action).toBe('She runs.')
    expect(await undo.redo()).toMatchObject({ done: true })
    expect(bus.doc().shots[shot].action).toBe('She runs to the sea.')
  })

  it('two bursts in two shots undo in order: the second, then the first', async () => {
    const { bus, text, undo, storyboard } = await project()
    const [a, b] = [id('shot', 1), id('shot', 2)]
    await bus.apply({ patches: [
      { op: 'create', entity: 'shots', id: a, value: shotValue(storyboard, 'a0'), base_version: 0 },
      { op: 'create', entity: 'shots', id: b, value: shotValue(storyboard, 'a1'), base_version: 0 },
    ], why: { action: 'create shots' } })
    for (const [s, w] of [[a, 'one'], [b, 'two']] as const) {
      const before = text.prose('shot', s)
      text.ydoc.transact(() => hydrate(text.fragment('shot', s), proseFromLines('action', [w])), { binding: true })
      text.recordTyping('shot', s, before, text.prose('shot', s))
    }
    await text.checkpoint()
    await undo.undo()
    expect(bus.doc().shots[b].action).toBe('')
    expect(bus.doc().shots[a].action).toBe('one')
    await undo.undo()
    expect(bus.doc().shots[a].action).toBe('')
  })
})

describe('beforePush', () => {
  it('an open burst is pushed before the next step, and before an undo', async () => {
    const { bus, text, undo, storyboard } = await project()
    const shot = id('shot', 1)
    await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot' } })
    let open: { before: Prose } | null = null
    undo.beforePush = () => {
      if (!open) return
      const o = open
      open = null
      text.recordTyping('shot', shot, o.before, text.prose('shot', shot))
    }
    open = { before: text.prose('shot', shot) }
    text.ydoc.transact(() => hydrate(text.fragment('shot', shot), proseFromLines('action', ['typed'])), { binding: true })
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 4, base_version: bus.doc().shots[shot].v }], why: { action: 'set duration' } })
    expect(undo.serialize().undo.map((s) => s.label)).toEqual(['create shot', 'typing', 'set duration'])
    open = { before: text.prose('shot', shot) }
    text.ydoc.transact(() => hydrate(text.fragment('shot', shot), proseFromLines('action', ['typed more'])), { binding: true })
    await text.checkpoint()
    expect(await undo.undo()).toMatchObject({ done: true, label: 'typing' })
    expect(text.prose('shot', shot)).toEqual(proseFromLines('action', ['typed']))
  })
})

describe('moveShot', () => {
  async function three() {
    const p = await project()
    const [s1, s2] = [id('scene', 1), id('scene', 2)]
    const [a, b, c] = [id('shot', 1), id('shot', 2), id('shot', 3)]
    await p.bus.apply({ patches: [
      { op: 'create', entity: 'scenes', id: s1, value: { script_id: p.script, rank: 'a0', heading: 'EXT. BEACH' }, base_version: 0 },
      { op: 'create', entity: 'scenes', id: s2, value: { script_id: p.script, rank: 'a1', heading: 'INT. CAR' }, base_version: 0 },
      { op: 'create', entity: 'shots', id: a, value: shotValue(p.storyboard, 'a0', { scene_id: s1 }), base_version: 0 },
      { op: 'create', entity: 'shots', id: b, value: shotValue(p.storyboard, 'a1', { scene_id: s1 }), base_version: 0 },
      { op: 'create', entity: 'shots', id: c, value: shotValue(p.storyboard, 'a2', { scene_id: s2 }), base_version: 0 },
    ], why: { action: 'create shots' } }, { undo: false })
    const order = () => Object.values(p.bus.doc().shots).sort((x, y) => (String(x.rank) < String(y.rank) ? -1 : 1)).map((x) => x.id)
    return { ...p, s1, s2, a, b, c, order }
  }

  it('within a scene: one rank write, one undo step, and the document stays valid', async () => {
    const { s, bus, undo, a, b, c, order } = await three()
    const n = (await s.chain()).length
    const r = await moveShot(bus, a, { beforeId: b, afterId: c })
    expect(r.applied).toBe(true)
    expect(order()).toEqual([b, a, c])
    expect(integrity(bus.doc() as never)).toEqual([])
    const chain = await s.chain()
    expect(chain).toHaveLength(n + 1)
    expect(chain[0].action).toBe(`move shots[${a}]`)
    await undo.undo()
    expect(order()).toEqual([a, b, c])
    expect(integrity(bus.doc() as never)).toEqual([])
  })

  it('across scenes: the rank and the scene in the same batch; undo takes both back', async () => {
    const { bus, undo, a, b, c, s2, s1, order } = await three()
    await moveShot(bus, a, { beforeId: c, afterId: null, sceneId: s2 })
    expect(order()).toEqual([b, c, a])
    expect(bus.doc().shots[a].scene_id).toBe(s2)
    expect(undo.peek()).toBe(`move shots[${a}]`)
    await undo.undo()
    expect(order()).toEqual([a, b, c])
    expect(bus.doc().shots[a].scene_id).toBe(s1)
    expect(integrity(bus.doc() as never)).toEqual([])
  })

  it('to the top, and neighbours given out of order land it right after the first one', async () => {
    const { bus, a, b, c, order } = await three()
    await moveShot(bus, c, { beforeId: null, afterId: a })
    expect(order()).toEqual([c, a, b])
    await moveShot(bus, c, { beforeId: b, afterId: a })
    expect(order()).toEqual([a, b, c])
  })
})
