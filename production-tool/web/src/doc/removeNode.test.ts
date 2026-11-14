// A node leaving the canvas takes its document entity out through the removal
// cascade, and comes back with it (features/canvas-edit-tools.clan; ui-behaviour
// 3.3 Delete). The canvas side is driven with plain elements, as remove.test.ts does.

import { describe, expect, it } from 'vitest'
import { CanvasDocSync, runningOn, type SceneEl } from '../canvas/sync'
import type { Ask, Link, ProductionDocument } from '../contracts/types'
import { mainScript, mainStoryboard, mainVideo, scenesOf } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { addFrame, addShots, addTake, content, id, job, MAYA, modelStore, SHA, scriptWords } from '../test/model'
import { makeAjv, SCHEMA } from '../test/schemas'
import { deleteFrom, removeNode, restore } from './remove'
import { systemUpdate } from './store'

const validate = makeAjv().getSchema(SCHEMA('document'))!

/** A script with a scene, a storyboard with two shots (frames, a clip, its place in the cut), notes and asks. */
function fixture(d: ProductionDocument) {
  scriptWords(d, 'EXT. BEACH - DAWN\nMaya walks the beach.')
  const script = mainScript(d)!
  const sb = mainStoryboard(d)!
  const video = mainVideo(d)!
  const [scene] = scenesOf(d, script.id)
  const [s1, s2] = addShots(d, 2, { scene_id: scene.id })
  const fj = job(d, 'frame', [SHA('b')], SHA('d'))
  const cj = job(d, 'clip', [SHA('d')], SHA('1'))
  d.jobs[fj.id] = fj
  d.jobs[cj.id] = cj
  const f1 = addFrame(d, s1, SHA('d'), { pick: true, job: fj })
  const t1 = addTake(d, s1, SHA('1'), cj, { pick: true })
  const qid = id('q')
  const ask: Ask = { id: qid, v: 1, field_v: {}, question: { id: qid, kind: 'block', text: 'Which beach?', options: [], allow_text: true }, node: { kind: 'storyboard', id: sb.id }, crew: 'dex', state: 'open', answers: [] }
  d.asks[ask.id] = ask
  return { script, sb, video, scene, s1, s2, f1, t1, ask }
}

async function seeded<X>(build: (d: ProductionDocument) => X): Promise<{ s: ModelStore } & X> {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  let out: X | undefined
  await systemUpdate(s, (d) => { out = build(d) }, 'sync')
  await s.flush()
  if (s.trouble) throw new Error(`the fixture was refused: ${s.trouble}`)
  return { s, ...out! }
}

const linksOf = (d: ProductionDocument, nodeId: string): Link[] => Object.values(d.links).filter((l) => l.from.id === nodeId || l.to.id === nodeId)

