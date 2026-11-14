import { MAX_STEPS } from '../../../clan-store/src'
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { cutItemFor } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { addFrame, addShots, addTake, content, id, job, MAYA, modelStore, SHA, T } from '../test/model'
import { deleteFrom, removeNote, removeShot, removeTake } from './remove'
import { emptyDocument, landUpdate, SnapshotDocumentStore, systemUpdate, updateDoc } from './store'
import { redo, stepWords, undo, undoLabels } from './undo'

// Undo anything a person did, any time (ui-behaviour 4.5, collab.md §10): clan-store's LocalUndo behind
// the document store. One person's action is one step; what happened since is left alone; a step someone
// changed since is skipped with the spec's notice.

function fixture(d: ProductionDocument) {
  const [s1, s2] = addShots(d, 2, { action: undefined })
  const f1 = addFrame(d, s1, SHA('a'), { pick: true })
  const f2 = addFrame(d, s2, SHA('b'), { pick: true })
  const jobs = ['1', '2', '3', '4'].map((c) => job(d, 'clip', [SHA('a')], SHA(c)))
  for (const j of jobs) d.jobs[j.id] = j
  const t1 = addTake(d, s1, SHA('1'), jobs[0], { pick: true })
  const t2 = addTake(d, s1, SHA('2'), jobs[1], { pick: true, parent: t1 })
  const t3 = addTake(d, s1, SHA('3'), jobs[2], { pick: true, parent: t2 })
  addTake(d, s2, SHA('4'), jobs[3], { pick: true })
  const note = { id: id('rev'), v: 1, field_v: {}, target: { kind: 'generation' as const, id: t3.id }, shot_id: s1.id, by: `human:${MAYA.id}`, state: 'open' as const, text: 'keep it a guinea pig', created_at: T }
  d.reviews[note.id] = note
  return { s1, s2, f1, f2, t1, t2, t3, note }
}

async function setup() {
  const store = modelStore()
  await store.create(MAYA, 'Rain')
  let out: ReturnType<typeof fixture> | undefined
  await systemUpdate(store, (d) => { out = fixture(d) }, 'sync')
  await store.flush()
  if (store.trouble) throw new Error(`the fixture was refused: ${store.trouble}`)
  return { store, ...out! }
}

const steps = (s: ModelStore) => s.undoer.serialize()

describe('undo and redo on the document', () => {
  it('a deleted clip version comes back exactly, with its note and the cut\'s pick; redo deletes it again', async () => {
    const { store, s1, t3, note } = await setup()
    const before = content(store.get())
    await deleteFrom(store, (d) => removeTake(d, t3.id))
    await store.flush()
    expect(store.get().generations[t3.id]).toBeUndefined()
    expect(store.get().reviews[note.id]).toBeUndefined()
    expect(stepWords(undoLabels(store).undo!)).toBe('delete clip (shot 1, v3)')
    expect(await undo(store)).toMatchObject({ done: true })
    expect(content(store.get())).toEqual(before)
    expect(cutItemFor(store.get(), s1.id)!.source?.generation_id).toBe(t3.id)
    expect(await redo(store)).toMatchObject({ done: true })
    expect(store.get().generations[t3.id]).toBeUndefined()
  })

  it('bookkeeping and the crew\'s landings are not steps, and undo leaves them alone', async () => {
    const { store, s2, t3 } = await setup()
    await deleteFrom(store, (d) => removeTake(d, t3.id))
    let landed = ''
    await landUpdate(store, (d) => { landed = addFrame(d, d.shots[s2.id], SHA('c')).id }, { action: 'render frame v2 for shot 2', agent: 'wren' })
    await systemUpdate(store, (d) => { d.assets[SHA('d')] = { sha256: SHA('d'), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] } }, 'add picture')
    await store.flush()
    expect(steps(store).undo).toHaveLength(1)
    await undo(store)
    expect(store.get().generations[t3.id]).toBeDefined()
    expect(store.get().frames[landed]).toBeDefined()
    expect(store.get().assets[SHA('d')]).toBeDefined()
  })

  it('a deleted shot comes back with its frames and clips, in its place', async () => {
    const { store, s1 } = await setup()
    const before = content(store.get())
    await deleteFrom(store, (d) => removeShot(d, s1.id))
    await store.flush()
    expect(store.get().shots[s1.id]).toBeUndefined()
    await undo(store)
    expect(content(store.get())).toEqual(before)
  })

  it('steps undo newest first, and a new step after an undo clears redo', async () => {
    const { store, s1, s2, note } = await setup()
    await updateDoc(store, (d) => { d.shots[s1.id].duration_s = 4 }, 'edit shot')
    await deleteFrom(store, (d) => removeNote(d, note.id))
    await store.flush()
    expect(steps(store).undo).toHaveLength(2)
    await undo(store) // the note comes back
    expect(store.get().reviews[note.id]).toBeDefined()
    expect(store.get().shots[s1.id].duration_s).toBe(4)
    expect(steps(store).redo).toHaveLength(1)
    await updateDoc(store, (d) => { d.shots[s2.id].duration_s = 3 }, 'edit shot')
    await store.flush()
    expect(steps(store).redo).toEqual([])
  })

  it('typing in one field is one step, back to before the first keystroke', async () => {
    const { store, s1 } = await setup()
    for (const text of ['g', 'gu', 'gui', 'a guinea pig']) void updateDoc(store, (d) => { d.shots[s1.id].action = text }, 'edit shot')
    await store.flush()
    expect(store.get().shots[s1.id].action).toBe('a guinea pig')
    expect(steps(store).undo).toHaveLength(1)
    await undo(store)
    expect(store.get().shots[s1.id].action ?? '').toBe('')
  })

  it('a step someone changed since is skipped, with the spec\'s notice', async () => {
    const { store, s1 } = await setup()
    await updateDoc(store, (d) => { d.shots[s1.id].camera.size = 'close' }, 'edit shot')
    await store.flush()
    // Someone else (here, the crew) writes the same leaf afterwards.
    await landUpdate(store, (d) => { d.shots[s1.id].camera.size = 'wide' }, { action: 'set shot 1', agent: 'dex' })
    await store.flush()
    const r = await undo(store)
    expect(r).toMatchObject({ done: false, notice: 'Someone changed this after you, so undo skipped it.' })
    expect(store.get().shots[s1.id].camera.size).toBe('wide')
    expect(undoLabels(store).undo).toBeNull()
  })

  it(`keeps the last ${MAX_STEPS} steps`, async () => {
    const { store, s1 } = await setup()
    for (let i = 1; i <= MAX_STEPS + 5; i++) void updateDoc(store, (d) => { d.shots[s1.id].duration_s = (i % 9) + 1 }, `edit ${i}`)
    await store.flush()
    expect(steps(store).undo).toHaveLength(MAX_STEPS)
    expect(steps(store).undo[0].label).toBe('edit 6')
    // 105 writes through the wasm engine: about 1.4 s alone, past vitest's 5 s default when the full
    // suite (79 files since script-editor) shares the machine.
  }, 30_000)

  it('there is no undo without the .clan engine', async () => {
    const store = new SnapshotDocumentStore(emptyDocument(MAYA), null, 0)
    expect(await undo(store)).toBeNull()
    expect(undoLabels(store)).toEqual({ undo: null, redo: null })
  })

  it('says a step in plain words', () => {
    expect(stepWords('delete clip gen_01M4EP36MVQNQEHE0NP83FD7RN (shot 3, v4)')).toBe('delete clip (shot 3, v4)')
    expect(stepWords('pick take v2 for shot 3')).toBe('pick take v2 for shot 3')
  })
})
