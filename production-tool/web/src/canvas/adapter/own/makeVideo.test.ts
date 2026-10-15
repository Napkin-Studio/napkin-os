// Make video and the storyboard a script drives, on our own engine (ui-behaviour 3.5, 3.10;
// features/production-ui.clan), with a real contract-3 document: each make is one undo step, beside
// what it came from, with only the links the spec names.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { addShots, modelStore, MAYA } from '../../../test/model'
import { mainScript, mainStoryboard, storyboardOfScript, storyboardOfVideo } from '../../../model/selectors'
import { cardOf, createNode, linkIdOf, seedNodes } from '../../nodes/nodes'
import { makeVideo, storyboardFor, storyboardFromShots } from '../../nodes/make'
import { ownShotList } from '../../../jobs/prompt'
import { updateDoc } from '../../../doc/store'
import { deleteFrom, removeNode } from '../../../doc/remove'
import { CanvasDocSync } from '../../sync'
import { waitsOnScriptAsk } from '../../../jobs/scriptVideo'
import { OwnAdapter } from './adapter'

async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  return { a, s, doc: () => s.get() as unknown as ProductionDocument }
}

const nodeOf = (a: OwnAdapter, id: string) => a.elements().find((e) => cardOf(e)?.id === id)!
const linksTo = (d: ProductionDocument, id: string) => Object.values(d.links).filter((l) => l.to.id === id || l.from.id === id)
const arrows = (a: OwnAdapter) => a.elements().filter((e) => linkIdOf(e))

describe('Make video (3.5)', () => {
  it('Script + Storyboard: the Video right of the storyboard, a renders link and the missing drives link, one undo step', async () => {
    const { a, s, doc } = await seeded()
    const sc = mainScript(doc())!.id
    // A second, unlinked storyboard: its drives link is missing.
    const sbEl = await createNode({ canvas: a, doc: s }, 'storyboard')
    const sb = cardOf(sbEl)!.id
    const before = arrows(a).length
    const r = await makeVideo({ canvas: a, doc: s }, { scriptId: sc, storyboardId: sb })
    expect(r.label).toBe('Video made from Script and Storyboard · 2 links')
    const v = doc().videos[r.videoId]
    expect(v).toBeTruthy()
    const el = nodeOf(a, r.videoId)
    expect(el.x).toBeGreaterThanOrEqual(sbEl.x + sbEl.width)
    const roles = linksTo(doc(), r.videoId).map((l) => `${l.from.kind}>${l.to.kind}:${l.role}`)
    expect(roles).toEqual(['storyboard>video:renders'])
    expect(Object.values(doc().links).some((l) => l.from.id === sc && l.to.id === sb && l.role === 'drives')).toBe(true)
    expect(arrows(a).length).toBe(before + 2)
    expect(a.view().selectedIds).toEqual([el.id])
    // One undo step takes the node and both link elements away.
    a.undoScene('undo')
    expect(a.elements().some((e) => cardOf(e)?.id === r.videoId)).toBe(false)
    expect(arrows(a).length).toBe(before)
    await s.close()
  })

  it('a drives link already there is not made again', async () => {
    const { a, s, doc } = await seeded()
    const r = await makeVideo({ canvas: a, doc: s }, { scriptId: mainScript(doc())!.id, storyboardId: mainStoryboard(doc())!.id })
    expect(r.links).toBe(1)
    expect(r.label).toBe('Video made from Script and Storyboard · 1 link')
    await s.close()
  })

  it('a Script alone: the Video beside it with a drives link, and the video waits on Dex\'s question', async () => {
    const { a, s, doc } = await seeded()
    const sc = mainScript(doc())!.id
    const r = await makeVideo({ canvas: a, doc: s }, { scriptId: sc })
    expect(r.label).toBe('Video made from Script · 1 link')
    expect(linksTo(doc(), r.videoId).map((l) => `${l.from.kind}>${l.to.kind}:${l.role}`)).toEqual(['script>video:drives'])
    expect(waitsOnScriptAsk(doc(), r.videoId)).toBe(sc)
    const scEl = nodeOf(a, sc)
    expect(nodeOf(a, r.videoId).x).toBeGreaterThanOrEqual(scEl.x + scEl.width)
    await s.close()
  })

  it('a Storyboard alone: a renders link only; no job starts', async () => {
    const { a, s, doc } = await seeded()
    const jobs = Object.keys(doc().jobs).length
    const r = await makeVideo({ canvas: a, doc: s }, { storyboardId: mainStoryboard(doc())!.id })
    expect(linksTo(doc(), r.videoId).map((l) => l.role)).toEqual(['renders'])
    expect(Object.keys(doc().jobs)).toHaveLength(jobs)
    await s.close()
  })
})

