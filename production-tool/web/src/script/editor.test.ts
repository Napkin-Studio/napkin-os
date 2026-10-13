// @vitest-environment happy-dom
// The Script editor's editors over the real store (features/script-editor.clan): typing as
// LocalUndo steps (collapse, two shots, reload, a reorder after typing), attribution, and
// the direction limit counted as checkpoint counts it.

import { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'
import { memoryPersistence, ClanDocumentStore, type SerializedUndo } from '../../../clan-store/src'
import { ModelStore } from '../model/store'
import { keepsItsOwnUndo } from '../ui/undoKeys'
import { addShots, asset, id, MAYA, modelStore, SHA, wasm } from '../test/model'
import { editorExtensions, pasteWithin } from './extensions'
import { trackTyping } from './typing'
import { moveShotTo } from './edits'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy()
})

/** A bound editor on an entity's fragment, as the page mounts one. */
function mount(store: ModelStore, kind: 'shot' | 'scene' | 'beat', id: string, opts: { notice?: (m: string) => void } = {}) {
  const element = document.createElement('div')
  element.setAttribute('data-script-editor', '')
  document.body.appendChild(element)
  const d = store.get()
  const refs = () => Object.fromEntries(Object.entries(d.refs).map(([rid, r]) => [rid, { key: r.key, variant: r.variant }]))
  const editor = new Editor({ element, extensions: editorExtensions({ kind, fragment: store.text.fragment(kind, id), refs, notice: opts.notice }) })
  const untrack = trackTyping(editor, store.typing, kind, id)
  editors.push(editor)
  return { editor, unmount: () => { untrack(); editor.destroy() } }
}

async function project(opts: { persistence?: ReturnType<typeof memoryPersistence>; undo?: { saved: SerializedUndo | null | undefined; save: (s: SerializedUndo) => void } } = {}) {
  const store = modelStore(opts)
  await store.create(MAYA, 'Script')
  await store.change((d) => { addShots(d, 3, { status: 'planned' }) }, { action: 'create shots' })
  await store.flush()
  const shots = Object.values(store.get().shots).sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((s) => s.id)
  return { store, shots }
}

const typeAtEnd = (editor: Editor, text: string) => {
  editor.commands.focus('end')
  editor.commands.insertContent(text)
}

describe('typing is LocalUndo steps', () => {
  it('mounting an editor on an empty shot writes nothing', async () => {
    const { store, shots } = await project()
    const before = store.get().shots[shots[0]]
    mount(store, 'shot', shots[0])
    await store.flush()
    expect(store.get().shots[shots[0]].last_writer).toBe(before.last_writer)
    expect(store.text.prose('shot', shots[0]).content ?? []).toEqual([])
    expect(store.undoLabels().undo).toBe('create shots')
  })

  it('type → collapse → ⌘Z undoes that typing, not the step before it', async () => {
    const { store, shots } = await project()
    const { editor, unmount } = mount(store, 'shot', shots[1])
    typeAtEnd(editor, 'She runs to the sea.')
    unmount() // the shot collapses: its burst closes
    await store.flush()
    expect(store.get().shots[shots[1]].action).toBe('She runs to the sea.')
    expect(store.get().shots[shots[1]].last_writer).toBe(`human:${MAYA.id}`)
    expect(store.undoLabels().undo).toBe('typing')
    expect(await store.undo()).toMatchObject({ done: true, label: 'typing' })
    expect(store.get().shots[shots[1]].action ?? '').toBe('')
    expect(store.undoLabels().undo).toBe('create shots')
  })

  it('type in shot 2 → type in shot 3 → ⌘Z ⌘Z undoes shot 3, then shot 2', async () => {
    const { store, shots } = await project()
    const a = mount(store, 'shot', shots[1])
    typeAtEnd(a.editor, 'Two.')
    const b = mount(store, 'shot', shots[2])
    a.editor.commands.blur()
    store.typing.close('shot', shots[1]) // the caret left shot 2
    typeAtEnd(b.editor, 'Three.')
    await store.undo()
    expect(store.get().shots[shots[2]].action ?? '').toBe('')
    expect(store.get().shots[shots[1]].action).toBe('Two.')
    expect(b.editor.getText()).toBe('')
    await store.undo()
    expect(store.get().shots[shots[1]].action ?? '').toBe('')
    expect(a.editor.getText()).toBe('')
  })

  it('a reorder after typing undoes in stack order: the move, then the typing', async () => {
    const { store, shots } = await project()
    const { editor } = mount(store, 'shot', shots[0])
    typeAtEnd(editor, 'First words.')
    // The drag: the burst closes before the move's step goes on the stack.
    await moveShotTo(store, shots[0], { beforeId: shots[2], afterId: null })
    const order = () => Object.values(store.get().shots).sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((s) => s.id)
    expect(order()).toEqual([shots[1], shots[2], shots[0]])
    await store.undo()
    expect(order()).toEqual(shots)
    expect(store.get().shots[shots[0]].action).toBe('First words.')
    await store.undo()
    expect(store.get().shots[shots[0]].action ?? '').toBe('')
  })

  it('after a reload, ⌘Z still undoes the last typing', async () => {
    const persistence = memoryPersistence()
    let saved: SerializedUndo | null = null
    const { store, shots } = await project({ persistence, undo: { saved: null, save: (s) => { saved = s } } })
    const { editor, unmount } = mount(store, 'shot', shots[0])
    typeAtEnd(editor, 'Kept across a reload.')
    unmount()
    await store.close()
    const again = new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, person: MAYA, saveDebounceMs: 0 }), { debounceMs: 1, undo: { saved, save: () => {} } })
    expect(await again.load()).not.toBeNull()
    expect(again.get().shots[shots[0]].action).toBe('Kept across a reload.')
    expect(await again.undo()).toMatchObject({ done: true, label: 'typing' })
    expect(again.get().shots[shots[0]].action ?? '').toBe('')
  })

  it('typing is attributed: last_writer is the person, and one write decision when the window closes', async () => {
    const { store, shots } = await project()
    const { editor } = mount(store, 'shot', shots[0])
    for (const w of ['a', 'b', 'c']) typeAtEnd(editor, w)
    await store.checkpointText()
    expect(store.get().shots[shots[0]].last_writer).toBe(`human:${MAYA.id}`)
    expect(store.text.openWindows()).toHaveLength(1)
    await store.text.leave()
    const chain = await store.chain()
    expect(chain.filter((c) => c.action === `write shots[${shots[0]}]`)).toHaveLength(1)
    expect(chain.find((c) => c.action === `write shots[${shots[0]}]`)?.agent).toBe(`human:${MAYA.id}`)
  })
})

