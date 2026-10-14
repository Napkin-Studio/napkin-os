// Make from a prompt (features/prompt-start.clan): each start becomes today's job, with the node's
// scope as its refs. The runner is a recorder: what matters is what would be sent.

import { describe, expect, it, vi } from 'vitest'
import type { JobInput, LinkEndpoint, Op, ProductionDocument } from '../contracts/types'
import type { JobPurpose } from '../model/purpose'
import { systemUpdate, updateDoc } from '../doc/store'
import type { SubmitExtras } from './runner'
import { putBlob } from '../lib/blobs'
import { mainScript, mainStoryboard, mainVideo, refsList, scenesOf } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { MockRelay } from '../relay/mock'
import { addScene } from '../script/edits'
import { addShots, asset, id, job, MAYA, modelStore } from '../test/model'
import type { FrameDeps } from './frames'
import {
  isPastedScript, nameMadePicture, pictureFromWords, pictureJob, promptRefs, scriptFromLine, storyboardFromLine, suggestName,
  videoFromWords, videoSeconds,
} from './prompt'

interface Sent { op: Op; input: JobInput; purpose: JobPurpose; extras?: SubmitExtras }

async function project(): Promise<{ store: ModelStore; deps: FrameDeps; sent: Sent[] }> {
  const store = modelStore()
  await store.create(MAYA, 'First Light')
  await store.flush()
  const relay = new MockRelay({ renderer: { async render() { return [] } }, persistKey: null })
  const sent: Sent[] = []
  const runner = {
    submit: vi.fn(async (op: Op, input: JobInput, _p: string[], purpose: JobPurpose, jobId?: string, _m?: unknown, extras?: SubmitExtras) => {
      sent.push({ op, input, purpose, ...(extras ? { extras } : {}) })
      const j = job(store.get(), op, [], null, { ...(extras?.node ? { node: extras.node } : {}) })
      if (jobId) j.id = jobId
      await systemUpdate(store, (d) => { d.jobs[j.id] = j }, 'sync')
      return j.id
    }),
  }
  const deps = { relay, doc: store, ui: { get: () => ({ jobs: {} }) }, runner } as unknown as FrameDeps
  return { store, deps, sent }
}

/** A named picture, with bytes the relay can take. */
async function named(store: ModelStore, key: string, variant: string, role: 'character' | 'location' = 'character') {
  const sha = await putBlob(new Blob([`${key}_${variant}`], { type: 'image/png' }))
  const refId = id('ref')
  await updateDoc(store, (d) => {
    d.assets[sha] = asset(sha)
    const k = id('key')
    if (!Object.values(d.keys).some((x) => x.key === key)) d.keys[k] = { id: k, v: 1, field_v: {}, key, role }
    d.refs[refId] = { id: refId, v: 1, field_v: {}, key, variant, role, asset: sha }
  }, 'name')
  await store.flush()
  return refId
}

const doc = (s: ModelStore): ProductionDocument => s.get()

/** A reference linked into a node with its role, as the canvas writes it. */
async function refLink(store: ModelStore, refId: string, to: LinkEndpoint) {
  const l = id('link')
  await updateDoc(store, (d) => { d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'ref', id: refId }, to, role: d.refs[refId].role } }, 'link')
  await store.flush()
}

