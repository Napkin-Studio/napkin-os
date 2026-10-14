// @vitest-environment happy-dom
// Two clients, two Y.Docs, two headless editors typing into one shot (features/script-editor.clan):
// they converge, and a draft written against one side's words is stale once the other side types.
// The harness is live-sync's to grow: it only has to swap the in-memory exchange for its provider.

import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { hydrate, proseFromLines, proseHash, proseOf } from '../../../clan-store/src'
import { editorExtensions } from './extensions'

/** Two docs that pass every update to each other (an in-memory provider). */
export function pair() {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(b, u, 'remote') })
  b.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(a, u, 'remote') })
  return { a, b }
}

function editorOn(doc: Y.Doc, name: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({ element, extensions: editorExtensions({ kind: 'shot', fragment: doc.getXmlFragment(name) }) })
}

describe('two clients in one shot', () => {
  it('converge, and the other side\'s draft goes stale', async () => {
    const { a, b } = pair()
    a.transact(() => hydrate(a.getXmlFragment('shots/x'), proseFromLines('action', ['She walks.'])))
    const ea = editorOn(a, 'shots/x')
    const eb = editorOn(b, 'shots/x')
    expect(eb.getText()).toBe('She walks.')
    const draftedAgainst = await proseHash(proseOf(b.getXmlFragment('shots/x')))
    ea.commands.focus('end')
    ea.commands.insertContent(' Slowly.')
    eb.commands.focus('start')
    eb.commands.insertContent('Then ')
    expect(proseOf(a.getXmlFragment('shots/x'))).toEqual(proseOf(b.getXmlFragment('shots/x')))
    expect(ea.getText()).toBe(eb.getText())
    expect(ea.getText()).toContain('Slowly.')
    expect(ea.getText()).toContain('Then ')
    expect(await proseHash(proseOf(b.getXmlFragment('shots/x')))).not.toBe(draftedAgainst)
    ea.destroy()
    eb.destroy()
  })
})
