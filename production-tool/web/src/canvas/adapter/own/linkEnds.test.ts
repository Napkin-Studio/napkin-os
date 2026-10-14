// Links from pictures and into sketch areas, and links written elsewhere (ui-behaviour 3.4, 3.16;
// features/canvas-nodes.clan), on our own engine with the CLAN store: a named picture feeds a script,
// a storyboard, a video or a sketch area in its own role, and the store takes the link; an unnamed
// picture says to name it first; nothing links into a picture. A link written by something else (an
// ask, another person) gets its arrow; one removed elsewhere (an inputs chip's ×) loses it; the
// canvas's own delete and undo still move the document.

import { describe, expect, it } from 'vitest'
import type { Link, ProductionDocument } from '../../../contracts/types'
import { updateDoc } from '../../../doc/store'
import { newId } from '../../../lib/ulid'
import { mainScript, mainStoryboard } from '../../../model/selectors'
import { addKey, addRef } from '../../../test/jobFixtures'
import { modelStore, MAYA, SHA } from '../../../test/model'
import { cardOf, endOf, linkCheck, linkIdOf, linkMemory, linkNodes, reconcileLinks, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function setup() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  const maya = a.imageNode({ x: 900, y: 0, width: 300, height: 400, assetSha: SHA('a'), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA('a') } })
  const plain = a.imageNode({ x: 1300, y: 0, width: 300, height: 400, assetSha: SHA('b'), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA('b') } })
  const sketchId = newId('sketch')
  const sketch = a.sketchArea({ x: 900, y: 600, w: 320, h: 180, sketchId })
  a.transact((els) => [...els, maya, plain, sketch], { undoable: false })
  await updateDoc(s, (d) => {
    addKey(d, 'maya', 'character')
    const r = addRef(d, 'maya', 'front', SHA('a'), 'character')
    r.node = (maya.customData as { id: string }).id
    d.sketches[sketchId] = { id: sketchId, v: 1, field_v: {}, aspect: { w: 16, h: 9 }, ratio: '16:9', drawn_by: `human:${MAYA.id}` }
  }, 'name maya_front')
  const doc = () => s.get() as unknown as ProductionDocument
  const node = (k: string) => a.elements().find((e) => cardOf(e)?.kind === k)!
  const write = (l: Link) => updateDoc(s, (d) => { d.links[l.id] = l }, `link ${l.from.kind} to ${l.to.kind}`).then(() => {})
  return { s, a, doc, node, maya, plain, sketch, write }
}

describe('links from pictures and into sketch areas', () => {
  it('a named picture feeds a script, a storyboard, a video and a sketch area in its own role; the store takes the link', async () => {
    const { s, a, doc, node, maya, sketch, write } = await setup()
    expect(endOf(maya, doc())).toMatchObject({ doc: { kind: 'ref' }, core: { kind: 'picture', role: 'character' } })
    for (const k of ['script', 'storyboard', 'video']) expect(linkCheck(a.elements(), doc(), maya, node(k))).toMatchObject({ ok: true, role: 'reference', docRole: 'character' })
    expect(linkCheck(a.elements(), doc(), maya, sketch)).toMatchObject({ ok: true, docRole: 'character' })
    const r = await linkNodes(a, doc(), maya, node('script'), write)
    expect(r.ok).toBe(true)
    const link = Object.values(doc().links).find((l) => l.from.kind === 'ref')!
    expect(link).toMatchObject({ from: { kind: 'ref' }, to: { kind: 'script', id: mainScript(doc())!.id }, role: 'character' })
    expect(a.elements().some((e) => linkIdOf(e) === link.id)).toBe(true)
    // Into the sketch area too.
    expect((await linkNodes(a, doc(), maya, sketch, write)).ok).toBe(true)
    expect(Object.values(doc().links).some((l) => l.to.kind === 'sketch')).toBe(true)
    await s.close()
  })

  it('an unnamed picture says to name it first; nothing links into a picture', async () => {
    const { s, a, doc, node, maya, plain } = await setup()
    expect(linkCheck(a.elements(), doc(), plain, node('script'))).toMatchObject({ ok: false, reason: expect.stringMatching(/Name this picture first/) })
    expect(linkCheck(a.elements(), doc(), node('script'), maya)).toMatchObject({ ok: false })
    await s.close()
  })
})

describe('the arrows follow the document\'s links, whoever wrote them', () => {
  it('draws a link written elsewhere, erases one removed elsewhere, and keeps the canvas\'s own delete and undo', async () => {
    const { s, a, doc, maya, node } = await setup()
    const mem = linkMemory()
    const apply = () => {
      const r = reconcileLinks(a.elements(), doc(), mem)
      a.transact((els) => {
        let all = els.map((e) => (r.erase.includes(e.id) ? a.patch(e, { isDeleted: true }) : e))
        for (const d of r.draw) {
          const el = a.link({ fromElId: d.from.id, toElId: d.to.id, role: d.link.role, linkId: d.link.id })
          all = a.bindArrow([...all, el])
        }
        return all
      }, { undoable: false })
      return r
    }
    apply()
    // An ask links the picture to the storyboard (a document write, not the canvas's).
    const id = newId('link')
    await updateDoc(s, (d) => { d.links[id] = { id, v: 1, field_v: {}, from: { kind: 'ref', id: Object.keys(d.refs)[0] }, to: { kind: 'storyboard', id: mainStoryboard(d)!.id }, role: 'character' } }, 'link ref to storyboard')
    expect(apply().draw.map((d) => d.link.id)).toEqual([id])
    const arrow = a.elements().find((e) => linkIdOf(e) === id)!
    expect((arrow as unknown as { startBinding: { elementId: string } }).startBinding.elementId).toBe(maya.id)
    expect((arrow as unknown as { endBinding: { elementId: string } }).endBinding.elementId).toBe(node('storyboard').id)
    // An inputs chip's × removes it from the document: the arrow goes.
    await updateDoc(s, (d) => { delete d.links[id] }, 'unlink ref from storyboard')
    expect(apply().erase).toEqual([arrow.id])
    expect(a.elements().some((e) => linkIdOf(e) === id)).toBe(false)
    // The canvas's own delete unlinks; its undo links again (not an erase).
    const drives = a.elements().find((e) => linkIdOf(e) && doc().links[linkIdOf(e)!]?.role === 'drives')!
    a.selector.set([drives.id])
    a.selector.deleteSelected()
    const r1 = apply()
    expect(r1.unlink).toEqual([linkIdOf(drives)])
    await updateDoc(s, (d) => { delete d.links[r1.unlink[0]] }, 'unlink on the canvas')
    a.undoScene('undo')
    const r2 = apply()
    expect(r2.erase).toEqual([])
    expect(r2.relink.map((l) => l.id)).toEqual([linkIdOf(drives)])
    await s.close()
  })
})
