// Key groups and stacks on our own engine (owner, Shrey 2026-10-15; features/canvas-nodes.clan):
// pictures that share a key are one group, derived from their names, labelled "Samurai · 3 views";
// a newly named view goes beside the others; linking any view (or the group) links the key once,
// ⌥ one view; a stack piles the views like photos (bounded, deterministic turns), one undo step
// each way, and changes neither the links nor the scope.

import { describe, expect, it } from 'vitest'
import type { Link, ProductionDocument } from '../../../contracts/types'
import { updateDoc } from '../../../doc/store'
import { newId } from '../../../lib/ulid'
import { mainScript } from '../../../model/selectors'
import { inputChips, scopeOf } from '../../../model/scope'
import { addKey, addRef } from '../../../test/jobFixtures'
import { modelStore, MAYA, SHA } from '../../../test/model'
import { cardOf, endOf, linkMemory, linkNodes, reconcileLinks, seedNodes } from '../../nodes/nodes'
import { groupLabel, keyGroupFields, keyGroupsOn } from '../../nodes/keyGroups'
import { MAX_SHIFT, MAX_TURN, MIN_TURN, setStacked, stackLayout, TOP_TURN } from '../../nodes/stack'
import type { CanvasElement } from '../../core/canvasAdapter'
import { OwnAdapter } from './adapter'

async function setup(names: [string, string][] = [['samurai', 'front'], ['samurai', 'side'], ['samurai', 'back']]) {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  // Three pictures far apart, as dropped at different times.
  const pics = names.map((_, i) => a.imageNode({ x: 900 + i * 700, y: i * 500, width: 300, height: 400, assetSha: SHA(String.fromCharCode(97 + i)), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA(String.fromCharCode(97 + i)) } }))
  a.transact((els) => [...els, ...pics], { undoable: false })
  const doc = () => s.get() as unknown as ProductionDocument
  const name = async (i: number, key: string, variant: string) => {
    await updateDoc(s, (d) => {
      if (!Object.values(d.keys).some((k) => k.key === key)) addKey(d, key, 'character')
      const old = Object.values(d.refs).find((r) => r.node === (pics[i].customData as { id: string }).id)
      if (old) delete d.refs[old.id]
      const r = addRef(d, key, variant, SHA(String.fromCharCode(97 + i)), 'character')
      r.node = (pics[i].customData as { id: string }).id
      r.named_at = `2026-10-15T10:00:0${i}Z`
    }, `name ${key}_${variant}`)
  }
  // The NodeLayer's effect: the canvas follows the names (a system write).
  const follow = () => {
    const f = keyGroupFields(a.elements(), doc())
    if (f.size) a.transact((all) => all.map((e) => (f.has(e.id) ? a.patch(e, f.get(e.id)!) : e)), { undoable: false })
    return f
  }
  const el = (i: number) => a.elements().find((e) => e.id === pics[i].id)!
  const node = (k: string) => a.elements().find((e) => cardOf(e)?.kind === k)!
  const write = (l: Link) => updateDoc(s, (d) => { d.links[l.id] = l }, `link ${l.from.kind} to ${l.to.kind}`).then(() => {})
  return { s, a, doc, name, follow, el, pics, node, write }
}

