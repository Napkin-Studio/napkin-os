// A canvas picture's versions (features/edit-canvas-pictures.clan): Apply makes v1 (as it was) and v2 in
// place, the name follows, what was made from the old picture is marked to check, one undo step takes it
// all back; a version picked again is the one shown. Through the real store (the bundled schema).
import { describe, expect, it } from 'vitest'
import { systemUpdate } from '../../doc/store'
import { redo, undo } from '../../doc/undo'
import { currentPictureFrame, pictureVersions, refsList, staleList } from '../../model/selectors'
import { purposeNode, purposeOf } from '../../model/purpose'
import { addFrame, addShots, asset, id, job, MAYA, modelStore, SHA } from '../../test/model'
import { applyPictureEditedStep, pickPictureVersionStep } from './apply'
import { subjectOf } from './subject'

const NODE = 'node_picture01'
const out = (c: string) => ({ sha: SHA(c), bytes: 10, w: 800, h: 1000, edits: [{ op: 'fill', params: { words: 'warmer' } }] })

async function world(named = true) {
  const s = modelStore()
  await s.create(MAYA, 'Canvas picture')
  let frameId = ''
  await systemUpdate(s, (d) => {
    d.assets[SHA('a')] = asset(SHA('a'), 'image', { origin: 'uploaded', w: 800, h: 1000 })
    if (named) {
      const k = id('key')
      d.keys[k] = { id: k, v: 1, field_v: {}, key: 'baby', role: 'character' }
      const r = id('ref')
      d.refs[r] = { id: r, v: 1, field_v: {}, key: 'baby', variant: 'front', role: 'character', asset: SHA('a'), node: NODE }
    }
    // A storyboard frame drawn with the picture as an input.
    const [shot] = addShots(d, 1)
    const j = job(d, 'frame', [SHA('a')], SHA('f'), { node: { kind: 'shot', id: shot.id } })
    d.jobs[j.id] = j
    frameId = addFrame(d, shot, SHA('f'), { pick: true, job: j }).id
  })
  await s.flush()
  return { s, frameId }
}

const pic = { nodeId: NODE, sha: SHA('a'), w: 800, h: 1000 }

describe('Apply on a canvas picture', () => {
  it('keeps v1 as it was, shows v2, moves the name and marks what was made from the old picture', async () => {
    const { s, frameId } = await world()
    const made = await applyPictureEditedStep(s, pic, out('b'))
    const d = s.get()
    const versions = pictureVersions(d, NODE)
    expect(versions.map((f) => [f.version, f.kind, f.asset])).toEqual([[1, 'original', SHA('a')], [2, 'edited', SHA('b')]])
    expect(versions[0].crew).toBeUndefined()
    expect(versions[1]).toMatchObject({ parent_id: versions[0].id, crew: 'rhea', edits: [{ op: 'fill' }] })
    expect(currentPictureFrame(d, NODE)?.id).toBe(made?.id)
    expect(refsList(d)[0].asset).toBe(SHA('b'))
    expect(staleList(d).map((m) => [m.target, m.caused_by.kind])).toEqual([[{ kind: 'frame', id: frameId }, 'ref']])
    expect(d.assets[SHA('b')]).toMatchObject({ origin: 'edited', w: 800, h: 1000 })
  })

  it('is one undo step: the version, the name and the marks go back, and redo puts them back', async () => {
    const { s } = await world()
    await applyPictureEditedStep(s, pic, out('b'))
    expect(await undo(s)).toMatchObject({ done: true, label: 'apply edits to the picture as v2' })
    // v1 stays on record (kept before the step), so the canvas shows it again, after a reload too.
    expect(pictureVersions(s.get(), NODE).map((f) => [f.version, f.kind, f.asset])).toEqual([[1, 'original', SHA('a')]])
    expect(currentPictureFrame(s.get(), NODE)?.asset).toBe(SHA('a'))
    expect(refsList(s.get())[0].asset).toBe(SHA('a'))
    expect(staleList(s.get())).toEqual([])
    await redo(s)
    expect(currentPictureFrame(s.get(), NODE)?.asset).toBe(SHA('b'))
  })

  it('a second Apply makes v3 from v2; picking v1 shows it again and the name follows', async () => {
    const { s } = await world()
    await applyPictureEditedStep(s, pic, out('b'))
    const v3 = await applyPictureEditedStep(s, { ...pic, sha: SHA('b') }, out('c'))
    const [v1, v2] = pictureVersions(s.get(), NODE)
    expect(v3).toMatchObject({ version: 3, parent_id: v2.id })
    await pickPictureVersionStep(s, v1.id)
    expect(currentPictureFrame(s.get(), NODE)?.id).toBe(v1.id)
    expect(refsList(s.get())[0].asset).toBe(SHA('a'))
    await undo(s)
    expect(currentPictureFrame(s.get(), NODE)?.id).toBe(v3?.id)
  })

  it('an unnamed picture: its versions, and marks caused by the new version', async () => {
    const { s } = await world(false)
    const made = await applyPictureEditedStep(s, pic, out('b'))
    expect(staleList(s.get()).map((m) => m.caused_by)).toEqual([{ kind: 'frame', id: made!.id }])
  })
})

describe('the editor’s subject for a canvas picture', () => {
  it('before the first edit: v1, the canvas picture, its name and its shape', async () => {
    const { s } = await world()
    const sub = subjectOf(s.get(), { kind: 'picture', nodeId: NODE }, { sha: SHA('a') })!
    expect(sub).toMatchObject({ version: 1, sha: SHA('a'), title: '@baby_front', back: 'Canvas', sessionKey: NODE, aspect: 0.8, versions: [] })
    expect(sub.ratio).toBeUndefined()
    expect(sub.purpose).toEqual({ for: 'image_edit', target: { kind: 'picture', nodeId: NODE } })
  })

  it('after Apply: the current version, its session key and the purpose from it', async () => {
    const { s } = await world()
    const made = await applyPictureEditedStep(s, pic, out('b'))
    const sub = subjectOf(s.get(), { kind: 'picture', nodeId: NODE })!
    expect(sub).toMatchObject({ version: 2, sha: SHA('b'), sessionKey: made!.id, purpose: { parentFrameId: made!.id } })
  })

  it('an image_edit job on a picture runs on its canvas node and reads back as the picture', () => {
    const p = { for: 'image_edit' as const, target: { kind: 'picture' as const, nodeId: NODE }, parentFrameId: 'frame_x' }
    const node = purposeNode({} as never, p, 'job_x')
    expect(node).toEqual({ kind: 'group', id: NODE })
    expect(purposeOf({ purpose: 'image_edit', node, inputs: [{ kind: 'frame', ref: 'frame_x', used_as: 'new version of', included: true }] })).toEqual(p)
    expect(purposeOf({ purpose: 'image_edit', node: { kind: 'shot', id: 'shot_1' }, inputs: [] })).toEqual({ for: 'image_edit', target: { kind: 'shot', shotId: 'shot_1' } })
  })
})
