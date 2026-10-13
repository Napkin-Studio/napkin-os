// A new project opens on the canvas stage with one script, one storyboard and one video (contract 3),
// and the Storyboard and Video panels' writes land on the real .clan engine: the script's words in a
// scene, the ratio and length on the storyboard, new shots by rank, a take picked in the cut, a note
// with its window. The Video stage stays shut until every shot is locked or waits for review.

import { describe, expect, it, vi } from 'vitest'

// The engine does not load in node; the projects reach it only through export.ts.
vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))

import { ClanDocumentStore } from '../../../clan-store/src'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { currentTake, edlOf, mainScript, mainStoryboard, mainVideo, reviewsList, scenesOf, shotsOf, storyboardReady, unplannedText } from '../model/selectors'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { id, MAYA, SHA, wasm } from '../test/model'
import { addShot, moveShot, setRatio, setTarget, withMention, withoutMention, writeScript } from './storyboardEdits'
import { addTakeNote, pickTake } from './videoEdits'

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })

const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, quotas: { image: 40, video: 6, render: 3 }, projects: 0 }

async function newProject() {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-10-13T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const s = shell.get().session
  if (!s) throw new Error('no project open')
  return s.services
}

describe('a new project', () => {
  it('opens on the canvas stage with one script, one storyboard and one video', async () => {
    const { doc, ui } = await newProject()
    expect(ui.get().stage).toBe('character')
    const d = doc.get()
    expect(Object.keys(d.scripts)).toHaveLength(1)
    expect(Object.keys(d.storyboards)).toHaveLength(1)
    expect(Object.keys(d.videos)).toHaveLength(1)
    expect(mainScript(d)).toBeDefined()
    expect(mainStoryboard(d)).toBeDefined()
    expect(mainVideo(d)).toBeDefined()
    expect(shotsOf(d)).toEqual([])
    // Nothing to film yet: the Video stage stays shut.
    expect(storyboardReady(d)).toBe(false)
  })
})

describe('the Storyboard and Video panels on the .clan engine', () => {
  it('keep the script in a scene, the format and length on the storyboard, shots in rank order', async () => {
    const { doc } = await newProject()
    await updateDoc(doc, (d) => writeScript(d, 'It rains. Maya opens a red umbrella.'), 'edit')
    await updateDoc(doc, (d) => setRatio(d, '9:16'), 'set the storyboard format to 9:16')
    await updateDoc(doc, (d) => setTarget(d, 20), 'set the storyboard length to 20 s')
    await doc.flush()
    let d = doc.get()
    expect(scenesOf(d)).toHaveLength(1)
    expect(unplannedText(d)).toBe('It rains. Maya opens a red umbrella.')
    expect(mainStoryboard(d)!.ratio).toBe('9:16')
    expect(mainVideo(d)!.ratio).toBe('9:16')
    expect(mainStoryboard(d)!.target_s).toBe(20)

    const ids: string[] = []
    for (let i = 0; i < 3; i++) await updateDoc(doc, (x) => { ids.push(addShot(x)) }, 'add shot')
    await doc.flush()
    d = doc.get()
    expect(shotsOf(d).map((s) => s.id)).toEqual(ids)
    expect(shotsOf(d)[0].camera).toEqual({ size: 'medium', movement: 'static' })

    // Reorder: one rank write.
    await updateDoc(doc, (x) => moveShot(x, ids[2], -1), 'move shot')
    await doc.flush()
    expect(shotsOf(doc.get()).map((s) => s.id)).toEqual([ids[0], ids[2], ids[1]])
  })

  it('a take picked goes into the cut; a note gets its window', async () => {
    const { doc } = await newProject()
    let shotId = ''
    await updateDoc(doc, (x) => { shotId = addShot(x) }, 'add shot')
    const takes = [id('take'), id('take')]
    await updateDoc(doc, (x) => {
      for (const [i, t] of takes.entries()) {
        x.assets[SHA(String(i + 1))] = { sha256: SHA(String(i + 1)), kind: 'video', mime: 'video/mp4', origin: 'mock', locations: [] }
        x.takes[t] = { id: t, v: 1, field_v: {}, shot_id: shotId, version: i + 1, asset: SHA(String(i + 1)), job_id: id('job'), crew: 'wren', kind: 'mock', model: 'mock', provider: 'mock', duration_s: 5, segments: [] }
      }
    }, 'take')
    await updateDoc(doc, (x) => pickTake(x, shotId, takes[0]), 'pick take')
    await updateDoc(doc, (x) => pickTake(x, shotId, takes[1]), 'pick take')
    await doc.flush()
    let d = doc.get()
    expect(edlOf(d)).toHaveLength(1)
    expect(currentTake(d, shotId)?.id).toBe(takes[1])
    expect(edlOf(d)[0].pick?.alternates).toEqual([takes[0]])

    await updateDoc(doc, (x) => { addTakeNote(x, { takeId: takes[1], shotId, shotS: 5, atS: 2.5, text: 'the umbrella is blue', by: `human:${MAYA.id}` }) }, 'comment')
    await doc.flush()
    d = doc.get()
    const [note] = reviewsList(d)
    expect(note.target).toEqual({ kind: 'take', id: takes[1] })
    expect(note.window).toEqual({ from_s: 1, to_s: 4 })
    expect(note.state).toBe('open')
    expect(note.text).toBe('the umbrella is blue')
  })
})

describe('a shot\'s @names are in its words', () => {
  it('adds one at the end of the action and takes every mention out', () => {
    const shot = { action: 'Maya laughs' } as Parameters<typeof withMention>[0]
    expect(withMention(shot, 'maya_front')).toBe('Maya laughs @maya_front')
    expect(withoutMention('Maya @maya_front laughs at @lamp_on', 'maya_front')).toBe('Maya laughs at @lamp_on')
    expect(withoutMention('@maya and @maya_front', 'maya')).toBe('and @maya_front')
  })
})
