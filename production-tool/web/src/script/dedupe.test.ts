// One copy of the live-text stack (features/script-editor.clan, rework risk 3): clan-store's
// source and the editors share yjs, ProseMirror and y-tiptap, and the editors mount exactly
// clan-store's node set, so a fragment typed here round-trips through checkpoint and hydrate.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import { Node as PMNode, Schema } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { checkpoint, hydrate, proseOf, textSchema, type FragmentKind, type Prose } from '../../../clan-store/src'
import { editorExtensions } from './extensions'

const here = dirname(fileURLToPath(import.meta.url))
const lock = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8')) as { packages: Record<string, { version?: string }> }
const t = (text: string) => ({ type: 'text', text })

describe('one copy of the live-text stack', () => {
  it('clan-store builds Y content and ProseMirror nodes from the same classes as the web', () => {
    const doc = new Y.Doc()
    const f = doc.getXmlFragment('shots/x')
    doc.transact(() => hydrate(f, { type: 'doc', content: [{ type: 'action', content: [t('One copy.')] }] }))
    // hydrate() runs clan-store's y-tiptap and yjs: what it made must be the web's Y.XmlElement.
    expect(f.get(0)).toBeInstanceOf(Y.XmlElement)
    expect(textSchema()).toBeInstanceOf(Schema)
    expect(textSchema().node('doc', null, [textSchema().node('action')])).toBeInstanceOf(PMNode)
  })

  it('the two lockfiles resolve the same versions of the shared packages', () => {
    const web = lock('../../package-lock.json').packages
    const store = lock('../../../clan-store/package-lock.json').packages
    for (const p of ['yjs', 'lib0', 'y-protocols', '@tiptap/core', '@tiptap/pm', '@tiptap/y-tiptap', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-transform']) {
      expect(`${p}@${web[`node_modules/${p}`]?.version}`).toBe(`${p}@${store[`node_modules/${p}`]?.version}`)
    }
  })
})

describe('the editors mount clan-store\'s node set', () => {
  it('the editor schema equals textSchema()', () => {
    const editor = getSchema(editorExtensions({ kind: 'shot' }))
    const store = textSchema()
    expect(Object.keys(editor.nodes).sort()).toEqual(Object.keys(store.nodes).sort())
    expect(Object.keys(editor.marks)).toEqual(Object.keys(store.marks))
    for (const name of Object.keys(store.nodes)) {
      expect(editor.nodes[name].spec.content ?? '', name).toBe(store.nodes[name].spec.content ?? '')
      expect(editor.nodes[name].spec.group ?? '', name).toBe(store.nodes[name].spec.group ?? '')
      expect(editor.nodes[name].spec.marks, name).toBe(store.nodes[name].spec.marks)
    }
  })

  const SAMPLES: Record<FragmentKind, Prose> = {
    shot: { type: 'doc', content: [{ type: 'action', content: [t('She runs '), { type: 'mention', attrs: { id: 'ref_x', label: 'maya_front' } }, t('.')] }, { type: 'direction', content: [t('Unhurried.')] }] },
    scene: { type: 'doc', content: [{ type: 'action', content: [t('Rain.')] }, { type: 'character', content: [t('MAYA')] }, { type: 'parenthetical', content: [t('quietly')] }, { type: 'dialogue', content: [t('Hi.')] }] },
    beat: { type: 'doc', content: [{ type: 'dialogue', content: [t("It's perfect.")] }] },
    review: { type: 'doc', content: [{ type: 'action', content: [t('Blur.')] }] },
  }
  for (const [kind, prose] of Object.entries(SAMPLES) as [FragmentKind, Prose][]) {
    it(`a ${kind} fragment round-trips: checkpoint(hydrate(x)) is x, and the editor reads it as is`, () => {
      const doc = new Y.Doc()
      const f = doc.getXmlFragment(`x/${kind}`)
      doc.transact(() => hydrate(f, prose))
      expect(proseOf(f)).toEqual(prose)
      expect(checkpoint(kind, proseOf(f), { refs: {} }).fields.prose).toEqual(prose)
      expect(getSchema(editorExtensions({ kind })).nodeFromJSON(prose).toJSON()).toEqual(prose)
    })
  }
})
