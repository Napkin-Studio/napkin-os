// contract-v3 script-layout spike (features/contract-v3.clan, test_plan 1).
//
// Question: can both script views (screenplay and Video · Audio) run over
// per-entity fragments (shots/<id>, scenes/<id>, beats/<id>) with rank as the
// only order, and can planning move text from a scene into shots and beats as
// one undo step? Run: npx vitest run --root spike
//
// It measures what an agent can measure headless: the layout, the plan move,
// undo grouping, re-plan keeping a person's text, convergence of two docs,
// write and checkpoint cost over 30 shots, and gzipped bundle sizes. Keyboard
// flows and iPad Pencil need a person on the devices.
import { buildSync } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { textSchema } from '../src/text/extensions'

type PM = { type: string; content?: PM[]; text?: string; attrs?: Record<string, unknown> }
const para = (type: string, text: string): PM => ({ type, content: text ? [{ type: 'text', text }] : [] })
const docOf = (...blocks: PM[]): PM => ({ type: 'doc', content: blocks })

function fill(frag: Y.XmlFragment, json: PM) {
  prosemirrorJSONToYXmlFragment(textSchema(), json, frag)
}

/** A Fountain-ish paste: scene headings start a scene, CAPS lines are characters. */
function parsePaste(text: string): { heading: string; blocks: PM[] }[] {
  const scenes: { heading: string; blocks: PM[] }[] = []
  let speaking = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) { speaking = false; continue }
    if (/^(INT|EXT)\./.test(line)) { scenes.push({ heading: line, blocks: [] }); speaking = false; continue }
    const cur = scenes.at(-1) ?? (scenes.push({ heading: '', blocks: [] }), scenes.at(-1)!)
    if (/^[A-Z][A-Z ]+$/.test(line)) { cur.blocks.push(para('character', line)); speaking = true; continue }
    if (speaking && /^\(.*\)$/.test(line)) { cur.blocks.push(para('parenthetical', line.slice(1, -1))); continue }
    cur.blocks.push(para(speaking ? 'dialogue' : 'action', line))
  }
  return scenes
}

const PASTE = Array.from({ length: 6 }, (_, s) => [
  `EXT. BEACH ${s} - DAWN`,
  ...Array.from({ length: 5 }, (_, i) => [
    `@maya walks the waterline, shot ${s * 5 + i + 1}. The light is low and gold.`,
    '',
    'MAYA',
    '(quietly)',
    "It's perfect.",
    '',
  ]).flat(),
]).flat().join('\n')

