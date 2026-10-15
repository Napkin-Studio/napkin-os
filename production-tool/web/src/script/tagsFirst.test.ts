// @vitest-environment happy-dom
// Tags first, character later, and only a link makes it count (owner, Shrey 2026-10-15;
// features/canvas-nodes.clan): a script that says @samurai before any picture exists keeps it
// underlined; naming three pictures samurai_front/side/back forms the group but links nothing and
// leaves the mentions underlined; linking the group into the Script once resolves every @samurai,
// shows "@samurai · 3 views" in its inputs and sends the views; unlinking underlines them again.

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { mainScript } from '../model/selectors'
import { inputChips, scopeOf } from '../model/scope'
import { addShots, asset, id, MAYA, modelStore, SHA } from '../test/model'
import { keyLinkMerges } from '../canvas/nodes/mergeLinks'
import { editorExtensions } from './extensions'
import { scriptMentionHooks } from './mentionHooks'
import { redrawMentions, typedSpans } from './mentions'
import { unknownInShot } from './nameAsks'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy()
  document.body.innerHTML = ''
})

describe('tags first, the character later, and only a link makes it count', () => {
  it('@samurai stays underlined after the pictures are named, resolves once the group is linked, and again underlined once unlinked', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Tags first')
    await store.change((d) => { addShots(d, 1, { status: 'planned' }) }, { action: 'plan' })
    await store.flush()
    const shot = Object.keys(store.get().shots)[0]
    const scriptId = mainScript(store.get())!.id
    const script = { kind: 'script' as const, id: scriptId }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const hooks = scriptMentionHooks(store, scriptId, () => {})
    const editor = new Editor({ element, extensions: editorExtensions({ kind: 'shot', fragment: store.text.fragment('shot', shot), mentions: () => hooks }) })
    editors.push(editor)
    // 1. The script names @samurai before any picture exists.
    editor.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: '@samurai waits at the gate. @samurai bows.' }] }] })
    redrawMentions(editor)
    const underlined = () => [...editor.view.dom.querySelectorAll('.mention-typed.unknown')].map((e) => e.textContent)
    expect(underlined()).toEqual(['@samurai', '@samurai'])
    // Skye may ask who they are: the name is unknown to the document.
    expect(unknownInShot(store.get(), { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: '@samurai waits.' }] }] } as never).map((u) => u.name)).toEqual(['samurai'])
    // 2. Three pictures named samurai_front/side/back: the group forms, nothing links, the mentions stay underlined.
    const keyId = id('key')
    const views = ['front', 'side', 'back'].map(() => id('ref'))
    await store.change((d) => {
      d.assets[SHA('a')] = asset(SHA('a'))
      d.keys[keyId] = { id: keyId, v: 1, field_v: {}, key: 'samurai', role: 'character' }
      ;['front', 'side', 'back'].forEach((v, i) => {
        d.refs[views[i]] = { id: views[i], v: 1, field_v: {}, key: 'samurai', variant: v, role: 'character', asset: SHA('a'), named_at: new Date().toISOString() }
      })
    }, { action: 'name samurai' })
    await store.flush()
    redrawMentions(editor)
    expect(Object.values(store.get().links).filter((l) => l.to.id === scriptId && (l.from.kind === 'key' || l.from.kind === 'ref'))).toHaveLength(0)
    expect(keyLinkMerges(store.get())).toHaveLength(0)
    expect(underlined()).toEqual(['@samurai', '@samurai'])
    expect(typedSpans('@samurai waits.', hooks.names())[0]).toEqual({ text: '@samurai', name: 'samurai', known: false })
    expect(inputChips(scopeOf(store.get(), scriptId)).map((c) => c.label)).not.toContain('@samurai · 3 views')
    // 3. The person links the group into the Script, once: every @samurai resolves.
    const link = id('link')
    await store.change((d) => {
      d.links[link] = { id: link, v: 1, field_v: {}, from: { kind: 'key', id: keyId }, to: script, role: 'character' }
    }, { action: 'link the samurai' })
    await store.flush()
    redrawMentions(editor)
    expect(underlined()).toEqual([])
    // Each reads as a mention now, in the editor and in the page's static text.
    expect([...editor.view.dom.querySelectorAll('.mention-typed:not(.unknown)')].map((e) => e.textContent)).toEqual(['@samurai', '@samurai'])
    expect(typedSpans('@samurai bows to @ronin.', hooks.names()).filter((p) => p.name).map((p) => [p.name, p.known])).toEqual([['samurai', true], ['ronin', false]])
    expect(hooks.names()).toContain('samurai')
    expect(inputChips(scopeOf(store.get(), scriptId)).map((c) => c.label)).toEqual(['@samurai · 3 views'])
    const sent = JSON.stringify(scopeOf(store.get(), scriptId))
    for (const v of views) expect(sent).toContain(v)
    // 4. Unlinking underlines them again.
    await store.change((d) => { delete d.links[link] }, { action: 'unlink the samurai' })
    await store.flush()
    redrawMentions(editor)
    expect(underlined()).toEqual(['@samurai', '@samurai'])
    await store.close()
  })
})
