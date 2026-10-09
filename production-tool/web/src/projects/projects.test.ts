// Home and the projects (features/project-home.clan): the index, switching
// between projects without anything leaking, the first load's migration of the
// one project of before, Open a file, and naming. On the real .clan engine
// (napkin-wasm), with storage in memory.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

// Excalidraw does not load in node; its export of the scene is all export.ts takes from it.
vi.mock('@excalidraw/excalidraw', () => ({
  serializeAsJSON: (elements: unknown[], _app: unknown, files: unknown) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files }),
}))
import { ClanDocumentStore } from '../../../clan-store/src'
import type { CanvasSnapshot } from '../canvas/controller'
import { ClanBackedStore } from '../doc/clan'
import { emptyDocument, SnapshotStore, systemUpdate, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi, type UiState } from '../doc/ui'
import { undo, undoState } from '../doc/undo'
import { OwnKeysStore } from '../keys/ownKeys'
import { getBlob, putBlob } from '../lib/blobs'
import { newId } from '../lib/ulid'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { LEGACY, migrateSingleProject } from './migrate'
import { copyName, ordered, ProjectIndex, type ProjectEntry } from './projectIndex'
import type { MakeClan } from './session'
import { Shell } from './shell'
import { canvasKeyFor, clanDbFor, INDEX_KEY, memoryStorage, uiKeyFor } from './storage'
import { autoName, summarise, UNTITLED } from './summary'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))
const makeClan: MakeClan = (persistence, ctxOf) => new ClanBackedStore(new ClanDocumentStore({ wasm, persistence, saveDebounceMs: 0 }), { ctxOf, debounceMs: 1 })

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise<void>((r) => setImmediate(r))
}

