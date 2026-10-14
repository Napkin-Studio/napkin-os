// @vitest-environment happy-dom
// Delete on the own engine through the canvas's one delete path
// (features/canvas-edit-tools.clan): the controller takes a node's links with it,
// as one step of the person's scene undo, and the document follows (CanvasDocSync).

import { describe, expect, it, vi } from 'vitest'
import type { Services } from '../../../app/context'
import { CanvasController } from '../../controller'
import { mainScript, mainStoryboard } from '../../../model/selectors'
import { reconcileLinks } from '../../nodes/nodes'
import { snapshotDoc } from '../../../test/jobFixtures'
import { OwnAdapter } from './adapter'

vi.mock('../../../lib/idb', () => ({ idbPut: async () => {}, idbGet: async () => undefined }))

function setup() {
  const a = new OwnAdapter()
  const doc = snapshotDoc()
  const cancel = vi.fn()
  const services = { doc, runner: { cancel }, relay: {}, project: { canvasKey: 'k' }, ui: { get: () => ({ me: { participantId: 'p_1' } }) } } as unknown as Services
  const d = doc.get()
  const sc = a.node({ x: 0, y: 0, width: 200, height: 100, customData: { kind: 'script', id: mainScript(d)!.id } })
  const sb = a.node({ x: 0, y: 300, width: 300, height: 100, customData: { kind: 'storyboard', id: mainStoryboard(d)!.id } })
  const link = a.link({ fromElId: sc.id, toElId: sb.id, role: 'drives', linkId: 'link_x' })
  a.transact(() => [sc, sb, link], { undoable: false })
  const ctrl = new CanvasController(a, services)
  return { a, doc, ctrl, sc, sb, link }
}

describe('delete on the own engine', () => {
  it('a node takes the links bound to it, as one step that Ctrl+Z undoes', () => {
    const { a, ctrl, sc, sb, link } = setup()
    const r = ctrl.deleteElements([sb.id])!
    expect(r.ids.sort()).toEqual([sb.id, link.id].sort())
    expect(r.label).toBe('Storyboard deleted')
    expect(a.elements().map((e) => e.id)).toEqual([sc.id])
    expect(a.undo.depth().undo).toBe(1)
    a.undoScene('undo')
    expect(a.elements().map((e) => e.id).sort()).toEqual([sc.id, sb.id, link.id].sort())
  })

  it('a link alone says so, and its Undo chip sits between its ends', () => {
    const { ctrl, link } = setup()
    const r = ctrl.deleteElements([link.id])!
    expect(r.label).toBe('Link deleted')
    expect(r.at).toEqual({ x: 150, y: 200 })
  })

  it('the document follows: the storyboard leaves it, and comes back with the node', async () => {
    const { a, doc, ctrl, sb } = setup()
    const id = mainStoryboard(doc.get())!.id
    ctrl.deleteElements([sb.id])
    await ctrl.sync.nodes(a.elements({ includeDeleted: true }))
    expect(doc.get().storyboards[id]).toBeUndefined()
    a.undoScene('undo')
    await ctrl.sync.nodes(a.elements({ includeDeleted: true }))
    expect(doc.get().storyboards[id]).toBeDefined()
  })

  it('a link coming back with its node waits until the node is back in the document', async () => {
    const { a, doc, ctrl, sb, link } = setup()
    const id = mainStoryboard(doc.get())!.id
    const seen = new Set(['link_x'])
    ctrl.deleteElements([sb.id])
    await ctrl.sync.nodes(a.elements({ includeDeleted: true }))
    a.undoScene('undo')
    // The canvas has the link again, the document not yet the storyboard: no relink (the .clan would refuse it).
    expect(a.elements().some((e) => e.id === link.id)).toBe(true)
    expect(doc.get().storyboards[id]).toBeUndefined()
    expect(reconcileLinks(a.elements(), doc.get(), seen).relink).toEqual([])
    await ctrl.sync.nodes(a.elements({ includeDeleted: true }))
    expect(doc.get().storyboards[id]).toBeDefined()
  })
})