describe('script from a line', () => {
  it('writes the line as the first scene\'s words and asks Skye for a draft on that scene', async () => {
    const { store, deps, sent } = await project()
    const scriptId = mainScript(doc(store))!.id
    const r = await scriptFromLine(deps, store, scriptId, 'A runner drinks Lumen water at dawn on the cliffs.')
    expect('jobId' in r).toBe(true)
    const scene = scenesOf(doc(store), scriptId)[0]
    expect(scene.text).toContain('A runner drinks Lumen water at dawn')
    expect(sent).toHaveLength(1)
    expect(sent[0].op).toBe('write')
    expect(sent[0].purpose).toEqual({ for: 'write', scriptId })
    const w = sent[0].input.write!
    expect(w.intent).toBe('draft')
    expect(w.target).toEqual({ kind: 'scene', id: scene.id })
    expect(w.lines.map((l) => l.text).join(' ')).toContain('A runner drinks Lumen water')
  })

  it('imports a pasted Fountain script and starts nothing', async () => {
    const { store, deps, sent } = await project()
    const scriptId = mainScript(doc(store))!.id
    const pasted = 'EXT. CLIFFS - DAWN\n\nA runner stops at the edge.\n\nINT. KITCHEN - DAY\n\nShe pours a glass.'
    expect(isPastedScript(pasted)).toBe(true)
    const r = await scriptFromLine(deps, store, scriptId, pasted)
    expect(r).toMatchObject({ pasted: 2 })
    expect(sent).toHaveLength(0)
    expect(scenesOf(doc(store), scriptId).map((s) => s.heading)).toEqual(['EXT. CLIFFS - DAWN', 'INT. KITCHEN - DAY'])
  })

  it('refuses an empty box', async () => {
    const { store, deps } = await project()
    await expect(scriptFromLine(deps, store, mainScript(doc(store))!.id, '   ')).rejects.toThrow(/idea in a line/)
  })
})

describe('storyboard from a line', () => {
  it('sends the line as the script while the script is empty, with the storyboard\'s scope and the named pictures', async () => {
    const { store, deps, sent } = await project()
    const maya = await named(store, 'maya', 'front')
    await named(store, 'cliff', 'wide', 'location')
    const sb = mainStoryboard(doc(store))!
    await refLink(store, maya, { kind: 'storyboard', id: sb.id })
    await storyboardFromLine(deps, sb.id, 'A runner on @cliff_wide drinks water at dawn.')
    expect(sent).toHaveLength(1)
    expect(sent[0].op).toBe('shot_list')
    expect(sent[0].purpose).toEqual({ for: 'shot_list' })
    expect(sent[0].input.script).toBe('A runner on @cliff_wide drinks water at dawn.')
    // The scope (Maya, linked) and the name typed (the cliff), and nothing else.
    expect(sent[0].input.refs?.map((r) => r.name)).toEqual(['maya_front', 'cliff_wide'])
  })

  it('plans from the script, not the line, once the script has words', async () => {
    const { store, deps, sent } = await project()
    const scene = await addScene(store, mainScript(doc(store))!.id)
    await updateDoc(store, (d) => { d.scenes[scene].text = 'Maya runs the cliffs at dawn.' }, 'edit')
    await store.flush()
    const sb = mainStoryboard(doc(store))!
    await storyboardFromLine(deps, sb.id, 'Something else entirely.')
    expect(sent[0].input.script).toContain('Maya runs the cliffs at dawn.')
    expect(sent[0].input.script).not.toContain('Something else')
  })

  it('plans on the storyboard it started from, a second one too (+ Node)', async () => {
    const { store, deps, sent } = await project()
    const second = id('storyboard')
    await systemUpdate(store, (d) => { d.storyboards[second] = { id: second, v: 1, field_v: {}, title: 'Storyboard 2', ratio: '16:9', target_s: 15 } }, 'add a storyboard')
    await store.flush()
    await storyboardFromLine(deps, second, 'A runner drinks water at dawn.')
    expect(sent).toHaveLength(1)
    expect(sent[0].purpose).toEqual({ for: 'shot_list', storyboardId: second })
  })

  it('stops on an unknown @name before anything is sent', async () => {
    const { store, deps, sent } = await project()
    await expect(storyboardFromLine(deps, mainStoryboard(doc(store))!.id, 'A @jogger runs past.')).rejects.toThrow('No reference called @jogger')
    expect(sent).toHaveLength(0)
  })
})

