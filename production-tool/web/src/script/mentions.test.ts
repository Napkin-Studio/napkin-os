// @vitest-environment happy-dom
// @ mentions inside the script editors (item 9): the popover keeps the caret in the editor,
// Enter inserts a mention, picking an unlinked ref links it (Undo leaves an unknown name),
// and names that match nothing are underlined with 'Did you mean'.

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { mainScript } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { addShots, asset, id, MAYA, modelStore, SHA } from '../test/model'
import { editorExtensions } from './extensions'
import { scriptMentionHooks } from './mentionHooks'
import { redrawMentions } from './mentions'
import { trackTyping } from './typing'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy()
  document.body.innerHTML = ''
})

async function project() {
  const store = modelStore()
  await store.create(MAYA, 'Mentions')
  const key = id('key')
  const front = id('ref')
  const laughing = id('ref')
  await store.change((d) => {
    d.assets[SHA('a')] = asset(SHA('a'))
    d.keys[key] = { id: key, v: 1, field_v: {}, key: 'maya', role: 'character' }
    d.refs[front] = { id: front, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('a') }
    d.refs[laughing] = { id: laughing, v: 1, field_v: {}, key: 'maya', variant: 'laughing', role: 'character', asset: SHA('a'), label: 'Maya in stitches' }
    addShots(d, 1, { status: 'planned' })
  }, { action: 'name maya' })
  await store.flush()
  const shot = Object.keys(store.get().shots)[0]
  return { store, shot, front, laughing, scriptId: mainScript(store.get())!.id }
}

function mount(store: ModelStore, shot: string, scriptId: string, linked: string[]) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const hooks = scriptMentionHooks(store, scriptId, (i) => linked.push(i.name))
  const editor = new Editor({ element, extensions: editorExtensions({ kind: 'shot', fragment: store.text.fragment('shot', shot), mentions: () => hooks }) })
  trackTyping(editor, store.typing, 'shot', shot)
  editors.push(editor)
  redrawMentions(editor)
  return editor
}

const key = (editor: Editor, k: string) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const settle = () => new Promise((r) => setTimeout(r, 30))

describe('@ in a shot', () => {
  it('opens the popover by label too, keeps the focus, and Enter inserts the mention and links the ref; Undo leaves it unknown', async () => {
    const { store, shot, laughing, scriptId } = await project()
    const linked: string[] = []
    const editor = mount(store, shot, scriptId, linked)
    editor.commands.focus('end')
    editor.commands.insertContent('She laughs @stitch')
    await settle()
    const float = document.querySelector('.caretfloat')
    expect(float).not.toBeNull()
    expect(float!.textContent).toContain('@maya_laughing')
    expect(float!.textContent).toContain('Maya in stitches')
    expect(float!.textContent).toContain('not in this script yet')
    expect(document.activeElement === float).toBe(false)
    key(editor, 'Enter')
    await settle()
    await store.flush()
    const json = editor.getJSON()
    expect(JSON.stringify(json)).toContain(`"id":"${laughing}"`)
    expect(document.querySelector('.caretfloat')).toBeNull()
    expect(linked).toEqual(['maya_laughing'])
    expect(Object.values(store.get().links).some((l) => l.from.id === laughing && l.to.kind === 'script' && l.to.id === scriptId && l.role === 'character')).toBe(true)
    redrawMentions(editor)
    expect(editor.view.dom.querySelector('[data-type="mention"]')?.className).not.toContain('unknown')
    // Undo takes the link back; the mention stays, as a name not in this script.
    await store.undo()
    redrawMentions(editor)
    expect(Object.values(store.get().links).some((l) => l.from.id === laughing && l.to.kind === 'script')).toBe(false)
    expect(editor.view.dom.querySelector('[data-type="mention"]')?.className).toContain('unknown')
    expect(editor.view.dom.querySelector('[data-type="mention"]')?.textContent).toBe('@maya_laughing')
  })

  it('a typed name that matches nothing gets the underline and Did you mean', async () => {
    const { store, shot, front, scriptId } = await project()
    await store.change((d) => {
      const l = id('link')
      d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'ref', id: front }, to: { kind: 'script', id: scriptId }, role: 'character' }
    }, { action: 'link maya_front' })
    await store.flush()
    const editor = mount(store, shot, scriptId, [])
    editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Then @maya_frnot waves.' }] }] })
    redrawMentions(editor)
    const typed = editor.view.dom.querySelector('.mention-typed.unknown') as HTMLElement | null
    expect(typed?.textContent).toBe('@maya_frnot')
    expect(typed?.title).toBe('No reference is called @maya_frnot. Did you mean @maya_front?')
  })

  it('Escape closes the popover and nothing else', async () => {
    const { store, shot, scriptId } = await project()
    const editor = mount(store, shot, scriptId, [])
    editor.commands.focus('end')
    editor.commands.insertContent('@ma')
    await settle()
    expect(document.querySelector('.caretfloat')).not.toBeNull()
    key(editor, 'Escape')
    await settle()
    expect(document.querySelector('.caretfloat')).toBeNull()
    expect(editor.getText()).toBe('@ma')
  })
})
