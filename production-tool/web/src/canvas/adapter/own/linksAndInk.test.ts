// The owner's links and ink (Shrey, 2026-10-15; features/canvas-nodes.clan): views linked singly to a
// Script before they were one key group merge into the key link (one undo step, "Linked as @samurai ·
// 3 views"; a ⌥ link made after grouping stays); a key link leaves from the group (it attaches at the
// pile's bounds); generation arrows are bound to their ends and follow them; the pen owns the pointer.

import { describe, expect, it } from 'vitest'
import type { Link, ProductionDocument } from '../../../contracts/types'
import { updateDoc } from '../../../doc/store'
import { newId } from '../../../lib/ulid'
import { addKey } from '../../../test/jobFixtures'
import { modelStore, MAYA, SHA } from '../../../test/model'
import { cardOf, linkIdOf, linkMemory, linkNodes, reconcileLinks, seedNodes } from '../../nodes/nodes'
import { keyGroupFields } from '../../nodes/keyGroups'
import { applyKeyMerges, idTime, keyLinkMerges, mergeWords } from '../../nodes/mergeLinks'
import { provenanceFixes } from '../../nodes/provenance'
import { isInkTool } from '../../core/tools'
import { backWhenLive, goneWhenDead, offerGone } from '../../../ui/useUndo'
import type { CanvasElement } from '../../core/canvasAdapter'
import { OwnAdapter } from './adapter'
import { INK_OVER_Z, liveZ } from './engine'

const later = (ms: number) => new Date(Date.now() + ms).toISOString()

async function setup() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  const pics = [0, 1, 2].map((i) => a.imageNode({ x: 900 + i * 400, y: 0, width: 300, height: 400, assetSha: SHA(String.fromCharCode(97 + i)), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA(String.fromCharCode(97 + i)) } }))
  a.transact((els) => [...els, ...pics], { undoable: false })
  const doc = () => s.get() as unknown as ProductionDocument
  const nodeId = (i: number) => (pics[i].customData as { id: string }).id
  /** Name (or rename, keeping the ref, as the canvas's Name… does) a picture, `at` when. */
  const name = (i: number, key: string, variant: string, at = new Date().toISOString()) => updateDoc(s, (d) => {
    if (!Object.values(d.keys).some((k) => k.key === key)) addKey(d, key, 'character')
    const mine = Object.values(d.refs).find((r) => r.node === nodeId(i))
    if (mine) Object.assign(mine, { key, variant, named_at: at })
    else {
      const id = newId('ref')
      d.refs[id] = { id, v: 1, field_v: {}, key, variant, role: 'character', asset: SHA(String.fromCharCode(97 + i)), node: nodeId(i), named_at: at }
    }
  }, `name ${key}_${variant}`)
  const follow = () => {
    const f = keyGroupFields(a.elements(), doc())
    if (f.size) a.transact((all) => all.map((e) => (f.has(e.id) ? a.patch(e, f.get(e.id)!) : e)), { undoable: false })
  }
  const el = (i: number) => a.elements().find((e) => e.id === pics[i].id)!
  const script = () => a.elements().find((e) => cardOf(e)?.kind === 'script')!
  const write = (l: Link) => updateDoc(s, (d) => { d.links[l.id] = l }, `link ${l.from.kind} to ${l.to.kind}`).then(() => {})
  const linkEls = () => a.elements().filter((e) => linkIdOf(e) && !e.isDeleted)
  return { s, a, doc, name, follow, el, script, write, linkEls }
}