describe('video from words', () => {
  it('links the project\'s empty storyboard into an unlinked video, then Dex plans from the words', async () => {
    const { store, deps, sent } = await project()
    const sb = mainStoryboard(doc(store))!
    // A video with nothing linked: take away whatever links the template made into it.
    const v = mainVideo(doc(store))!
    await updateDoc(store, (d) => { for (const l of Object.values(d.links)) if (l.to.id === v.id) delete d.links[l.id] }, 'unlink')
    await store.flush()
    expect(videoSeconds(doc(store), v.id)).toBe(Math.round(sb.target_s))
    await videoFromWords(deps, v.id, 'Fifteen seconds of a runner at dawn.')
    const link = Object.values(doc(store).links).find((l) => l.to.id === v.id)
    expect(link).toMatchObject({ from: { kind: 'storyboard', id: sb.id }, role: 'renders' })
    expect(sent.map((x) => x.op)).toEqual(['shot_list'])
    expect(sent[0].input.script).toBe('Fifteen seconds of a runner at dawn.')
  })

  it('will not re-plan a storyboard that already has shots: link it instead', async () => {
    const { store, deps, sent } = await project()
    const v = mainVideo(doc(store))!
    await updateDoc(store, (d) => {
      for (const l of Object.values(d.links)) if (l.to.id === v.id) delete d.links[l.id]
      addShots(d, 2)
    }, 'unlink')
    await store.flush()
    await expect(videoFromWords(deps, v.id, 'Anything.')).rejects.toThrow(/already has shots/)
    expect(sent).toHaveLength(0)
  })
})

describe('a picture from words', () => {
  it('is Wren\'s generate with the words and the node\'s scope, on the node; naming it makes one reference', async () => {
    const { store, deps, sent } = await project()
    const node = 'pic_node_1'
    const jobId = await pictureFromWords(deps, node, 'A glass bottle on a wet rock.', '1:1')
    expect(sent[0]).toMatchObject({ op: 'generate', purpose: { for: 'canvas' }, extras: { node: { kind: 'group', id: node } } })
    expect(sent[0].input).toMatchObject({ text: 'A glass bottle on a wet rock.', ratio: '1:1' })
    expect(pictureJob(doc(store), node)?.id).toBe(jobId)
    // It finishes: its output is the picture.
    const sha = await putBlob(new Blob(['bottle'], { type: 'image/png' }))
    await systemUpdate(store, (d) => { d.assets[sha] = asset(sha); d.jobs[jobId].state = 'completed'; d.jobs[jobId].outputs = [sha] }, 'sync')
    await store.flush()
    const name = suggestName(doc(store), 'A glass bottle on a wet rock.', 'product')
    expect(name).toEqual({ key: 'glass', variant: 'main' })
    const refId = await nameMadePicture(store, jobId, { ...name, role: 'product' }, node)
    await store.flush()
    const ref = doc(store).refs[refId]
    expect(ref).toMatchObject({ key: 'glass', variant: 'main', role: 'product', asset: sha, node })
    expect(refsList(doc(store)).filter((r) => r.asset === sha)).toHaveLength(1)
    // The same name for another picture is refused.
    const again = await pictureFromWords(deps, 'pic_node_2', 'Another bottle.')
    const other = await putBlob(new Blob(['other bottle'], { type: 'image/png' }))
    await systemUpdate(store, (d) => { d.assets[other] = asset(other); d.jobs[again].state = 'completed'; d.jobs[again].outputs = [other] }, 'sync')
    await store.flush()
    await expect(nameMadePicture(store, again, { key: 'glass', variant: 'main', role: 'product' })).rejects.toThrow('@glass_main is taken')
  })

  it('suggests a free name on a clash', async () => {
    const { store } = await project()
    await named(store, 'runner', 'front')
    expect(suggestName(doc(store), 'Runner at dawn', 'character')).toEqual({ key: 'runner', variant: 'front2' })
  })
})

describe('the scope a start sends', () => {
  it('is what is linked into the node, plus the names typed', async () => {
    const { store, deps } = await project()
    const maya = await named(store, 'maya', 'front')
    await named(store, 'sea', 'wide', 'location')
    const v = mainVideo(doc(store))!
    await refLink(store, maya, { kind: 'video', id: v.id })
    const refs = await promptRefs(deps.relay, doc(store), v.id, 'by the @sea_wide')
    expect(refs.map((r) => r.name)).toEqual(['maya_front', 'sea_wide'])
  })
})
