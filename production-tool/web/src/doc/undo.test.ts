import { describe, expect, it } from 'vitest'
import type { Frame, ProductionDocument, Shot, Take } from '../contracts/types'
import { newId } from '../lib/ulid'
import { deleteFrom, removeNote, removeShot, removeTake } from './remove'
import { emptyDocument, SnapshotDocumentStore, systemUpdate, updateDoc } from './store'
import { apply, diff, invert, keepUndo, MAX_STEPS, memoryKeeper, MERGE_MS, noteStep, redo, stepWords, undo, undoState } from './undo'

// Undo anything a person did, any time (features/system-undo.clan).

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const T = '2026-10-09T10:00:00Z'

function shot(order: number): Shot {
  return { id: newId('shot'), order, duration_s: 5, composition: 'medium', action: `shot ${order}`, camera_move: 'static', refs: [], status: 'locked' }
}

function setup() {
  const d = emptyDocument({ id: 'p_test01', handle: 'maya' })
  const s1 = shot(1)
  const s2 = shot(2)
  d.shots = [s1, s2]
  const frame = (shotId: string, c: string, selected: boolean): Frame => ({ id: newId('frame'), shot_id: shotId, asset: SHA(c), job_id: newId('job'), selected, kind: 'mock' })
  const f1 = frame(s1.id, 'a', true)
  const f2 = frame(s2.id, 'b', true)
  d.frames = [f1, f2]
  s1.storyboard_frame = f1.asset
  s2.storyboard_frame = f2.asset
  const take = (c: string, selected: boolean, parent?: string): Take => ({ id: newId('take'), shot_id: s1.id, asset: SHA(c), job_id: newId('job'), kind: 'mock', provider: 'mock', selected, ...(parent ? { parent } : {}) })
  const t1 = take('1', false)
  const t2 = take('2', false, t1.id)
  const t3 = take('3', true, t2.id)
  d.takes = [t1, t2, t3]
  s1.selected_take = t3.id
  const note = { id: newId('pin'), target: { kind: 'take' as const, id: t3.id }, comment: 'keep it a guinea pig', at_s: 1.2, resolved: false, created_at: T }
  d.reviews = [note]
  const store = new SnapshotDocumentStore(d, null, 0)
  keepUndo(store, memoryKeeper())
  return { store, s1, s2, f1, f2, t1, t2, t3, note }
}

const plain = (d: ProductionDocument) => JSON.parse(JSON.stringify(d))

describe('steps: what changed, item by item', () => {
  it('a removed item goes back where it was; an added one goes; a field gets its value back', () => {
    const before = { takes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], title: 'x' }
    const after = { takes: [{ id: 'a' }, { id: 'c' }, { id: 'd' }], title: 'y' }
    const ops = diff(before, after)
    const doc = structuredClone(after)
    expect(apply(doc, invert(ops))).toBe(0)
    expect(doc).toEqual(before)
    expect(apply(doc, ops)).toBe(0)
    expect(doc).toEqual(after)
  })

  it('the job list, the stage and the participant are never part of a step', () => {
    const before = { jobs: [{ id: 'j1', state: 'queued' }], stage: { current: 'video' }, participant: { id: 'p', handle: 'a' }, frames: [] }
    const after = { jobs: [{ id: 'j1', state: 'completed' }], stage: { current: 'storyboard' }, participant: { id: 'p', handle: 'b' }, frames: [] }
    expect(diff(before, after)).toEqual([])
  })

  it('stale marks are matched by what they mark, so undo puts the right ones back', () => {
    const mark = (id: string) => ({ target: { kind: 'take', id }, caused_by: { kind: 'frame', id: 'f' }, reason: 'r', marked_at: T })
    const before = { stale: [mark('t1'), mark('t2')] }
    const after = { stale: [mark('t2')] }
    const doc = structuredClone(after)
    apply(doc, invert(diff(before, after)))
    expect(doc.stale.map((m) => m.target.id).sort()).toEqual(['t1', 't2'])
  })
})

