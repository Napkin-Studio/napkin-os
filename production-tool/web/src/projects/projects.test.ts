// Home and the projects (features/project-home.clan): the index, switching
// between projects without anything leaking, the first load (a project of
// before is contract 2: left where it is), Open a file (another contract is
// refused in words), and naming. On the real .clan engine (napkin-wasm), with
// storage in memory (contract 3).

import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

// Excalidraw does not load in node; the adapter's serializeScene is all export.ts takes from it.
vi.mock('../canvas/adapter/excalidraw/serialize', () => ({
  serializeScene: (elements: unknown[], files: unknown) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files }),
}))
import { ClanDocumentStore } from '../../../clan-store/src'
import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import { emptyDocument, SnapshotStore, systemUpdate, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi, type UiState } from '../doc/ui'
import { undo, undoLabels } from '../doc/undo'
import { getBlob, putBlob } from '../lib/blobs'
import { purposeOf } from '../model/purpose'
import { mainScript, mainVideo, scenesOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { RelayError } from '../relay/types'
import { addShots, id, job, MAYA, SHA, T, v2Clan, wasm } from '../test/model'
import { LEGACY, migrateSingleProject } from './migrate'
import { NotAProject } from './openFile'
import { copyName, ordered, ProjectIndex, type ProjectEntry } from './projectIndex'
import { ProjectRefused, type MakeClan } from './session'
import { Shell } from './shell'
import { canvasKeyFor, clanDbFor, INDEX_KEY, memoryStorage, uiKeyFor } from './storage'
import { autoName, summarise, UNTITLED } from './summary'

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise<void>((r) => setImmediate(r))
}

const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, quotas: { image: 40, video: 6, render: 3 }, projects: 0 }