describe('script layout over per-entity fragments', () => {
  it('pastes, plans as one undo step, re-plans keeping a person\'s text, and converges', () => {
    const doc = new Y.Doc()
    const scenes = parsePaste(PASTE)
    expect(scenes).toHaveLength(6)

    // Paste: one fragment per scene, holding text no shot owns yet.
    const sceneIds = scenes.map((_, i) => `scene_${i}`)
    doc.transact(() => scenes.forEach((s, i) => fill(doc.getXmlFragment(`scenes/${sceneIds[i]}`), docOf(...s.blocks))), 'human:p_paste')

    // Plan: Dex moves each action+line group out of its scene into a shot and
    // its beats, in ONE transaction, which the undo manager records as one step.
    const tracked = new Set<Y.AbstractType<unknown>>()
    const undo = new Y.UndoManager([], { doc, trackedOrigins: new Set(['dex']), captureTimeout: 0 })
    const shots: string[] = []
    const t0 = performance.now()
    doc.transact(() => {
      scenes.forEach((s, si) => {
        const frag = doc.getXmlFragment(`scenes/${sceneIds[si]}`)
        for (let i = 0; i < 5; i++) {
          const id = `shot_${si * 5 + i + 1}`
          shots.push(id)
          const blocks = s.blocks.slice(i * 4, i * 4 + 4)
          const shotFrag = doc.getXmlFragment(`shots/${id}`)
          const beatFrag = doc.getXmlFragment(`beats/beat_${id}_line`)
          for (const f of [shotFrag, beatFrag]) if (!tracked.has(f)) { undo.addToScope(f); tracked.add(f) }
          fill(shotFrag, docOf(blocks[0], para('direction', 'Low sun behind her; hold on the face.')))
          fill(beatFrag, docOf(blocks[3]))
        }
        if (!tracked.has(frag)) { undo.addToScope(frag); tracked.add(frag) }
        frag.delete(0, frag.length) // the moved span leaves the scene in the same transaction
      })
    }, 'dex')
    const planMs = performance.now() - t0
    expect(shots).toHaveLength(30)
    expect(doc.getXmlFragment(`scenes/${sceneIds[0]}`).length).toBe(0)
    expect(undo.undoStack).toHaveLength(1)

    // Undo restores the scenes and empties the shots: one step.
    undo.undo()
    expect(doc.getXmlFragment(`scenes/${sceneIds[0]}`).length).toBe(20)
    expect(doc.getXmlFragment('shots/shot_1').length).toBe(0)
    undo.redo()
    expect(doc.getXmlFragment('shots/shot_1').length).toBe(2)

    // A person edits shot 3; re-plan replaces only shots whose last writer is crew.
    const lastWriter = new Map<string, string>()
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      for (const type of tr.changedParentTypes.keys()) {
        let t: Y.AbstractType<unknown> | null = type
        while (t && !(t instanceof Y.XmlFragment)) t = t.parent as Y.AbstractType<unknown> | null
        const name = t ? [...doc.share.entries()].find(([, v]) => v === t)?.[0] : undefined
        if (name) lastWriter.set(name, String(tr.origin))
      }
    })
    doc.transact(() => {
      const f = doc.getXmlFragment('shots/shot_3')
      const first = f.get(0) as Y.XmlElement
      ;(first.get(0) as Y.XmlText).insert(0, 'Sai: ')
    }, 'human:p_sai')
    expect(lastWriter.get('shots/shot_3')).toBe('human:p_sai')
    doc.transact(() => {
      for (const id of shots) {
        if (lastWriter.get(`shots/${id}`)?.startsWith('human:')) continue
        const f = doc.getXmlFragment(`shots/${id}`)
        f.delete(0, f.length)
        fill(f, docOf(para('action', `replanned ${id}`)))
      }
    }, 'dex')
    const json3 = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('shots/shot_3')) as PM
    expect(json3.content![0].content![0].text).toMatch(/^Sai: @maya/)

    // Two docs converge with concurrent typing in one shot's action.
    const a = new Y.Doc(), b = new Y.Doc()
    Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
    const typeInto = (d: Y.Doc, s: string) => d.transact(() => ((d.getXmlFragment('shots/shot_7').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, s))
    typeInto(a, 'A ')
    typeInto(b, 'B ')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(JSON.stringify(yXmlFragmentToProsemirrorJSON(a.getXmlFragment('shots/shot_7')))).toBe(JSON.stringify(yXmlFragmentToProsemirrorJSON(b.getXmlFragment('shots/shot_7'))))

    // Typing cost: 2,000 one-character transactions into one shot, and a
    // checkpoint (fragment → prose JSON) of all 30 shots.
    const xt = (doc.getXmlFragment('shots/shot_9').get(0) as Y.XmlElement).get(0) as Y.XmlText
    const t1 = performance.now()
    for (let i = 0; i < 2000; i++) doc.transact(() => xt.insert(xt.length, 'x'), 'human:p_sai')
    const perKeyMs = (performance.now() - t1) / 2000
    const t2 = performance.now()
    const prose = shots.map((id) => yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(`shots/${id}`)))
    const checkpointMs = performance.now() - t2
    const updateBytes = Y.encodeStateAsUpdate(doc).byteLength
    console.log(JSON.stringify({ planMs: +planMs.toFixed(1), perKeyMs: +perKeyMs.toFixed(3), checkpoint30ShotsMs: +checkpointMs.toFixed(1), proseBytes: JSON.stringify(prose).length, ydocUpdateBytes: updateBytes }))
    expect(perKeyMs).toBeLessThan(5)
  })

  it('measures gzipped bundle sizes', () => {
    const size = (contents: string) => {
      const out = buildSync({ stdin: { contents, resolveDir: process.cwd(), loader: 'js' }, bundle: true, minify: true, format: 'esm', write: false, platform: 'browser', logLevel: 'silent' })
      const bytes = out.outputFiles[0].contents
      return { min: bytes.byteLength, gz: gzipSync(bytes).byteLength }
    }
    const sizes = {
      yjs: size("export * from 'yjs'"),
      'tiptap-pm (model,state,view,transform)': size("export * from '@tiptap/pm/model'; export * from '@tiptap/pm/state'; export * from '@tiptap/pm/view'; export * from '@tiptap/pm/transform'"),
      'checkpoint path (yjs + y-tiptap + core schema)': size("export * as Y from 'yjs'; export * from '@tiptap/y-tiptap'; export { getSchema, Node } from '@tiptap/core'"),
    }
    console.log(JSON.stringify(sizes))
    expect(sizes.yjs.gz).toBeGreaterThan(0)
  })
})