describe('one key, one link (owner, 2026-10-15)', () => {
  it('views linked singly before they were one group merge into the key link, as one undo step that stays undone', async () => {
    const { s, a, doc, name, follow, el, script, write, linkEls } = await setup()
    // Each named alone (three keys) and linked singly to the Script.
    await name(0, 'samurai', 'front')
    await name(1, 'ronin', 'side')
    await name(2, 'monk', 'back')
    for (const i of [0, 1, 2]) expect((await linkNodes(a, doc(), el(i), script(), write)).ok).toBe(true)
    expect(Object.values(doc().links).filter((l) => l.from.kind === 'ref')).toHaveLength(3)
    // Then named into one key: the views form a group.
    await name(1, 'samurai', 'side', later(5))
    await name(2, 'samurai', 'back', later(10))
    follow()
    const merges = keyLinkMerges(doc())
    expect(merges).toHaveLength(1)
    expect(mergeWords(merges[0])).toBe('Linked as @samurai · 3 views')
    expect(merges[0].targets).toHaveLength(1)
    expect(merges[0].targets[0].drop).toHaveLength(3)
    // The node layer's memory of the links this session (it has seen the three).
    const mem = linkMemory()
    reconcileLinks(a.elements(), doc(), mem)
    const declined = new Set<string>()
    const steps: unknown[] = []
    a.onStep((st) => steps.push(st))
    const made = applyKeyMerges(a, s, merges, declined, mem)
    await s.flush()
    // One link in the document, from the whole key; one arrow on the canvas, leaving from the group.
    const links = Object.values(doc().links).filter((l) => l.to.kind === 'script')
    expect(links.map((l) => l.from.kind)).toEqual(['key'])
    expect(linkEls().filter((e) => (e as CanvasElement & { endBinding?: { elementId: string } }).endBinding?.elementId === script().id)).toHaveLength(1)
    expect((a.elements().find((e) => e.id === made[0]) as CanvasElement & { startBinding?: { group?: string } }).startBinding?.group).toBe('key:samurai')
    expect(steps).toHaveLength(1)
    // Nothing more to merge.
    expect(keyLinkMerges(doc(), declined)).toHaveLength(0)
    // ⌘Z: the three single links come back and stay (the merge does not run again on them).
    reconcileLinks(a.elements(), doc(), mem)
    a.undoScene('undo')
    const found = reconcileLinks(a.elements(), doc(), mem)
    expect(found.relink.map((l) => l.from.kind)).toEqual(['ref', 'ref', 'ref'])
    await updateDoc(s, (d) => {
      for (const id of found.unlink) delete d.links[id]
      for (const l of found.relink) d.links[l.id] = l
    })
    expect(keyLinkMerges(doc(), declined)).toHaveLength(0)
    await s.close()
  })

  it('a view-only link made with ⌥ after grouping stays; one made before merges', async () => {
    const { s, a, doc, name, follow, el, script, write } = await setup()
    await name(0, 'samurai', 'front', later(-60_000))
    await name(1, 'samurai', 'side', later(-50_000))
    follow()
    // After grouping, ⌥ links the side alone, on purpose.
    expect((await linkNodes(a, doc(), el(1), script(), write, { single: true })).ok).toBe(true)
    expect(keyLinkMerges(doc())).toHaveLength(0)
    // A picture linked alone, then named into the key: its link merges.
    await name(2, 'monk', 'back', later(-40_000))
    expect((await linkNodes(a, doc(), el(2), script(), write)).ok).toBe(true)
    await name(2, 'samurai', 'back', later(1000))
    const m = keyLinkMerges(doc())
    expect(m[0].targets[0].drop.map((l) => l.from.id)).toEqual([Object.values(doc().refs).find((r) => r.variant === 'back')!.id])
    await s.close()
  })

  it('a key link drawn before it knew its group learns it; a link id carries when it was made', async () => {
    const { s, a, doc, name, follow, el, script, write } = await setup()
    await name(0, 'samurai', 'front')
    await name(1, 'samurai', 'side')
    follow()
    const r = await linkNodes(a, doc(), el(0), script(), write)
    expect(r.ok && (r.element as CanvasElement & { startBinding?: { group?: string } }).startBinding?.group).toBe('key:samurai')
    // As an older canvas drew it: no group.
    a.transact((all) => all.map((e) => (r.ok && e.id === r.element.id ? a.patch(e, { startBinding: { elementId: el(0).id } } as Partial<CanvasElement>) : e)), { undoable: false })
    const mem = linkMemory()
    expect(reconcileLinks(a.elements(), doc(), mem).regroup).toEqual([{ elId: r.ok ? r.element.id : '', group: 'key:samurai' }])
    const t = Date.now()
    expect(Math.abs(idTime(newId('link')) - t)).toBeLessThan(1000)
    expect(idTime('nonsense')).toBeNaN()
    await s.close()
  })
})