describe('undo and redo on the document', () => {
  it('a deleted clip version comes back exactly, with its note and the selection', async () => {
    const { store, s1, t3, note } = setup()
    const before = plain(store.get())
    await deleteFrom(store, (d) => removeTake(d, t3.id))
    expect(store.get().takes!.some((t) => t.id === t3.id)).toBe(false)
    expect(store.get().reviews!.some((r) => r.id === note.id)).toBe(false)
    const r = await undo(store)
    expect(r?.partial).toBe(false)
    expect(plain(store.get()).takes).toEqual(before.takes)
    expect(plain(store.get()).reviews).toEqual(before.reviews)
    expect(store.get().shots!.find((s) => s.id === s1.id)!.selected_take).toBe(t3.id)
    await redo(store)
    expect(store.get().takes!.some((t) => t.id === t3.id)).toBe(false)
  })

  it('undo leaves alone what happened since: a result that landed after the delete stays', async () => {
    const { store, s2, t3 } = setup()
    await deleteFrom(store, (d) => removeTake(d, t3.id))
    const landed: Frame = { id: newId('frame'), shot_id: s2.id, asset: SHA('c'), job_id: newId('job'), selected: false, kind: 'mock' }
    await systemUpdate(store, (d) => { d.frames!.push(landed) }, 'frame') // a result landing: not a step
    expect(undoState(store).done).toHaveLength(1)
    await undo(store)
    expect(store.get().takes!.some((t) => t.id === t3.id)).toBe(true)
    expect(store.get().frames!.some((f) => f.id === landed.id)).toBe(true)
  })

  it('a deleted shot comes back with its frames and clips, in its place', async () => {
    const { store, s1 } = setup()
    const before = plain(store.get())
    await deleteFrom(store, (d) => removeShot(d, s1.id))
    expect(store.get().shots!.map((s) => s.id)).not.toContain(s1.id)
    await undo(store)
    const now = plain(store.get())
    expect(now.shots).toEqual(before.shots)
    expect(now.frames).toEqual(before.frames)
    expect(now.takes).toEqual(before.takes)
  })

  it('steps undo newest first, and a new step after an undo clears redo', async () => {
    const { store, s1, note } = setup()
    await updateDoc(store, (d) => { d.shots![0].action = 'a guinea pig on a roof' }, 'edit shot')
    await deleteFrom(store, (d) => removeNote(d, note.id))
    expect(undoState(store).done.map((s) => stepWords(s.label))).toHaveLength(2)
    await undo(store) // the note comes back
    expect(store.get().reviews!.some((r) => r.id === note.id)).toBe(true)
    expect(store.get().shots!.find((s) => s.id === s1.id)!.action).toBe('a guinea pig on a roof')
    await updateDoc(store, (d) => { d.shots![1].duration_s = 3 }, 'edit shot')
    expect(undoState(store).undone).toEqual([])
  })

  it('typing in one field moments apart is one step, back to before the first keystroke', async () => {
    const { store } = setup()
    const at = Date.now()
    for (const [i, text] of ['g', 'gu', 'gui'].entries()) {
      const before = store.get()
      const draft = structuredClone(before)
      draft.shots![0].action = text
      noteStep(store, before, draft, 'edit shot', at + i * (MERGE_MS / 4))
      await systemUpdate(store, (d) => { d.shots![0].action = text })
    }
    expect(undoState(store).done).toHaveLength(1)
    await undo(store)
    expect(store.get().shots![0].action).toBe('shot 1')
  })

  it('a step whose things are gone undoes what it can and says so', async () => {
    const { store, t1, t3 } = setup()
    await updateDoc(store, (d) => {
      for (const t of d.takes!) t.selected = t.id === t1.id
    }, 'pick take')
    await systemUpdate(store, (d) => { d.takes = d.takes!.filter((t) => t.id !== t3.id) }) // t3 went some other way
    const r = await undo(store)
    expect(r?.partial).toBe(true)
    expect(store.get().takes!.find((t) => t.id === t1.id)!.selected).toBe(false)
  })

  it('keeps the last 100 steps', async () => {
    const { store } = setup()
    for (let i = 0; i < MAX_STEPS + 5; i++) await updateDoc(store, (d) => { d.shots![0].duration_s = i }, `edit ${i}`)
    expect(undoState(store).done).toHaveLength(MAX_STEPS)
    expect(undoState(store).done[0].label).toBe('edit 5')
  })

  it('says a step in plain words', () => {
    expect(stepWords('deleted clip take_01M4EP36MVQNQEHE0NP83FD7RN (shot 3, v4)')).toBe('deleted clip (shot 3, v4)')
    expect(stepWords('pick take')).toBe('picked a clip version')
  })
})