describe('key groups follow the names', () => {
  it('views of one key group as "Samurai · 3 views", each newly named one placed beside the others; the next pass changes nothing', async () => {
    const { s, a, doc, name, follow, el } = await setup()
    // The front sits on the Characters board; its views join it there.
    const board = a.board({ x: 850, y: -50, width: 600, height: 600, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [board, ...all.map((e) => (e.id === el(0).id ? a.patch(e, { frameId: board.id }) : e))], { undoable: false })
    await name(0, 'samurai', 'front')
    expect(follow().size).toBe(0) // one view is not a group
    await name(1, 'samurai', 'side')
    follow()
    expect(el(0).groupIds).toEqual(['key:samurai'])
    expect(el(1).groupIds).toEqual(['key:samurai'])
    // The front stays where it was named first; the side comes to its right, top-aligned.
    expect([el(0).x, el(0).y]).toEqual([900, 0])
    expect([el(1).x, el(1).y]).toEqual([900 + 300 + 40, 0])
    expect(el(1).frameId).toBe(board.id)
    // The board grew toward it to hold it (owner decision 2026-10-15: boards grow to fit what lands on them).
    const grown = a.elements().find((e) => e.id === board.id)!
    expect(grown.x + grown.width).toBe(el(1).x + el(1).width + 16)
    expect([grown.x, grown.y, grown.height]).toEqual([850, -50, 600])
    await name(2, 'samurai', 'back')
    follow()
    expect([el(2).x, el(2).y, el(2).groupIds]).toEqual([900 + 2 * 340, 0, ['key:samurai']])
    const [g] = keyGroupsOn(a.elements(), doc())
    expect(groupLabel(g)).toBe('Samurai · 3 views')
    expect(g.members.map((m) => m.id)).toEqual([el(0).id, el(1).id, el(2).id])
    expect(follow().size).toBe(0)
    await s.close()
  })

  it('a renamed view leaves its group at once; a group of one is no group', async () => {
    const { s, doc, name, follow, el, a } = await setup()
    await name(0, 'samurai', 'front')
    await name(1, 'samurai', 'side')
    await name(2, 'samurai', 'back')
    follow()
    await name(2, 'ronin', 'front')
    follow()
    expect(el(2).groupIds).toEqual([])
    expect(keyGroupsOn(a.elements(), doc()).map(groupLabel)).toEqual(['Samurai · 2 views'])
    await name(1, 'ronin', 'side')
    follow()
    expect([el(0).groupIds, el(1).groupIds]).toEqual([[], ['key:ronin']])
    await s.close()
  })
})

describe('linking a key group', () => {
  it('any view links the whole key once ("@samurai · 3 views"); ⌥ links one view; undo of an unlink brings back the same ends', async () => {
    const { s, a, doc, name, follow, el, node, write } = await setup()
    await name(0, 'samurai', 'front')
    await name(1, 'samurai', 'side')
    await name(2, 'samurai', 'back')
    follow()
    const keyId = Object.values(doc().keys).find((k) => k.key === 'samurai')!.id
    expect(endOf(el(1), doc())).toMatchObject({ doc: { kind: 'key', id: keyId }, core: { kind: 'picture', role: 'character' } })
    expect(endOf(el(1), doc(), { single: true })).toMatchObject({ doc: { kind: 'ref' } })
    const script = mainScript(doc())!.id
    expect((await linkNodes(a, doc(), el(1), node('script'), write)).ok).toBe(true)
    // From another view: already linked, once.
    expect(await linkNodes(a, doc(), el(2), node('script'), write)).toMatchObject({ ok: false, reason: 'These are already linked.' })
    const into = Object.values(doc().links).filter((l) => l.to.id === script)
    expect(into.map((l) => [l.from.kind, l.from.id, l.role])).toEqual([['key', keyId, 'character']])
    expect(inputChips(scopeOf(doc(), script)).map((c) => c.label)).toEqual(['@samurai · 3 views'])
    // ⌥: the back alone, its own chip beside the key's.
    expect((await linkNodes(a, doc(), el(2), node('storyboard'), write, { single: true })).ok).toBe(true)
    expect(Object.values(doc().links).find((l) => l.to.kind === 'storyboard' && l.from.kind === 'ref')).toBeTruthy()
    // The arrow goes, then comes back by undo: still from the key.
    const mem = linkMemory()
    reconcileLinks(a.elements(), doc(), mem)
    const arrow = a.elements().find((e) => (e.customData as { kind?: string; id?: string })?.id === into[0].id)!
    a.transact((els) => els.map((e) => (e.id === arrow.id ? a.patch(e, { isDeleted: true }) : e)), { undoable: true })
    const gone = reconcileLinks(a.elements(), doc(), mem)
    expect(gone.unlink).toEqual([into[0].id])
    await updateDoc(s, (d) => { delete d.links[into[0].id] }, 'unlink')
    a.undoScene('undo')
    const back = reconcileLinks(a.elements(), doc(), mem)
    expect(back.relink.map((l) => l.from)).toEqual([{ kind: 'key', id: keyId }])
    await s.close()
  })
})

describe('stacks', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `el_${i}_${'x'.repeat(i)}`, w: 300, h: 400 }))

  it('lay out like a pile of photos: bounded turns and shifts, mixed directions, the top nearly straight, the same every time', () => {
    for (const n of [2, 3, 5, 8]) {
      const c = cards(n)
      const lay = stackLayout(c, { x: 100, y: 50 })
      expect(stackLayout(c, { x: 100, y: 50 })).toEqual(lay)
      const top = lay.get(c[0].id)!
      expect([top.x, top.y]).toEqual([100, 50])
      expect(Math.abs(top.angle)).toBeLessThanOrEqual(TOP_TURN)
      const below = c.slice(1).map((x) => lay.get(x.id)!)
      for (const p of below) {
        expect(Math.abs(p.angle)).toBeLessThanOrEqual(MAX_TURN + 1e-9)
        expect(Math.abs(p.angle)).toBeGreaterThanOrEqual(MIN_TURN - 1e-9)
        expect(Math.abs(p.x - top.x)).toBeLessThanOrEqual(MAX_SHIFT.x * 300 + 1e-9)
        expect(Math.abs(p.y - top.y)).toBeLessThanOrEqual(MAX_SHIFT.y * 400 + 1e-9)
      }
      // One way, then the other.
      for (let i = 1; i < below.length; i++) expect(Math.sign(below[i].angle)).toBe(-Math.sign(below[i - 1].angle))
    }
  })

  it('Stack and Spread are one undo step each, the front on top; neither changes the links or the scope', async () => {
    const { s, a, doc, name, follow, el, node, write } = await setup()
    await name(0, 'samurai', 'front')
    await name(1, 'samurai', 'side')
    await name(2, 'samurai', 'back')
    follow()
    expect((await linkNodes(a, doc(), el(1), node('script'), write)).ok).toBe(true)
    const script = mainScript(doc())!.id
    const scope = JSON.stringify(scopeOf(doc(), script))
    const links = JSON.stringify(doc().links)
    const spread = [0, 1, 2].map((i) => [el(i).x, el(i).y, el(i).angle ?? 0])
    const steps: unknown[] = []
    a.onStep((st) => steps.push(st))
    const g = () => keyGroupsOn(a.elements(), doc())[0]
    expect(setStacked(a, g().members, true)).toBe(true)
    expect(steps).toHaveLength(1)
    expect(g().stacked).toBe(true)
    // The front tops the pile, where it lay; the others are turned under it.
    const ids = a.elements().map((e) => e.id)
    expect(ids.indexOf(el(0).id)).toBeGreaterThan(Math.max(ids.indexOf(el(1).id), ids.indexOf(el(2).id)))
    expect([el(0).x, el(0).y]).toEqual([900, 0])
    expect(Math.abs(el(1).angle ?? 0)).toBeGreaterThan(MIN_TURN - 1e-9)
    expect(follow().size).toBe(0) // the names still agree
    expect(JSON.stringify(scopeOf(doc(), script))).toBe(scope)
    expect(JSON.stringify(doc().links)).toBe(links)
    expect(setStacked(a, g().members, true)).toBe(false) // already a stack
    // Undo lays it back out; redo piles it again; Spread lays it out as one step.
    a.undoScene('undo')
    expect([0, 1, 2].map((i) => [el(i).x, el(i).y, el(i).angle ?? 0])).toEqual(spread)
    expect(g().stacked).toBe(false)
    a.undoScene('redo')
    expect(g().stacked).toBe(true)
    // A stack moved as one spreads out where it now is.
    a.transact((all) => all.map((e) => (g().members.some((m) => m.id === e.id) ? a.patch(e, { x: e.x + 1000 }) : e)), { undoable: true })
    expect(setStacked(a, g().members, false)).toBe(true)
    expect([0, 1, 2].map((i) => [el(i).x, el(i).y, el(i).angle ?? 0])).toEqual(spread.map(([x, y, t]) => [x + 1000, y, t]))
    expect(g().stacked).toBe(false)
    expect(JSON.stringify(doc().links)).toBe(links)
    await s.close()
  })

  it('a view named while its group is stacked goes on the pile; one renamed out of it is laid back out', async () => {
    const { s, a, doc, name, follow, el } = await setup()
    await name(0, 'samurai', 'front')
    await name(1, 'samurai', 'side')
    follow()
    const g = () => keyGroupsOn(a.elements(), doc())[0]
    setStacked(a, g().members, true)
    await name(2, 'samurai', 'back')
    follow()
    expect(g().members).toHaveLength(3)
    expect(g().members.every((m) => !!(m as CanvasElement & { stack?: unknown }).stack)).toBe(true)
    expect(Math.abs(el(2).x - el(0).x)).toBeLessThanOrEqual(MAX_SHIFT.x * 300 + 1e-9)
    expect(follow().size).toBe(0)
    await name(1, 'ronin', 'front')
    follow()
    expect((el(1) as CanvasElement & { stack?: unknown }).stack).toBeUndefined()
    expect(el(1).angle ?? 0).toBe(0)
    await s.close()
  })
})