describe('generation arrows stay bound to their ends', () => {
  it('one that lost a binding is bound again by its provenance; a fragment whose ends are gone goes', () => {
    const a = new OwnAdapter()
    const sketch = a.sketchArea({ x: 0, y: 0, w: 160, h: 90, sketchId: 'sketch_1' } as never)
    const gen = a.imageNode({ x: 400, y: 0, width: 160, height: 90, assetSha: null, status: 'pending', customData: { kind: 'gen', id: 'job_1' } } as never)
    const bound = a.provenanceArrow({ origin: { x: 168, y: 45 }, points: [[0, 0], [112, -20], [224, 0]], fromElId: sketch.id, toElId: gen.id, color: '#FF4F2E', customData: { kind: 'provenance', from: 'sketch_1', to: 'job_1' } })
    const lost = { ...a.provenanceArrow({ origin: { x: 0, y: 0 }, points: [[0, 0], [1, 1]], fromElId: 'x', toElId: 'y', color: '#FF4F2E', customData: { kind: 'provenance', from: sketch.id, to: 'job_1' } }), startBinding: null, endBinding: null } as CanvasElement
    const orphan = a.provenanceArrow({ origin: { x: 0, y: 0 }, points: [[0, 0], [1, 1]], fromElId: 'gone', toElId: gen.id, color: '#FF4F2E', customData: { kind: 'provenance', from: 'node_gone', to: 'job_1' } })
    a.transact((els) => [...els, sketch, gen, bound, lost, orphan], { undoable: false })
    const fixes = provenanceFixes(a.elements())
    expect(fixes.has(bound.id)).toBe(false)
    expect(fixes.get(lost.id)).toEqual({ startBinding: { elementId: sketch.id }, endBinding: { elementId: gen.id } })
    expect(fixes.get(orphan.id)).toBe('delete')
  })

  it('is served where it is drawn now: it follows its end when that moves', () => {
    const a = new OwnAdapter()
    const sketch = a.sketchArea({ x: 0, y: 0, w: 160, h: 90, sketchId: 'sketch_1' } as never)
    const gen = a.imageNode({ x: 400, y: 0, width: 160, height: 90, assetSha: null, status: 'pending', customData: { kind: 'gen', id: 'job_1' } } as never)
    const arrow = a.provenanceArrow({ origin: { x: 168, y: 45 }, points: [[0, 0], [112, -20], [224, 0]], fromElId: sketch.id, toElId: gen.id, color: '#FF4F2E', customData: { kind: 'provenance', from: 'sketch_1', to: 'job_1' } })
    a.transact((els) => [...els, sketch, gen, arrow], { undoable: false })
    a.transact((els) => els.map((e) => (e.id === gen.id ? a.patch(e, { x: 900, y: 600 }) : e)), { undoable: true })
    const served = a.elements().find((e) => e.id === arrow.id)!
    const end = served.points!.at(-1)!
    // It now ends at the moved result (its facing edge), not where it was made (392, 45).
    expect(served.x + end[0] === 900 || served.y + end[1] === 600).toBe(true)
    // What it is served as is never written back: its stored route is as made.
    expect((a.scene.get(arrow.id)!.props.route as number[]).slice(-2)).toEqual([224, 0])
  })
})

describe('the pen owns the pointer', () => {
  it('with an ink tool in hand the live canvas sits above the cards, the cards take no pointer', () => {
    expect(isInkTool({ type: 'native', id: 'freedraw' })).toBe(true)
    expect(isInkTool({ type: 'native', id: 'eraser' })).toBe(true)
    expect(isInkTool({ type: 'native', id: 'highlighter' })).toBe(true)
    expect(isInkTool({ type: 'native', id: 'selection' })).toBe(false)
    expect(liveZ('ink')).toBe(INK_OVER_Z)
    // The node layer's cards are z 3 (nodes.css): above them.
    expect(INK_OVER_Z).toBeGreaterThan(3)
    expect(liveZ('select')).toBeLessThan(3)
  })
})

describe('"N deleted · Undo" leaves once ⌘Z took the step back', () => {
  it('a delete’s offer goes when what it deleted is live again; a make’s when what it made is gone', () => {
    const del = { label: '2 deleted', undo: () => {}, gone: backWhenLive(['a', 'b']) }
    // The canvas a frame behind: still shows them; the offer stays.
    expect(offerGone(del, new Set(['a', 'b', 'c']))).toBe(false)
    expect(offerGone(del, new Set(['c']))).toBe(false)
    expect(offerGone(del, new Set(['a', 'c']))).toBe(true)
    const make = { label: 'Video made', undo: () => {}, gone: goneWhenDead(['v']) }
    expect(offerGone(make, new Set())).toBe(false)
    expect(offerGone(make, new Set(['v']))).toBe(false)
    expect(offerGone(make, new Set())).toBe(true)
    expect(offerGone(null, new Set())).toBe(false)
  })
})