function setup(opts: { clock?: () => number } = {}) {
  const storage = memoryStorage()
  let t = Date.parse('2026-10-09T09:00:00Z')
  const now = () => new Date((t += 1000))
  const index = new ProjectIndex(storage, now)
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const renderer: MockRenderer = { async render() { return [{ blob: new Blob([`pic-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 9, h: 16 }] } }
  let rt = 1_000_000
  const relay = new MockRelay({ renderer, now: opts.clock ?? (() => rt), delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  return { storage, index, app, relay, shell, advance: (ms: number) => { rt += ms } }
}

const open = (shell: Shell) => {
  const s = shell.get().session
  if (!s) throw new Error('no project open')
  return s.services
}

const keys = (d: ProductionDocument) => Object.values(d.keys).map((k) => k.key).sort()
const nameKey = (store: DocumentStore, key: string, how: 'person' | 'system' = 'person') =>
  (how === 'person' ? updateDoc : systemUpdate)(store, (d) => {
    const k = id('key')
    d.keys[k] = { id: k, v: 1, field_v: {}, key, role: 'prop' }
  }, `name ${key}`)

/** The script's words: one scene with this text (written through the text bus). */
const writeScript = (store: DocumentStore, text: string) => updateDoc(store, (d) => {
  const sc = scenesOf(d)[0]
  if (sc) sc.text = text
  else {
    const sid = id('scene')
    d.scenes[sid] = { id: sid, v: 1, field_v: {}, script_id: mainScript(d)!.id, rank: 'a0', heading: 'INT. CITY - DAY', text }
  }
}, 'write')

describe('the project index', () => {
  it('creates, renames, orders and deletes', async () => {
    const { storage, index } = setup()
    const a = await index.create()
    const b = await index.create({ name: 'Coffee, 6 a.m.' })
    const c = await index.create()
    expect(a.name).toBe(UNTITLED)
    expect(a.naming).toBe('auto')
    expect(b.naming).toBe('person')
    // Newest change first.
    expect(ordered(index.all()).map((p) => p.id)).toEqual([c.id, b.id, a.id])
    await index.touch(a.id, { ...a.summary, shots: 2 })
    expect(ordered(index.all())[0].id).toBe(a.id)
    // By name, case aside; the untitled ones by newest.
    await index.rename(c.id, 'apple ad')
    expect(ordered(index.all(), 'name').map((p) => p.name)).toEqual(['apple ad', 'Coffee, 6 a.m.', UNTITLED])
    expect(ordered(index.all(), 'recent', 'coff').map((p) => p.id)).toEqual([b.id])
    await index.remove(b.id)
    expect(index.all().map((p) => p.id).sort()).toEqual([a.id, c.id].sort())
    // Kept in storage: a new index reads the same list.
    const again = new ProjectIndex(storage)
    expect(await again.load()).toBe(true)
    expect(ordered(again.all(), 'name').map((p) => p.name)).toEqual(['apple ad', UNTITLED])
    expect(a.id).toMatch(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('names copies so they do not clash', () => {
    expect(copyName('Rain', [])).toBe('Rain (copy)')
    expect(copyName('Rain', ['Rain (copy)'])).toBe('Rain (copy 2)')
    expect(copyName('Rain (copy)', ['Rain (copy)'])).toBe('Rain (copy 2)')
  })

  it('duplicates a project with its own document, canvas and UI; deletes only its own things', async () => {
    const { shell, storage, index } = setup()
    const p = await shell.newProject()
    const s = open(shell)
    const pic = await putBlob(new Blob(['a picture'], { type: 'image/png' }))
    await updateDoc(s.doc, (d) => { d.assets[pic] = { sha256: pic, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] } }, 'add picture')
    s.ui.update((u) => { u.stage = 'storyboard' })
    await storage.put(canvasKeyFor(p.id), { elements: [{ id: 'e1' }], files: {} })
    await shell.goHome()

    const copy = await shell.duplicate(p.id)
    expect(copy.name).toBe(`${UNTITLED} (copy)`)
    expect(index.get(copy.id)!.summary.pictures).toBe(1)
    await shell.open(copy.id)
    expect(Object.keys(open(shell).doc.get().assets)).toEqual([pic])
    expect(open(shell).ui.get().stage).toBe('storyboard')
    expect(open(shell).project.usedElsewhere(pic)).toBe(true)
    // The copy changes on its own.
    await updateDoc(open(shell).doc, (d) => { d.assets = {} }, 'remove picture')
    await shell.goHome()
    await shell.open(p.id)
    expect(Object.keys(open(shell).doc.get().assets)).toHaveLength(1)
    await shell.goHome()

    await shell.remove(copy.id)
    expect(index.get(copy.id)).toBeUndefined()
    expect(storage.clans.has(clanDbFor(copy.id))).toBe(false)
    expect(storage.kv.has(canvasKeyFor(copy.id))).toBe(false)
    expect(storage.kv.has(uiKeyFor(copy.id))).toBe(false)
    // The pictures stay (other projects use them): the blob store is never touched by a delete.
    expect(await getBlob(pic)).toBeDefined()
    expect(storage.clans.has(clanDbFor(p.id))).toBe(true)
  })
})

describe('switching between projects', () => {
  it('keeps each project\'s document, canvas, UI and undo steps its own', async () => {
    const { shell, storage } = setup()
    const a = await shell.newProject()
    const sa = open(shell)
    expect(sa.ui.get().stage).toBe('character')
    expect(sa.doc.get().project.created_by).toBe(`human:${MAYA.id}`)
    expect(sa.doc.get().project.tenant_id).toBe(MAYA.tenant_id)
    await nameKey(sa.doc, 'maya')
    await sa.doc.flush()
    sa.ui.update((u) => { u.stage = 'video'; u.frameRegions = { frame_x: { x: 0, y: 0, w: 1, h: 1 } } })
    await storage.put(canvasKeyFor(a.id), { elements: [{ id: 'canvas-a' }], files: {} })
    expect(undoLabels(sa.doc).undo).not.toBeNull()

    const b = await shell.newProject()
    expect(shell.get().session!.id).toBe(b.id)
    const sb = open(shell)
    expect(sb.doc.get().keys).toEqual({})
    expect(sb.ui.get().stage).toBe('character')
    expect(sb.ui.get().frameRegions).toEqual({})
    expect(undoLabels(sb.doc)).toEqual({ undo: null, redo: null })
    expect(shell.get().session!.initialCanvas).toBeNull()
    await nameKey(sb.doc, 'lamp')
    sb.ui.update((u) => { u.stage = 'storyboard' })

    await shell.open(a.id)
    const sa2 = open(shell)
    expect(keys(sa2.doc.get())).toEqual(['maya'])
    expect(sa2.ui.get().stage).toBe('video')
    expect(shell.get().session!.initialCanvas).toEqual({ elements: [{ id: 'canvas-a' }], files: {} })
    // A's undo step came back with A, and undoes A's change only.
    expect(undoLabels(sa2.doc).undo).not.toBeNull()
    expect(await undo(sa2.doc)).toMatchObject({ done: true })
    expect(sa2.doc.get().keys).toEqual({})

    await shell.open(b.id)
    expect(keys(open(shell).doc.get())).toEqual(['lamp'])
    expect(open(shell).ui.get().stage).toBe('storyboard')
    // The app's part (who is signed in) is the same everywhere.
    expect(open(shell).ui.get().me?.handle).toBe('maya')
  })

  it('a job still running when you switch lands in its own project, the next time it is opened', async () => {
    const { shell, relay, advance } = setup()
    const a = await shell.newProject()
    const sa = open(shell)
    const jobId = await sa.runner.submit('generate', { text: 'a red fox' }, [], { for: 'canvas' })
    expect(Object.values(sa.doc.get().jobs).map((j) => j.state)).toEqual(['queued'])

    const b = await shell.newProject()
    const sb = open(shell)
    advance(10_000)
    await relay.settled()
    await sb.runner.pollNow()
    await settle()
    expect(sb.doc.get().jobs).toEqual({})
    expect(sb.ui.get().jobs[jobId]).toBeUndefined()
    // The closed project's runner asks nothing more: the job waits in A's document.
    await sa.runner.pollNow()
    await settle()

    await shell.open(a.id)
    const back = open(shell)
    expect(Object.keys(back.doc.get().jobs)).toEqual([jobId])
    expect(purposeOf(back.doc.get().jobs[jobId])?.for).toBe('canvas') // what it is for is in the document
    await back.runner.pollNow()
    await relay.settled()
    await back.runner.pollNow()
    await settle()
    expect(back.doc.get().jobs[jobId].state).toBe('completed')
    expect(Object.keys(back.doc.get().assets)).toHaveLength(1)

    await shell.open(b.id)
    expect(open(shell).doc.get().jobs).toEqual({})
    expect(open(shell).doc.get().assets).toEqual({})
  })

  it('a reload opens the project you were in; New project never overwrites one', async () => {
    const { shell, app, index, storage } = setup()
    const a = await shell.newProject()
    await nameKey(open(shell).doc, 'maya')
    await shell.newProject()
    expect(index.all()).toHaveLength(2)
    await shell.open(a.id)
    expect(app.get()).toMatchObject({ view: 'project', project: a.id })
    await shell.get().session!.close()
    // A new shell over the same storage, as after a reload.
    const again = new Shell({ ...shell.deps, index: new ProjectIndex(storage) })
    await again.index.load()
    await again.start()
    expect(again.get().session!.id).toBe(a.id)
    expect(keys(open(again).doc.get())).toEqual(['maya'])
  })
})

describe('a reload while signed out', () => {
  it('a 401 opening the last project is the signed-out state: Home, nothing thrown, nothing logged', async () => {
    const { shell, index, app } = setup()
    const entry = await index.create({ name: 'Signed out' })
    app.update((a) => { a.view = 'project'; a.project = entry.id })
    const opened = vi.spyOn(shell, 'open').mockRejectedValue(new RelayError({ code: 'unauthorised', message: 'Sign in.', retryable: false }, 401))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(shell.start()).resolves.toBeUndefined()
      expect(shell.get()).toMatchObject({ view: 'home', session: null })
      expect(error).not.toHaveBeenCalled()
    } finally {
      opened.mockRestore()
      error.mockRestore()
    }
  })
})

describe('a project of another contract', () => {
  it('in the list: refused in words on open, Home stays, its bytes stay as they were', async () => {
    const { shell, index, storage, app } = setup()
    const entry = await index.create({ name: 'Before contract 3' })
    const bytes = await v2Clan()
    await storage.clan(clanDbFor(entry.id)).write({ bytes, handle: 'maya', savedAt: T })
    const create = vi.spyOn(ModelStore.prototype, 'create')
    try {
      const err = await shell.open(entry.id).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProjectRefused)
      expect((err as Error).message).toMatch(/older version of the Production Tool \(contract 2\)/)
      expect(create).not.toHaveBeenCalled()
    } finally {
      create.mockRestore()
    }
    expect(shell.get()).toMatchObject({ view: 'home', session: null })
    expect(app.get().view).toBe('home')
    expect(Buffer.from((await storage.clan(clanDbFor(entry.id)).read())!.bytes).equals(Buffer.from(bytes))).toBe(true)
    expect(index.get(entry.id)).toBeDefined()

    // After a reload into it, Home says why.
    app.update((a) => { a.view = 'project'; a.project = entry.id })
    await shell.start()
    expect(shell.get()).toMatchObject({ view: 'home', session: null })
    expect(shell.get().notice).toMatch(/older version/)
  })

  it('Open a file of another contract says so and never creates a project', async () => {
    const { shell, index, storage } = setup()
    const bytes = await v2Clan()
    const create = vi.spyOn(ModelStore.prototype, 'create')
    try {
      const err = await shell.openFile(new Blob([bytes.slice() as BlobPart]), 'before.clan').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NotAProject)
      expect((err as Error).message).toMatch(/older version of the Production Tool \(contract 2\)/)
      expect(create).not.toHaveBeenCalled()
    } finally {
      create.mockRestore()
    }
    expect(index.all()).toEqual([])
    expect([...storage.clans.values()].filter((c) => c.last)).toEqual([])
    // A plain-data export of another contract too.
    const old = zipSync({ 'document.json': strToU8(JSON.stringify({ contract_version: '2', participant: { id: 'p', handle: 'p' } })) })
    await expect(shell.openFile(new Blob([old as BlobPart]), 'old.zip')).rejects.toThrow(/older version/)
    expect(index.all()).toEqual([])
  })
})

describe('naming', () => {
  it('stays Untitled until the script has a first line, then follows it, until renamed', async () => {
    const { shell, index } = setup()
    const p = await shell.newProject()
    const s = open(shell)
    expect(index.get(p.id)!.name).toBe(UNTITLED)
    await writeScript(s.doc, '\n  A guinea pig takes on the city at rush hour.\nIt wins.')
    await s.doc.flush()
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('A guinea pig takes on the city at rush hour.')
    await writeScript(s.doc, 'Rain on a quiet street.')
    await s.doc.flush()
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('Rain on a quiet street.')
    await shell.rename(p.id, 'Rainy street, yellow umbrella')
    await writeScript(s.doc, 'Something else entirely.')
    await s.doc.flush()
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('Rainy street, yellow umbrella')
    // Blank goes back to naming itself.
    await shell.rename(p.id, '  ')
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('Something else entirely.')
  })

  it('cuts a long first line at a word; a planned shot\'s action counts as the script\'s', () => {
    const d = emptyDocument(MAYA)
    const sid = id('scene')
    d.scenes[sid] = { id: sid, v: 1, field_v: {}, script_id: mainScript(d)!.id, rank: 'a0', heading: 'EXT. STREET', text: 'Our hero, a small guinea pig with enormous ambitions, crosses the busiest street in the whole city' }
    const n = autoName(d)!
    expect(n.length).toBeLessThanOrEqual(61)
    expect(n.endsWith('…')).toBe(true)
    expect(autoName(emptyDocument(MAYA))).toBeNull()
    d.scenes[sid].text = ''
    addShots(d, 1, { scene_id: sid, action: 'The hero runs.' })
    expect(autoName(d)).toBe('The hero runs.')
  })
})

describe('what a card shows', () => {
  it('stage, counts, behind, the ad, and a picture', () => {
    const d = emptyDocument(MAYA)
    expect(summarise(d)).toMatchObject({ stage: 'character', pictures: 0, shots: 0, behind: 0, adSeconds: null, active: 0 })
    d.assets[SHA('a')] = { sha256: SHA('a'), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] }
    d.refs.ref_1 = { id: 'ref_1', v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('a') }
    expect(summarise(d).thumb).toBe(SHA('a'))
    const [shot] = addShots(d, 1, { duration_s: 4 })
    d.frames.frame_1 = { id: 'frame_1', v: 1, field_v: {}, shot_id: shot.id, version: 1, kind: 'mock', asset: SHA('b'), crew: 'wren' }
    shot.pick = { current: 'frame_1' }
    const mark = (sid: string, frame: string) => ({ id: sid, v: 1, field_v: {}, target: { kind: 'take' as const, id: 't1' }, caused_by: { kind: 'frame' as const, id: frame }, reason: 'x' })
    d.stale.stale_1 = mark('stale_1', 'f1')
    d.stale.stale_2 = mark('stale_2', 'f2')
    d.assets[SHA('c')] = { sha256: SHA('c'), kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [], duration_s: 12.4 }
    d.renders.render_1 = { id: 'render_1', v: 1, field_v: {}, video_id: mainVideo(d)!.id, version: 1, asset: SHA('c'), job_id: 'job_r' }
    const s = summarise(d, { stage: 'video' })
    expect(s).toMatchObject({ stage: 'video', shots: 1, behind: 1, adSeconds: 12, thumb: SHA('b') })
    expect(s.shas.sort()).toEqual([SHA('a'), SHA('c')])
  })

  it('says what is being made', () => {
    const d = emptyDocument(MAYA)
    const [, s2] = addShots(d, 2)
    const j = job(d, 'clip', [], null, { state: 'submitted', node: { kind: 'shot', id: s2.id }, purpose: 'clip' })
    d.jobs[j.id] = j
    const s = summarise(d)
    expect(s.active).toBe(1)
    expect(s.making).toBe('Dex is making the clip for shot 2')
  })
})

describe('the first load: a project of before', () => {
  async function legacyV3(storage: ReturnType<typeof memoryStorage>) {
    const store = makeClan(storage.clan(LEGACY.clanDb), { person: MAYA })
    await store.create(MAYA, 'Shop')
    await nameKey(store, 'maya')
    await writeScript(store, 'Maya opens the shop.')
    await store.close()
    await storage.put(LEGACY.canvas, { elements: [{ id: 'old-canvas' }], files: {} } as unknown as CanvasSnapshot)
    const ui: Partial<UiState> = { configChoice: 'remote', providerChoice: 'config', me: ME, stage: 'storyboard', jobs: {}, frameRegions: {} }
    await storage.put(LEGACY.ui, ui)
  }

  it('one made under contract 2 is left where it is, exactly as it was, and not listed', async () => {
    const { storage, index } = setup()
    const bytes = await v2Clan()
    await storage.clan(LEGACY.clanDb).write({ bytes, handle: 'maya', savedAt: T })
    const canvas = { elements: [{ id: 'old-canvas' }], files: {} }
    await storage.put(LEGACY.canvas, canvas)
    const ui = { configChoice: 'remote', scriptDraft: 'Maya opens the shop.', jobCtx: {} }
    await storage.put(LEGACY.ui, ui)
    const doc = { contract_version: '2', participant: { id: 'p_maya01', handle: 'maya' } }
    await storage.put(LEGACY.doc, doc)

    expect(await migrateSingleProject(storage, index, makeClan)).toEqual({ id: null, left: true })
    expect(index.all()).toEqual([])
    expect(await storage.get(INDEX_KEY)).toEqual({ version: 1, projects: [] })
    expect(Buffer.from((await storage.clan(LEGACY.clanDb).read())!.bytes).equals(Buffer.from(bytes))).toBe(true)
    expect(await storage.get(LEGACY.canvas)).toEqual(canvas)
    expect(await storage.get(LEGACY.ui)).toEqual(ui)
    expect(await storage.get(LEGACY.doc)).toEqual(doc)
    expect([...storage.clans.keys()]).toEqual([LEGACY.clanDb])
    // With the index written, the next load reads it and migrates nothing.
    expect(await new ProjectIndex(storage).load()).toBe(true)
  })

  it('one this build reads moves into the first project, and loses nothing', async () => {
    const { storage, index, shell } = setup()
    await legacyV3(storage)
    const before = (await storage.clan(LEGACY.clanDb).read())!.bytes
    expect(await index.load()).toBe(false)
    const { id: pid, left } = await migrateSingleProject(storage, index, makeClan)
    expect(left).toBe(false)
    expect(pid).toMatch(/^prj_/)
    expect(index.get(pid!) as ProjectEntry).toMatchObject({ name: 'Maya opens the shop.', naming: 'auto' })
    // Moved: the .clan's bytes as they were, the canvas, the project's UI; the old places cleared.
    expect((await storage.clan(clanDbFor(pid!)).read())!.bytes).toEqual(before)
    expect(await storage.clan(LEGACY.clanDb).read()).toBeNull()
    expect(await storage.get(canvasKeyFor(pid!))).toEqual({ elements: [{ id: 'old-canvas' }], files: {} })
    expect(await storage.get(LEGACY.canvas)).toBeUndefined()
    expect(await storage.get(uiKeyFor(pid!))).toMatchObject({ stage: 'storyboard' })
    // The app's part stays under 'ui', without the project's.
    const appUi = await storage.get<Record<string, unknown>>(LEGACY.ui)
    expect(appUi).toMatchObject({ configChoice: 'remote', providerChoice: 'config', view: 'home' })
    expect(appUi).not.toHaveProperty('stage')

    // And it opens as it was.
    await shell.open(pid!)
    const s = open(shell)
    expect(keys(s.doc.get())).toEqual(['maya'])
    expect(s.ui.get().stage).toBe('storyboard')
    expect(shell.get().session!.initialCanvas).toEqual({ elements: [{ id: 'old-canvas' }], files: {} })
  })

  it('carries nothing over from a first visit that never did anything, unless it has a canvas', async () => {
    const empty = async (canvas?: CanvasSnapshot) => {
      const { storage, index } = setup()
      const store = makeClan(storage.clan(LEGACY.clanDb), { person: MAYA })
      await store.create(MAYA)
      await store.close()
      if (canvas) await storage.put(LEGACY.canvas, canvas)
      return { index, ...(await migrateSingleProject(storage, index, makeClan)) }
    }
    const none = await empty()
    expect(none.id).toBeNull()
    expect(none.index.all()).toEqual([])
    const drawn = await empty({ elements: [{ id: 'a drawing' }], files: {} } as unknown as CanvasSnapshot)
    expect(drawn.id).not.toBeNull()
    expect(drawn.index.get(drawn.id!)!.name).toBe(UNTITLED)
  })
})

describe('Open a file', () => {
  async function projectWithWork(shell: Shell, storage: ReturnType<typeof memoryStorage>) {
    const p = await shell.newProject()
    const s = open(shell)
    const pic = await putBlob(new Blob([`picture ${Math.random()}`], { type: 'image/png' }))
    await updateDoc(s.doc, (d) => {
      d.assets[pic] = { sha256: pic, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] }
      const k = id('key')
      d.keys[k] = { id: k, v: 1, field_v: {}, key: 'maya', role: 'character' }
      const r = id('ref')
      d.refs[r] = { id: r, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: pic }
    }, 'work')
    await writeScript(s.doc, 'Maya and the lamp.')
    await s.doc.flush()
    await storage.put(canvasKeyFor(p.id), { elements: [{ id: 'node-1', type: 'image' }], files: {} })
    await shell.goHome()
    return { p, pic }
  }

  it('an Export zip becomes a new project with its pictures and canvas', async () => {
    const { shell, storage, index } = setup()
    const { p, pic } = await projectWithWork(shell, storage)
    const { blob, name } = await shell.exportProject(p.id)
    expect(name).toBe('napkin-maya-and-the-lamp-production.zip')
    const files = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))
    expect(files).toEqual(expect.arrayContaining(['canvas.excalidraw']))
    expect(files.filter((f) => f.endsWith('.clan'))).toHaveLength(1)

    const entry = await shell.openFile(blob, name)
    expect(entry.id).not.toBe(p.id)
    expect(index.all()).toHaveLength(2)
    expect(entry.name).toBe('Maya and the lamp.')
    expect(shell.get().session!.id).toBe(entry.id)
    const s = open(shell)
    expect(Object.values(s.doc.get().refs).map((r) => r.asset)).toEqual([pic])
    expect(keys(s.doc.get())).toEqual(['maya'])
    expect(await getBlob(pic)).toBeDefined()
    expect(shell.get().session!.initialCanvas?.elements).toEqual([expect.objectContaining({ id: 'node-1' })])
  })

  it('puts the pictures back from the zip, checked against their hash', async () => {
    const { shell, storage } = setup()
    const bytes = strToU8(`only in the zip ${Math.random()}`)
    const pic = await putBlob(new Blob([bytes as BlobPart], { type: 'image/png' }))
    const { p } = await projectWithWork(shell, storage)
    await shell.open(p.id)
    await updateDoc(open(shell).doc, (d) => { d.assets[pic] = { sha256: pic, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] } }, 'add')
    const clan = await open(shell).doc.exportClan()
    await shell.goHome()
    const hex = pic.slice('sha256:'.length)
    const zip = zipSync({ 'maya.clan': clan, [`assets/${hex}.png`]: bytes, [`assets/${'0'.repeat(64)}.png`]: strToU8('wrong') })
    // As on another computer: this browser does not have the picture yet.
    const { deleteBlob } = await import('../lib/blobs')
    await deleteBlob(pic)
    await shell.openFile(new Blob([zip as BlobPart]), 'napkin-maya-production.zip')
    const back = await getBlob(pic)
    expect(new Uint8Array(await back!.arrayBuffer())).toEqual(bytes)
    expect(back!.type).toBe('image/png')
  })

  it('a bare .clan too; something else is refused and adds nothing', async () => {
    const { shell, storage, index } = setup()
    const { p } = await projectWithWork(shell, storage)
    await shell.open(p.id)
    const clan = await open(shell).doc.exportClan()
    await shell.goHome()
    const entry = await shell.openFile(new Blob([clan as BlobPart]), 'maya.clan')
    expect(keys(open(shell).doc.get())).toEqual(['maya'])
    expect(entry.name).toBe('Maya and the lamp.')
    await shell.goHome()
    await expect(shell.openFile(new Blob(['not a zip']), 'notes.txt')).rejects.toThrow(/not an Export zip or a \.clan/)
    await expect(shell.openFile(new Blob([zipSync({ 'readme.txt': strToU8('hi') }) as BlobPart]), 'other.zip')).rejects.toThrow(/no \.clan/)
    expect(index.all()).toHaveLength(2)
  })
})

describe('the app\'s part and the project\'s part of the UI', () => {
  it('a late write from a closed project never reaches the next one', async () => {
    const { shell, storage } = setup()
    const a = await shell.newProject()
    const sa = open(shell)
    await shell.newProject()
    // A's chain still unwinding after the switch:
    sa.ui.update((u) => { u.stage = 'video' })
    await nameKey(sa.doc, 'late', 'system')
    expect(open(shell).ui.get().stage).toBe('character')
    expect(open(shell).doc.get().keys).toEqual({})
    await settle()
    expect((await storage.get<{ stage: string }>(uiKeyFor(a.id)))?.stage ?? 'character').toBe('character')
    await shell.open(a.id)
    expect(open(shell).doc.get().keys).toEqual({})
  })
})