describe('removeNode', () => {
  it('a storyboard takes its shots, frames, clips, place in the cut, links and asks; the script and video stay; restore puts it all back', async () => {
    const { s, sb, script, video, f1, t1, ask } = await seeded(fixture)
    const before = structuredClone(s.get())
    expect(linksOf(before, sb.id).length).toBeGreaterThan(0)
    const d = structuredClone(before)
    const r = removeNode(d, 'storyboard', sb.id)
    expect(d.storyboards[sb.id]).toBeUndefined()
    expect(Object.values(d.shots).filter((x) => x.storyboard_id === sb.id)).toEqual([])
    expect(d.frames[f1.id]).toBeUndefined()
    expect(d.generations[t1.id]).toBeUndefined()
    expect(Object.values(d.videos[video.id].timeline)).toEqual([])
    expect(linksOf(d, sb.id)).toEqual([])
    expect(d.asks[ask.id]).toBeUndefined()
    expect(d.scripts[script.id]).toBeDefined()
    expect(content(d.jobs as never)).toEqual(content(before.jobs as never))
    expect(r.note).toBe('with 2 shots, 1 frame and 1 clip')
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
    restore(d, r)
    expect(content(d)).toEqual(content(before))
  })

  it('a script takes its scenes; its shots keep their place without the scene', async () => {
    const { s, script, scene, s1 } = await seeded(fixture)
    const before = structuredClone(s.get())
    const d = structuredClone(before)
    const r = removeNode(d, 'script', script.id)
    expect(d.scripts[script.id]).toBeUndefined()
    expect(d.scenes[scene.id]).toBeUndefined()
    expect(d.shots[s1.id]).toBeDefined()
    expect(d.shots[s1.id].scene_id).toBeUndefined()
    expect(linksOf(d, script.id)).toEqual([])
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
    restore(d, r)
    expect(content(d)).toEqual(content(before))
  })

  it('a video takes its renders and the notes on it', async () => {
    const { s, video } = await seeded(fixture)
    const before = structuredClone(s.get())
    const d = structuredClone(before)
    const r = removeNode(d, 'video', video.id)
    expect(d.videos[video.id]).toBeUndefined()
    expect(linksOf(d, video.id)).toEqual([])
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
    restore(d, r)
    expect(content(d)).toEqual(content(before))
  })

  it('one that is already gone says so', async () => {
    const { s } = await seeded(fixture)
    expect(() => removeNode(structuredClone(s.get()), 'script', 'script_nope')).toThrow('That script is already gone.')
  })

  it('a person’s delete is one decision and one Undo step', async () => {
    const { s, sb } = await seeded(fixture)
    const before = content(s.get())
    await deleteFrom(s, (d) => removeNode(d, 'storyboard', sb.id))
    await s.flush()
    expect(s.undoLabels().undo).toMatch(/^delete storyboard/)
    await s.undo()
    expect(content(s.get())).toEqual(before)
  })
})

describe('canvas node delete ↔ document', () => {
  const nodeEl = (kind: string, nodeId: string): SceneEl => ({ id: `el_${nodeId}`, type: 'rectangle', customData: { kind, id: nodeId } })
  const del = (els: SceneEl[], elId: string, isDeleted = true) => els.map((e) => (e.id === elId ? { ...e, isDeleted } : e))

  it('a node deleted on the canvas leaves the document as the canvas’s write (not the person’s undo), and its Ctrl+Z puts it back', async () => {
    const { s, sb, script, video } = await seeded(fixture)
    const before = content(s.get())
    const cancelled: string[] = []
    const sync = new CanvasDocSync({ doc: s, cancel: (j) => cancelled.push(j) })
    let els = [nodeEl('script', script.id), nodeEl('storyboard', sb.id), nodeEl('video', video.id)]
    await sync.nodes(els)
    els = del(els, `el_${sb.id}`)
    await sync.nodes(els)
    expect(s.get().storyboards[sb.id]).toBeUndefined()
    expect(s.undoLabels().undo).toBeNull()
    const chain = (await s.chain()).map((e) => e.action)
    expect(chain.some((a) => a.startsWith('delete storyboard'))).toBe(true)
    els = del(els, `el_${sb.id}`, false)
    await sync.nodes(els)
    expect(content(s.get())).toEqual(before)
    expect(cancelled).toEqual([])
  })

  it('a running job on the node or its shots is stopped when it goes', async () => {
    const { s, sb, s2 } = await seeded((d) => {
      const out = fixture(d)
      const run = job(d, 'clip', [SHA('d')], null, { state: 'submitted', node: { kind: 'shot', id: out.s2.id } })
      d.jobs[run.id] = run
      return { ...out, run }
    })
    expect(runningOn(s.get(), 'storyboard', sb.id)).toHaveLength(1)
    expect(runningOn(s.get(), 'video', 'v_x')).toEqual([])
    const cancelled: string[] = []
    const sync = new CanvasDocSync({ doc: s, cancel: (j) => cancelled.push(j) })
    let els = [nodeEl('storyboard', sb.id)]
    await sync.nodes(els)
    els = del(els, `el_${sb.id}`)
    await sync.nodes(els)
    expect(cancelled).toHaveLength(1)
    expect(s.get().shots[s2.id]).toBeUndefined()
  })
})