describe('the storyboard a script drives (3.10 Plan shots)', () => {
  it('a script with none gets a new one beside it with the drives link, one undo step; asked again, the same one', async () => {
    const { a, s, doc } = await seeded()
    const scEl = await createNode({ canvas: a, doc: s }, 'script')
    const sc = cardOf(scEl)!.id
    const r = await storyboardFor({ canvas: a, doc: s }, sc)
    expect(r.made).toBe(true)
    expect(doc().storyboards[r.storyboardId]).toBeTruthy()
    expect(Object.values(doc().links).filter((l) => l.to.id === r.storyboardId).map((l) => [l.from.id, l.role])).toEqual([[sc, 'drives']])
    expect(nodeOf(a, r.storyboardId).x).toBeGreaterThanOrEqual(scEl.x + scEl.width)
    expect((await storyboardFor({ canvas: a, doc: s }, sc)).storyboardId).toBe(r.storyboardId)
    a.undoScene('undo')
    expect(a.elements().some((e) => cardOf(e)?.id === r.storyboardId)).toBe(false)
    await s.close()
  })

  it('the project\'s script keeps its storyboard', async () => {
    const { a, s, doc } = await seeded()
    const r = await storyboardFor({ canvas: a, doc: s }, mainScript(doc())!.id)
    expect(r).toMatchObject({ storyboardId: mainStoryboard(doc())!.id, made: false })
    await s.close()
  })
})

describe('Make a storyboard from these shots (3.13, decided 2026-10-15)', () => {
  /** A video made from the script alone, with its own shot list (no node) holding one shot. */
  async function direct() {
    const env = await seeded()
    const { a, s, doc } = env
    const r = await makeVideo({ canvas: a, doc: s }, { scriptId: mainScript(doc())!.id })
    const own = await ownShotList(s, r.videoId)
    let shotId = ''
    await updateDoc(s, (d) => { const [x] = addShots(d, 1, { action: 'She drinks.' }); x.storyboard_id = own; shotId = x.id }, 'plan')
    const sync = new CanvasDocSync({ doc: s, cancel: () => {} })
    await sync.nodes(a.elements({ includeDeleted: true }))
    return { ...env, videoId: r.videoId, own, shotId, sync }
  }

  it('a video\'s own shot list has no node and is not the script\'s storyboard', async () => {
    const { a, s, doc, videoId, own } = await direct()
    expect(doc().storyboards[own]).toMatchObject({ implicit: true, video_id: videoId })
    expect(a.elements().some((e) => cardOf(e)?.id === own)).toBe(false)
    expect(storyboardOfScript(doc(), mainScript(doc())!.id)?.id).not.toBe(own)
    expect(storyboardOfVideo(doc(), videoId)?.id).toBe(own)
    await s.close()
  })

  it('shows it as a node beside the video, driven by the script, the shots kept; Undo puts them back in the video', async () => {
    const { a, s, doc, videoId, own, shotId, sync } = await direct()
    const r = await storyboardFromShots({ canvas: a, doc: s }, videoId)
    expect(r.storyboardId).toBe(own)
    expect(doc().storyboards[own].implicit).toBeUndefined()
    const vEl = nodeOf(a, videoId)
    expect(nodeOf(a, own).x).toBeGreaterThanOrEqual(vEl.x + vEl.width)
    expect(linksTo(doc(), own).map((l) => `${l.from.kind}>${l.to.kind}:${l.role}`).sort()).toEqual(['script>storyboard:drives', 'storyboard>video:renders'])
    expect(storyboardOfScript(doc(), mainScript(doc())!.id)?.id).not.toBe(own) // the main storyboard is still the script's first
    expect(doc().shots[shotId].storyboard_id).toBe(own)
    await sync.nodes(a.elements({ includeDeleted: true }))
    a.undoScene('undo')
    await sync.nodes(a.elements({ includeDeleted: true }))
    expect(a.elements().some((e) => cardOf(e)?.id === own)).toBe(false)
    expect(doc().storyboards[own]).toMatchObject({ implicit: true, video_id: videoId })
    expect(doc().shots[shotId]).toBeDefined()
    a.undoScene('redo')
    await sync.nodes(a.elements({ includeDeleted: true }))
    expect(doc().storyboards[own].implicit).toBeUndefined()
    await s.close()
  })

  it('deleting the Video takes its own shot list and shots with it', async () => {
    const { s, doc, videoId, own, shotId } = await direct()
    await deleteFrom(s, (d) => removeNode(d, 'video', videoId))
    expect(doc().storyboards[own]).toBeUndefined()
    expect(doc().shots[shotId]).toBeUndefined()
    await s.close()
  })
})