describe('the direction limit', () => {
  it('counts a mention as checkpoint flattens it, so labels under 4,000 can still be over', async () => {
    const { store, shots } = await project()
    const refId = id('ref')
    await store.change((d) => {
      const k = id('key')
      d.keys[k] = { id: k, v: 1, field_v: {}, key: 'maya', role: 'character' } as never
      d.assets[SHA('a')] = asset(SHA('a'))
      d.refs[refId] = { id: refId, v: 1, field_v: {}, key: 'maya', variant: 'laughing', role: 'character', asset: SHA('a') } as never
    }, { action: 'name maya_laughing' })
    await store.flush()
    const { editor } = mount(store, 'shot', shots[0])
    // 200 mentions shown with a 1-letter label flatten to '@maya_laughing' (14) each: 3,000 flat.
    const content = [{ type: 'action', content: [{ type: 'text', text: 'Walks.' }] }, {
      type: 'direction',
      content: [...Array.from({ length: 200 }, () => [{ type: 'mention', attrs: { id: refId, label: 'm' } }, { type: 'text', text: ' ' }]).flat(), { type: 'text', text: 'x'.repeat(990) }],
    }]
    editor.commands.setContent({ type: 'doc', content })
    // 3,000 + 990 = 3,990 flat: room for 10 more, not 20.
    editor.commands.focus('end')
    editor.commands.insertContent('y'.repeat(10))
    const len = () => String(store.text.prose('shot', shots[0]).content?.at(-1)?.content?.filter((n) => n.type === 'text').map((n) => n.text).join('') ?? '').length
    const was = len()
    editor.commands.insertContent('z')
    expect(len()).toBe(was) // typing stops at 4,000
    await store.checkpointText()
    expect(store.get().shots[shots[0]].text_problem ?? null).toBeNull()
    expect(String(store.get().shots[shots[0]].direction).length).toBe(4000)
  })

  it('a paste past 4,000 keeps the first 4,000 and says so', async () => {
    const { store, shots } = await project()
    const notices: string[] = []
    const { editor } = mount(store, 'shot', shots[0], { notice: (m) => notices.push(m) })
    editor.commands.setContent({ type: 'doc', content: [{ type: 'action' }, { type: 'direction' }] })
    editor.commands.focus('end')
    const slice = new Slice(editor.schema.text('p'.repeat(4200)).type.schema.nodes.doc.create(null, editor.schema.nodes.action.create(null, editor.schema.text('p'.repeat(4200)))).content, 1, 1)
    expect(pasteWithin(editor.view, slice, { kind: 'shot', refs: () => ({}), notice: (m) => notices.push(m) })).toBe(true)
    await store.checkpointText()
    expect(String(store.get().shots[shots[0]].direction).length).toBe(4000)
    expect(notices).toEqual(['Kept the first 4,000 characters'])
  })
})

describe('⌘Z inside the editor', () => {
  it('belongs to the person\'s undo (LocalUndo), not the field', () => {
    const el = document.createElement('div')
    el.setAttribute('data-script-editor', '')
    el.setAttribute('contenteditable', 'true')
    const inner = document.createElement('p')
    el.appendChild(inner)
    expect(keepsItsOwnUndo(inner)).toBe(false)
    const plainField = document.createElement('textarea')
    expect(keepsItsOwnUndo(plainField)).toBe(true)
  })
})
