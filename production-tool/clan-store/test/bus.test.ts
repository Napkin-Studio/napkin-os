// LocalPatchBus passes the PatchBus contract; LocalUndo groups and persists steps.
import { describe, expect, it } from 'vitest'
import { LocalPatchBus, LocalTextBus, LocalUndo, proseFromLines, type SerializedUndo } from '../src/index'
import { busContract } from './bus.contract'
import { MAYA, SAI, defaults, id, shotValue, store } from './fixtures'

busContract('LocalPatchBus', async () => {
  const s = store()
  await s.create({ person: MAYA })
  return { bus: new LocalPatchBus(s), docId: s.documentId(), person: 'human:p_maya001', chain: () => s.chain() }
})

async function setup(saved?: SerializedUndo | null) {
  const s = store()
  await s.create({ person: MAYA })
  const bus = new LocalPatchBus(s)
  const text = new LocalTextBus(bus)
  let persisted: SerializedUndo | null = null
  const undo = new LocalUndo({ saved, onChange: (x) => { persisted = x } })
  undo.bind(bus, text)
  const shot = id('shot', 1)
  await bus.apply({ patches: [{ op: 'create', entity: 'shots', id: shot, value: shotValue(defaults(s).storyboard, 'a0'), base_version: 0 }], why: { action: 'create shot 1' } })
  return { s, bus, text, undo, shot, persisted: () => persisted }
}

describe('LocalUndo', () => {
  it('one user action that writes fields and text is one step', async () => {
    const { bus, text, undo, shot } = await setup()
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 5, base_version: 2 }], why: { action: 'set duration' } })
    await text.replace('shot', shot, proseFromLines('action', ['She runs.']), 'human:p_maya001', { joinStep: true })
    expect(bus.doc().shots[shot].action).toBe('She runs.')
    expect(await undo.undo()).toMatchObject({ done: true, label: 'set duration' })
    expect(bus.doc().shots[shot].duration_s).toBe(3)
    expect(bus.doc().shots[shot].action).toBe('')
    expect(await undo.redo()).toMatchObject({ done: true })
    expect(bus.doc().shots[shot].duration_s).toBe(5)
    expect(bus.doc().shots[shot].action).toBe('She runs.')
  })

  it('a reorder is one rank write and one step, and undo survives a reload', async () => {
    const { s, bus, undo, shot, persisted } = await setup()
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'rank', value: 'a5', base_version: 2 }], why: { action: 'move shot 1' } })
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'status', value: 'locked', base_version: 3 }], why: { action: 'lock shot 1' } })
    expect(undo.peek()).toBe('lock shot 1')
    // Reload: a new store from the bytes, a new undo from what was persisted.
    const bytes = await s.exportClan()
    const s2 = store()
    await s2.open(bytes)
    const bus2 = new LocalPatchBus(s2)
    const text2 = new LocalTextBus(bus2)
    const undo2 = new LocalUndo({ saved: persisted() })
    undo2.bind(bus2, text2)
    text2.hydrateAll()
    expect(await undo2.undo()).toMatchObject({ done: true, label: 'lock shot 1' })
    expect(await undo2.undo()).toMatchObject({ done: true, label: 'move shot 1' })
    expect(bus2.doc().shots[shot].rank).toBe('a0')
    expect(bus2.doc().shots[shot].status).toBe('planned')
    void undo
  })

  it('a text step survives a reload too (as a prose snapshot)', async () => {
    const { s, text, shot, persisted } = await setup()
    await text.replace('shot', shot, proseFromLines('action', ['First words.']), 'human:p_maya001')
    const s2 = store()
    await s2.open(await s.exportClan())
    const bus2 = new LocalPatchBus(s2)
    const text2 = new LocalTextBus(bus2)
    text2.hydrateAll()
    const undo2 = new LocalUndo({ saved: persisted() })
    undo2.bind(bus2, text2)
    expect(await undo2.undo()).toMatchObject({ done: true })
    expect(bus2.doc().shots[shot].action).toBe('')
  })

  it('skips a step someone changed after, with the notice, and moves on', async () => {
    const { s, bus, undo, shot } = await setup()
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 5, base_version: 2 }], why: { action: 'set duration' } })
    // Sai changes the same field after (another person's bus over the same store).
    s.setPerson(SAI)
    const sai = new LocalPatchBus(s)
    await sai.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 6, base_version: 3 }], why: { action: 'set duration' } })
    s.setPerson(MAYA)
    const r = await undo.undo()
    expect(r.done).toBe(false)
    expect(r.notice).toBe('Someone changed this after you, so undo skipped it.')
    expect(bus.doc().shots[shot].duration_s).toBe(6)
    // The next step back is the shot's creation.
    expect(undo.peek()).toBe('create shot 1')
  })

  it('quiet writes and writes passed undo: false are not steps', async () => {
    const { bus, undo, shot } = await setup()
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'status', value: 'locked', base_version: 2 }], why: { action: 'job state', quiet: true } })
    await bus.apply({ patches: [{ op: 'set', entity: 'shots', id: shot, path: 'duration_s', value: 4, base_version: 3 }], why: { action: 'answer ask' } }, { undo: false })
    expect(undo.peek()).toBe('create shot 1')
  })
})

describe('a text on the canvas (README item 20)', () => {
  it('is written to texts and linked into a script as a note; the schema and the integrity check take it', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const bus = new LocalPatchBus(s)
    const t = id('text', 1)
    const script = defaults(s).script
    const r = await bus.apply({ patches: [
      { op: 'create', entity: 'texts', id: t, value: { node: 'own_text_1', words: 'Rain on the window.' }, base_version: 0 },
      { op: 'create', entity: 'links', id: id('link', 1), value: { from: { kind: 'text', id: t }, to: { kind: 'script', id: script }, role: 'note' }, base_version: 0 },
    ], why: { action: 'link a text' } })
    expect(r.refused).toEqual([])
    expect(bus.doc().texts[t].words).toBe('Rain on the window.')
  })
})
