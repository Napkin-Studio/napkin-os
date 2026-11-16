// The document's nodes on our own engine (features/canvas-nodes.clan), with a real
// contract-3 document: seeding, the Y round trip, moving and undoing a node, links
// made and refused by the rules, and the document's links following the elements.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { SceneStore } from '../../../../../canvas-engine/src'
import type { Link, ProductionDocument } from '../../../contracts/types'
import { modelStore, MAYA } from '../../../test/model'
import { cardOf, linkCheck, linkIdOf, linkMemory, linkNodes, reconcileLinks, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function project(): Promise<ProductionDocument> {
  const s = modelStore()
  const d = await s.create(MAYA, 'Rain')
  await s.close()
  return structuredClone(d) as ProductionDocument
}

const kinds = (a: OwnAdapter) => a.elements().map((e) => cardOf(e)?.kind ?? (linkIdOf(e) ? 'link' : e.type)).sort()

describe('canvas-nodes on the own engine', () => {
  it('seeds the Script, Storyboard and Video nodes and the document’s links once, and they survive the Y round trip', async () => {
    const doc = await project()
    const a = new OwnAdapter()
    const els = seedNodes(a, doc)
    a.transact((all) => [...all, ...els], { undoable: false })
    expect(kinds(a)).toEqual(['link', 'link', 'script', 'storyboard', 'video'])
    expect(seedNodes(a, doc)).toEqual([])
    const scene = new SceneStore((() => { const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(a.doc)); return d })())
    expect(scene.all().filter((r) => r.kind === 'node').map((r) => r.props.nodeKind).sort()).toEqual(['script', 'storyboard', 'video'])
    expect(scene.all().filter((r) => r.kind === 'link').map((r) => r.props.role).sort()).toEqual(['drives', 'renders'])
    expect(new OwnAdapter(null, { doc: a.doc }).elements()).toHaveLength(5)
  })

  it('a node is selected and moved by the select tool as one step, and undo puts it back', async () => {
    const doc = await project()
    const a = new OwnAdapter()
    a.transact((all) => [...all, ...seedNodes(a, doc)], { undoable: false })
    const script = a.elements().find((e) => cardOf(e)?.kind === 'script')!
    a.setActiveTool({ type: 'native', id: 'selection' })
    a.selector.press({ x: script.x + 20, y: script.y + 20 })
    a.selector.drag({ x: script.x + 120, y: script.y + 70 })
    expect(a.dragOffset()).toMatchObject({ dx: 100, dy: 50 })
    a.selector.release({ x: script.x + 120, y: script.y + 70 })
    expect(a.view().selectedIds).toEqual([script.id])
    const moved = a.elements().find((e) => e.id === script.id)!
    expect([moved.x, moved.y]).toEqual([script.x + 100, script.y + 50])
    a.undoScene('undo')
    const back = a.elements().find((e) => e.id === script.id)!
    expect([back.x, back.y]).toEqual([script.x, script.y])
  })

  it('links follow the rules: a storyboard already driven refuses a second script; video feeds nothing', async () => {
    const doc = await project()
    const a = new OwnAdapter()
    a.transact((all) => [...all, ...seedNodes(a, doc)], { undoable: false })
    const by = (k: string) => a.elements().find((e) => cardOf(e)?.kind === k)!
    expect(linkCheck(a.elements(), doc, by('video'), by('script'))).toMatchObject({ ok: false })
    expect(linkCheck(a.elements(), doc, by('script'), by('storyboard'))).toMatchObject({ ok: false })
    // Without the document's drives link, script to storyboard is allowed, as drives.
    const loose = { ...doc, links: {} } as ProductionDocument
    expect(linkCheck(a.elements(), loose, by('script'), by('storyboard'))).toEqual({ ok: true, role: 'drives', docRole: 'drives' })
  })

  it('linkNodes writes the link element as one step and the document entry, and reconcile follows a delete and its undo', async () => {
    const doc = { ...(await project()), links: {} } as ProductionDocument
    const a = new OwnAdapter()
    a.transact((all) => [...all, ...seedNodes(a, doc)], { undoable: false })
    const by = (k: string) => a.elements().find((e) => cardOf(e)?.kind === k)!
    const written: Link[] = []
    const r = await linkNodes(a, doc, by('script'), by('video'), async (l) => { written.push(l) })
    expect(r.ok).toBe(true)
    expect(written[0]).toMatchObject({ from: { kind: 'script' }, to: { kind: 'video' }, role: 'drives' })
    const withLink = { ...doc, links: { [written[0].id]: written[0] } } as ProductionDocument
    const seen = linkMemory()
    expect(reconcileLinks(a.elements(), withLink, seen)).toEqual({ unlink: [], relink: [], draw: [], erase: [], regroup: [] })
    // The person deletes the link element: its document entry goes.
    const linkEl = a.elements().find((e) => linkIdOf(e) === written[0].id)!
    a.selector.set([linkEl.id])
    a.selector.deleteSelected()
    expect(reconcileLinks(a.elements(), withLink, seen).unlink).toEqual([written[0].id])
    // Undo brings the element back, and the entry is put back.
    a.undoScene('undo')
    const back = reconcileLinks(a.elements(), doc, seen)
    expect(back.relink.map((l) => [l.id, l.role])).toEqual([[written[0].id, 'drives']])
  })

  it('a chip’s × erases the arrow, and the document’s undo of it draws a new one, never unlinking it again', async () => {
    const doc = { ...(await project()), links: {} } as ProductionDocument
    const a = new OwnAdapter()
    a.transact((all) => [...all, ...seedNodes(a, doc)], { undoable: false })
    const by = (k: string) => a.elements().find((e) => cardOf(e)?.kind === k)!
    const written: Link[] = []
    await linkNodes(a, doc, by('script'), by('video'), async (l) => { written.push(l) })
    const id = written[0].id
    const withLink = { ...doc, links: { [id]: written[0] } } as ProductionDocument
    const seen = linkMemory()
    reconcileLinks(a.elements(), withLink, seen)
    // The × takes the entry out of the document: the arrow goes (a system write).
    const gone = reconcileLinks(a.elements(), doc, seen)
    expect(gone.erase).toHaveLength(1)
    a.transact((els) => els.map((e) => (gone.erase.includes(e.id) ? a.patch(e, { isDeleted: true }) : e)), { undoable: false })
    expect(reconcileLinks(a.elements(), doc, seen)).toMatchObject({ unlink: [], erase: [] })
    // Undo puts the entry back: a new arrow is drawn, and nothing unlinks it.
    const back = reconcileLinks(a.elements(), withLink, seen)
    expect(back.unlink).toEqual([])
    expect(back.draw.map((x) => x.link.id)).toEqual([id])
  })
})