function setup(opts: { clock?: () => number } = {}) {
  const storage = memoryStorage()
  let t = Date.parse('2026-10-09T09:00:00Z')
  const now = () => new Date((t += 1000))
  const index = new ProjectIndex(storage, now)
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), session: { participantId: 'p_maya01', handle: 'maya', token: 't', expiresAt: '2099-01-01T00:00:00Z' } as AppUi['session'] }, null)
  const renderer: MockRenderer = { async render() { return [{ blob: new Blob([`pic-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 9, h: 16 }] } }
  let rt = 1_000_000
  const relay = new MockRelay({ renderer, now: opts.clock ?? (() => rt), delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, ownKeys: new OwnKeysStore(), makeClan, summaryDelayMs: 1 })
  return { storage, index, app, relay, shell, advance: (ms: number) => { rt += ms } }
}

const open = (shell: Shell) => {
  const s = shell.get().session
  if (!s) throw new Error('no project open')
  return s.services
}

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
    await updateDoc(s.doc, (d) => { d.assets.push({ sha256: pic, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] }) }, 'add picture')
    s.ui.update((u) => { u.scriptDraft = 'A guinea pig crosses the city.' })
    await storage.put(canvasKeyFor(p.id), { elements: [{ id: 'e1' }], files: {} })
    await shell.goHome()

    const copy = await shell.duplicate(p.id)
    expect(copy.name).toBe(`${UNTITLED} (copy)`)
    expect(index.get(copy.id)!.summary.pictures).toBe(1)
    await shell.open(copy.id)
    expect(open(shell).doc.get().assets.map((a) => a.sha256)).toEqual([pic])
    expect(open(shell).ui.get().scriptDraft).toBe('A guinea pig crosses the city.')
    expect(open(shell).project.usedElsewhere(pic)).toBe(true)
    // The copy changes on its own.
    await updateDoc(open(shell).doc, (d) => { d.assets = [] }, 'remove picture')
    await shell.goHome()
    await shell.open(p.id)
    expect(open(shell).doc.get().assets).toHaveLength(1)
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
    expect(sa.doc.get().stage.current).toBe('character')
    expect(sa.doc.get().participant).toEqual({ id: 'p_maya01', handle: 'maya' })
    await updateDoc(sa.doc, (d) => { d.keys.push({ key: 'maya', role: 'character' }) }, 'name maya')
    sa.ui.update((u) => { u.scriptDraft = 'Maya runs.'; u.targetS = 20; u.frameRegions = { frame_x: { x: 0, y: 0, w: 1, h: 1 } } })
    await storage.put(canvasKeyFor(a.id), { elements: [{ id: 'canvas-a' }], files: {} })
    expect(undoState(sa.doc).done).toHaveLength(1)

    const b = await shell.newProject()
    expect(shell.get().session!.id).toBe(b.id)
    const sb = open(shell)
    expect(sb.doc.get().keys).toEqual([])
    expect(sb.ui.get().scriptDraft).toBe('')
    expect(sb.ui.get().targetS).toBe(15)
    expect(sb.ui.get().frameRegions).toEqual({})
    expect(undoState(sb.doc).done).toEqual([])
    expect(shell.get().session!.initialCanvas).toBeNull()
    await updateDoc(sb.doc, (d) => { d.keys.push({ key: 'lamp', role: 'prop' }) }, 'name lamp')
    sb.ui.update((u) => { u.scriptDraft = 'A lamp glows.' })

    await shell.open(a.id)
    const sa2 = open(shell)
    expect(sa2.doc.get().keys.map((k) => k.key)).toEqual(['maya'])
    expect(sa2.ui.get().scriptDraft).toBe('Maya runs.')
    expect(sa2.ui.get().targetS).toBe(20)
    expect(shell.get().session!.initialCanvas).toEqual({ elements: [{ id: 'canvas-a' }], files: {} })
    // A's undo step came back with A, and undoes A's change only.
    expect(undoState(sa2.doc).done).toHaveLength(1)
    await undo(sa2.doc)
    expect(sa2.doc.get().keys).toEqual([])

    await shell.open(b.id)
    expect(open(shell).doc.get().keys.map((k) => k.key)).toEqual(['lamp'])
    expect(open(shell).ui.get().scriptDraft).toBe('A lamp glows.')
    // The app's part (who is signed in) is the same everywhere.
    expect(open(shell).ui.get().session?.handle).toBe('maya')
  })

  it('a job still running when you switch lands in its own project, the next time it is opened', async () => {
    const { shell, relay, advance } = setup()
    const a = await shell.newProject()
    const sa = open(shell)
    const jobId = await sa.runner.submit('generate', { text: 'a red fox' }, [], { for: 'canvas' })
    expect(sa.doc.get().jobs.map((j) => j.state)).toEqual(['queued'])

    const b = await shell.newProject()
    const sb = open(shell)
    advance(10_000)
    await relay.settled()
    await sb.runner.pollNow()
    await settle()
    expect(sb.doc.get().jobs).toEqual([])
    expect(sb.ui.get().jobCtx[jobId]).toBeUndefined()
    // The closed project's runner asks nothing more: the job waits in A's document.
    await sa.runner.pollNow()
    await settle()

    await shell.open(a.id)
    const back = open(shell)
    expect(back.doc.get().jobs.map((j) => j.id)).toEqual([jobId])
    expect(back.ui.get().jobCtx[jobId]?.for).toBe('canvas')
    await back.runner.pollNow()
    await relay.settled()
    await back.runner.pollNow()
    await settle()
    expect(back.doc.get().jobs[0].state).toBe('completed')
    expect(back.doc.get().assets).toHaveLength(1)

    await shell.open(b.id)
    expect(open(shell).doc.get().jobs).toEqual([])
    expect(open(shell).doc.get().assets).toEqual([])
  })

  it('a reload opens the project you were in; New project never overwrites one', async () => {
    const { shell, app, index, storage } = setup()
    const a = await shell.newProject()
    await updateDoc(open(shell).doc, (d) => { d.keys.push({ key: 'maya', role: 'character' }) }, 'name maya')
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
    expect(open(again).doc.get().keys.map((k) => k.key)).toEqual(['maya'])
  })
})

describe('naming', () => {
  it('stays Untitled until the script has a first line, then follows it, until renamed', async () => {
    const { shell, index } = setup()
    const p = await shell.newProject()
    const s = open(shell)
    expect(index.get(p.id)!.name).toBe(UNTITLED)
    const script = (text: string) => updateDoc(s.doc, (d) => {
      const rev = newId('rev')
      d.script = { current: rev, revisions: [...(d.script?.revisions ?? []), { id: rev, created_at: new Date().toISOString(), imported_text: text, target_s: 15, status: 'draft' }] }
    }, 'plan')
    await script('\n  A guinea pig takes on the city at rush hour.\nIt wins.')
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('A guinea pig takes on the city at rush hour.')
    await script('Rain on a quiet street.')
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('Rain on a quiet street.')
    await shell.rename(p.id, 'Rainy street, yellow umbrella')
    await script('Something else entirely.')
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('Rainy street, yellow umbrella')
    // Blank goes back to naming itself.
    await shell.rename(p.id, '  ')
    await shell.get().session!.record()
    expect(index.get(p.id)!.name).toBe('Something else entirely.')
  })

  it('cuts a long first line at a word', () => {
    const d = emptyDocument()
    d.script = { current: 'rev_1', revisions: [{ id: 'rev_1', created_at: '2026-10-09T09:00:00Z', imported_text: 'Our hero, a small guinea pig with enormous ambitions, crosses the busiest street in the whole city', target_s: 15, status: 'draft' }] }
    const n = autoName(d)!
    expect(n.length).toBeLessThanOrEqual(61)
    expect(n.endsWith('…')).toBe(true)
    expect(autoName(emptyDocument())).toBeNull()
  })
})

describe('what a card shows', () => {
  it('stage, counts, behind, the ad, and a picture', () => {
    const d = emptyDocument()
    expect(summarise(d)).toMatchObject({ stage: 'character', pictures: 0, shots: 0, behind: 0, adSeconds: null, active: 0 })
    const sha = (c: string) => `sha256:${c.repeat(64)}`
    d.assets.push({ sha256: sha('a'), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] })
    d.refs.push({ id: 'ref_1', key: 'maya', variant: 'front', asset: sha('a') })
    expect(summarise(d).thumb).toBe(sha('a'))
    d.stage.current = 'video'
    d.shots = [{ id: 'shot_1', order: 1, duration_s: 4, composition: 'wide', action: 'runs', camera_move: 'static', storyboard_frame: sha('b') } as never]
    d.stale = [{ target: { kind: 'take', id: 't1' }, caused_by: { kind: 'frame', id: 'f1' }, reason: 'x' }, { target: { kind: 'take', id: 't1' }, caused_by: { kind: 'frame', id: 'f2' }, reason: 'y' }]
    d.assets.push({ sha256: sha('c'), kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [], duration_s: 12.4 })
    d.exports = [{ id: 'exp_1', kind: 'ad_mp4', asset: sha('c'), created_at: '' }]
    const s = summarise(d)
    expect(s).toMatchObject({ stage: 'video', shots: 1, behind: 1, adSeconds: 12, thumb: sha('b') })
    expect(s.shas).toEqual([sha('a'), sha('c')])
  })

  it('says what is being made', async () => {
    const d = emptyDocument()
    d.shots = [{ id: 'shot_1', order: 1 } as never, { id: 'shot_2', order: 2 } as never]
    d.jobs.push({ id: 'job_1', op: 'clip', state: 'submitted', parent_ids: [], input_hashes: [], created_at: '' })
    const s = summarise(d, { job_1: { for: 'clip', shotId: 'shot_2', request: {} as never } })
    expect(s.active).toBe(1)
    expect(s.making).toBe('Dex is making the clip for shot 2')
  })
})

describe('the first load: the one project of before becomes the first in the list', () => {
  async function legacyProject(storage: ReturnType<typeof memoryStorage>) {
    const store = makeClan(storage.clan(LEGACY.clanDb), () => undefined)
    await store.create({ participant: { id: 'p_maya01', handle: 'maya' } })
    await updateDoc(store, (d) => {
      d.keys.push({ key: 'maya', role: 'character' })
      const rev = newId('rev')
      d.script = { current: rev, revisions: [{ id: rev, created_at: '2026-10-09T09:00:00Z', imported_text: 'Maya opens the shop.', target_s: 15, status: 'draft' }] }
    }, 'work')
    await store.flush()
    store.clan.dispose()
    await storage.put(LEGACY.canvas, { elements: [{ id: 'old-canvas' }], files: {} } as unknown as CanvasSnapshot)
    const ui: Partial<UiState> = { configChoice: 'remote', providerChoice: 'config', session: { participantId: 'p_maya01', handle: 'maya', token: 't', expiresAt: '2099-01-01T00:00:00Z' } as UiState['session'], scriptDraft: 'Maya opens the shop.', undo: { done: [{ label: 'name', ops: [], at: 1 } as never], undone: [] }, jobCtx: {} }
    await storage.put(LEGACY.ui, ui)
  }

  it('moves the document, canvas and UI into the first project, and loses nothing', async () => {
    const { storage, index, shell, app } = setup()
    await legacyProject(storage)
    const before = (await storage.clan(LEGACY.clanDb).read())!.bytes
    expect(await index.load()).toBe(false)
    const { id } = await migrateSingleProject(storage, index, makeClan)
    expect(id).toMatch(/^prj_/)
    const entry = index.get(id!) as ProjectEntry
    expect(entry).toMatchObject({ name: 'Maya opens the shop.', naming: 'auto' })
    // Moved: the .clan's bytes as they were, the canvas, the project's UI; the old places cleared.
    expect((await storage.clan(clanDbFor(id!)).read())!.bytes).toEqual(before)
    expect(await storage.clan(LEGACY.clanDb).read()).toBeNull()
    expect(await storage.get(canvasKeyFor(id!))).toEqual({ elements: [{ id: 'old-canvas' }], files: {} })
    expect(await storage.get(LEGACY.canvas)).toBeUndefined()
    expect(await storage.get(uiKeyFor(id!))).toMatchObject({ scriptDraft: 'Maya opens the shop.', undo: { done: [{ label: 'name' }] } })
    // The app's part stays under 'ui', without the project's.
    const appUi = await storage.get<Record<string, unknown>>(LEGACY.ui)
    expect(appUi).toMatchObject({ configChoice: 'remote', providerChoice: 'config', view: 'home' })
    expect(appUi).not.toHaveProperty('scriptDraft')
    expect(await storage.get(INDEX_KEY)).toBeDefined()

    // And it opens as it was.
    void app
    await shell.open(id!)
    const s = open(shell)
    expect(s.doc.get().keys.map((k) => k.key)).toEqual(['maya'])
    expect(s.ui.get().scriptDraft).toBe('Maya opens the shop.')
    expect(shell.get().session!.initialCanvas).toEqual({ elements: [{ id: 'old-canvas' }], files: {} })
  })

  it('carries nothing over from a first visit that never did anything, and runs once', async () => {
    const { storage, index } = setup()
    const store = makeClan(storage.clan(LEGACY.clanDb), () => undefined)
    await store.create({ participant: { id: 'p_local', handle: 'guest' } })
    await store.flush()
    store.clan.dispose()
    const { id } = await migrateSingleProject(storage, index, makeClan)
    expect(id).toBeNull()
    expect(index.all()).toEqual([])
    expect(await storage.get(INDEX_KEY)).toEqual({ version: 1, projects: [] })
    expect([...storage.clans.keys()].filter((k) => k !== LEGACY.clanDb && storage.clans.get(k)!.last)).toEqual([])
    // With the index written, the next load reads it and migrates nothing.
    expect(await new ProjectIndex(storage).load()).toBe(true)
  })

  it('keeps a document that only has a canvas', async () => {
    const { storage, index } = setup()
    const store = makeClan(storage.clan(LEGACY.clanDb), () => undefined)
    await store.create({ participant: { id: 'p_local', handle: 'guest' } })
    await store.flush()
    store.clan.dispose()
    await storage.put(LEGACY.canvas, { elements: [{ id: 'a drawing' }], files: {} })
    const { id } = await migrateSingleProject(storage, index, makeClan)
    expect(id).not.toBeNull()
    expect(index.get(id!)!.name).toBe(UNTITLED)
  })
})

describe('Open a file', () => {
  async function projectWithWork(shell: Shell, storage: ReturnType<typeof memoryStorage>) {
    const p = await shell.newProject()
    const s = open(shell)
    const pic = await putBlob(new Blob([`picture ${Math.random()}`], { type: 'image/png' }))
    await updateDoc(s.doc, (d) => {
      d.assets.push({ sha256: pic, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] })
      d.keys.push({ key: 'maya', role: 'character' })
      d.refs.push({ id: newId('ref'), key: 'maya', variant: 'front', asset: pic })
      const rev = newId('rev')
      d.script = { current: rev, revisions: [{ id: rev, created_at: '2026-10-09T09:00:00Z', imported_text: 'Maya and the lamp.', target_s: 15, status: 'draft' }] }
    }, 'work')
    await storage.put(canvasKeyFor(p.id), { elements: [{ id: 'node-1', type: 'image' }], files: {} })
    await shell.goHome()
    return { p, pic }
  }

  it('an Export zip becomes a new project with its pictures and canvas', async () => {
    const { shell, storage, index } = setup()
    const { p, pic } = await projectWithWork(shell, storage)
    const { blob, name } = await shell.exportProject(p.id)
    expect(name).toBe('napkin-maya-and-the-lamp-production.zip')
    expect(Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))).toEqual(expect.arrayContaining(['maya.clan', 'canvas.excalidraw']))

    const entry = await shell.openFile(blob, name)
    expect(entry.id).not.toBe(p.id)
    expect(index.all()).toHaveLength(2)
    expect(entry.name).toBe('Maya and the lamp.')
    expect(shell.get().session!.id).toBe(entry.id)
    const s = open(shell)
    expect(s.doc.get().refs.map((r) => r.asset)).toEqual([pic])
    expect(s.doc.get().keys.map((k) => k.key)).toEqual(['maya'])
    expect(await getBlob(pic)).toBeDefined()
    expect(shell.get().session!.initialCanvas?.elements).toEqual([expect.objectContaining({ id: 'node-1' })])
  })

  it('puts the pictures back from the zip, checked against their hash', async () => {
    const { shell, storage } = setup()
    const bytes = strToU8(`only in the zip ${Math.random()}`)
    const pic = await putBlob(new Blob([bytes as BlobPart], { type: 'image/png' }))
    const { p } = await projectWithWork(shell, storage)
    await shell.open(p.id)
    await updateDoc(open(shell).doc, (d) => { d.assets.push({ sha256: pic, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] }) }, 'add')
    const clan = await (open(shell).doc as ClanBackedStore).exportClan()
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
    const clan = await (open(shell).doc as ClanBackedStore).exportClan()
    await shell.goHome()
    const entry = await shell.openFile(new Blob([clan as BlobPart]), 'maya.clan')
    expect(open(shell).doc.get().keys.map((k) => k.key)).toEqual(['maya'])
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
    sa.ui.update((u) => { u.scriptDraft = 'late' })
    await systemUpdate(sa.doc, (d) => { d.keys.push({ key: 'late', role: 'prop' }) }, 'late')
    expect(open(shell).ui.get().scriptDraft).toBe('')
    expect(open(shell).doc.get().keys).toEqual([])
    await settle()
    expect((await storage.get<{ scriptDraft: string }>(uiKeyFor(a.id)))?.scriptDraft ?? '').toBe('')
    await shell.open(a.id)
    expect(open(shell).doc.get().keys).toEqual([])
  })
})
