// Personal workspaces (features/personal-workspaces.clan): Home lists the relay's projects with this
// browser's; opening one from another browser brings its .clan, canvas and every picture; a save
// someone else got in before is never an overwrite, and the person chooses; sign-in says welcome back.
// On the real .clan engine (napkin-wasm), against a fake relay that keeps the relay's rules.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@excalidraw/excalidraw', () => ({ serializeAsJSON: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import type { DocAsset, ProductionDocument, SavedProject } from '../contracts/types'
import { ClanBackedStore } from '../doc/clan'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { OwnKeysStore } from '../keys/ownKeys'
import { deleteBlob, getBlob, putBlob } from '../lib/blobs'
import { hexOf, sha256Hex } from '../lib/hash'
import { newId } from '../lib/ulid'
import { MockRelay, type MockRenderer } from '../relay/mock'
import type { Relay } from '../relay'
import { homeItems, welcomeBack } from './homeList'
import { emptySummary, ProjectIndex, type ProjectEntry } from './projectIndex'
import { ProjectServer, SaveConflict } from './server'
import { describeAsset, forgetSent, MissingPictures } from './serverAssets'
import type { MakeClan } from './session'
import { Shell } from './shell'
import { canvasKeyFor, clanDbFor, memoryStorage } from './storage'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))
const makeClan: MakeClan = (persistence, ctxOf) => new ClanBackedStore(new ClanDocumentStore({ wasm, persistence, saveDebounceMs: 0 }), { ctxOf, debounceMs: 1 })

const CDN = 'https://cdn.test'

/** The relay's project routes, kept the relay's way (relay/projects.py): one workspace per token. */
class FakeRelay {
  t = Date.parse('2026-10-10T10:00:00Z')
  projects = new Map<string, { row: SavedProject; bytes: Uint8Array; canvas?: unknown[] }>()
  uploads = new Map<string, Uint8Array>()
  saves: { id: string; ifMatch: string | null; name: string | null }[] = []
  failUploads = false

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const h = new Headers(init.headers)
    if (url.startsWith(`${CDN}/in/`)) {
      const got = this.uploads.get(url.slice(`${CDN}/in/`.length))
      return got ? new Response(got.slice()) : new Response('', { status: 404 })
    }
    const path = url.replace(/^\/api/, '')
    if (h.get('Authorization') !== 'Bearer t') return this.json(401, { error: { code: 'unauthorised', message: 'Sign in again.', retryable: false } })
    if (method === 'GET' && path === '/projects') {
      return this.json(200, { projects: [...this.projects.values()].map((p) => p.row).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) })
    }
    if (method === 'POST' && path === '/uploads') {
      const req = JSON.parse(String(init.body)) as { sha256: string }
      return this.json(200, this.uploads.has(req.sha256) ? { exists: true, url: `${CDN}/in/${req.sha256}` } : { exists: false, putUrl: 'x', url: `${CDN}/in/${req.sha256}` })
    }
    if (method === 'POST' && path === '/clan') {
      const id = h.get('X-Project-Id')!
      const bytes = new Uint8Array(init.body as Uint8Array)
      const ifMatch = h.get('If-Match')?.replace(/"/g, '') ?? null
      const name = h.get('X-Project-Name') ? decodeURIComponent(h.get('X-Project-Name')!) : null
      this.saves.push({ id, ifMatch, name })
      const old = this.projects.get(id)
      if (ifMatch && old && old.row.etag !== ifMatch) {
        return this.json(409, { error: { code: 'conflict', message: `This project was saved from somewhere else at ${old.row.savedAt} since you opened it.`, retryable: false } })
      }
      this.t += 60_000
      const row: SavedProject = { id, savedAt: new Date(this.t).toISOString().replace(/\.\d+Z$/, 'Z'), bytes: bytes.length, etag: await sha256Hex(bytes), ...(name ?? old?.row.name ? { name: name ?? old?.row.name } : {}) }
      this.projects.set(id, { row, bytes, canvas: old?.canvas })
      return this.json(200, { project: row })
    }
    const m = /^\/clan\/([^/]+)(\/canvas)?$/.exec(path)
    const p = m && this.projects.get(m[1])
    if (!p) return this.json(404, { error: { code: 'invalid_input', message: 'That project is not saved on the server.', retryable: false } })
    if (m[2] && method === 'PUT') {
      p.canvas = (JSON.parse(String(init.body)) as { elements: unknown[] }).elements
      return new Response(null, { status: 204 })
    }
    if (m[2]) return p.canvas ? this.json(200, { elements: p.canvas, savedAt: p.row.savedAt }) : this.json(404, { error: { code: 'invalid_input', message: 'none', retryable: false } })
    return new Response(p.bytes.slice(), { status: 200, headers: { ETag: `"${p.row.etag}"`, 'X-Saved-At': p.row.savedAt } })
  }

  /** What the browser's relay.upload does: POST /uploads, then PUT the bytes. */
  upload = async (blob: Blob) => {
    if (this.failUploads) throw new Error('upload failed')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    this.uploads.set(`sha256:${await sha256Hex(bytes)}`, bytes)
    return {}
  }

  private json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
}

/** One browser: its own storage and index, signed in as Maya, with the relay behind it. */
function browser(fake: FakeRelay) {
  const storage = memoryStorage()
  let t = Date.parse('2026-10-10T09:00:00Z')
  const index = new ProjectIndex(storage, () => new Date((t += 1000)))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), session: { participantId: 'p_maya01', handle: 'maya', token: 't', expiresAt: '2099-01-01T00:00:00Z' } as AppUi['session'] }, null)
  const renderer: MockRenderer = { async render() { return [] } }
  const mock = new MockRelay({ renderer, now: () => 0, delayMs: 10, persistKey: null })
  // The real relay over HTTP, as far as saving is concerned.
  const relay = Object.assign(Object.create(mock) as Relay, { kind: 'http' as const, upload: fake.upload })
  const server = new ProjectServer({ base: '/api', token: () => app.get().session?.token ?? null, fetchFn: fake.fetch as typeof fetch })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, ownKeys: new OwnKeysStore(), makeClan, summaryDelayMs: 1, server })
  return { storage, index, shell, app }
}

const services = (shell: Shell) => shell.get().session!.services

async function picture(text: string): Promise<DocAsset> {
  const sha = await putBlob(new Blob([text], { type: 'image/png' }))
  return { sha256: sha, kind: 'image', mime: 'image/png', origin: 'uploaded', bytes: text.length, locations: [] }
}

/** Maya's project in the first browser: a named picture, a frame on the server already, a canvas. Saved. */
async function made(fake: FakeRelay) {
  const laptop = browser(fake)
  const p = await laptop.shell.newProject()
  const s = services(laptop.shell)
  const front = await picture(`maya front ${Math.random()}`)
  const frame = await picture(`frame ${Math.random()}`)
  const frameBytes = new Uint8Array(await (await getBlob(frame.sha256))!.arrayBuffer())
  fake.uploads.set(frame.sha256, frameBytes)
  const shotId = newId('shot')
  await updateDoc(s.doc, (d) => {
    d.assets.push(front, { ...frame, origin: 'generated', locations: [`${CDN}/in/${frame.sha256}`] })
    d.refs.push({ id: newId('ref'), key: 'maya', variant: 'front', asset: front.sha256 })
    d.shots = [{ id: shotId, order: 1, duration_s: 3, composition: 'wide', action: 'Maya waves.', camera_move: 'static' }]
    d.frames = [{ id: newId('frame'), shot_id: shotId, asset: frame.sha256, job_id: newId('job'), selected: true, kind: 'generated' }]
  }, 'add pictures')
  await laptop.storage.put(canvasKeyFor(p.id), { elements: [{ id: 'el1', type: 'image', fileId: 'abc' }], files: { abc: { dataURL: 'data:,' } } })
  await laptop.shell.rename(p.id, 'Maya waves')
  await s.clan!.flush()
  await s.clan!.clan.mirrorNow('manual')
  return { laptop, p, front, frame }
}

describe('Home lists the relay\'s projects with this browser\'s', () => {
  const entry = (id: string, updated: string, server?: ProjectEntry['server']): ProjectEntry =>
    ({ id, name: id, naming: 'person', created: updated, updated, summary: emptySummary(), ...(server ? { server } : {}) })
  const row = (id: string, savedAt: string, etag = 'e'): SavedProject => ({ id, savedAt, bytes: 1, etag, name: `${id} there` })

  it('one card per project, newest first, saying which are only on the server', () => {
    const local = [entry('prj_a', '2026-10-10T09:00:00.000Z', { etag: 'e', savedAt: '2026-10-10T09:00:00Z' }), entry('prj_b', '2026-10-10T08:00:00.000Z')]
    const server = [row('prj_a', '2026-10-10T09:00:00Z'), row('prj_c', '2026-10-10T10:00:00Z'), row('prj_b', '2026-10-10T11:00:00Z', 'newer')]
    const items = homeItems(local, server)
    expect(items.map((i) => [i.kind, i.kind === 'local' ? i.p.id : i.row.id])).toEqual([['local', 'prj_b'], ['server', 'prj_c'], ['local', 'prj_a']])
    const b = items[0]
    expect(b.kind === 'local' && b.newerThere).toBe(true) // saved elsewhere since: Home says so
    const a = items[2]
    expect(a.kind === 'local' && !a.newerThere && a.server?.id).toBe('prj_a')
    expect(homeItems(local, server, 'name').map((i) => (i.kind === 'local' ? i.p.name : i.name))).toEqual(['prj_a', 'prj_b', 'prj_c there'])
    expect(homeItems(local, server, 'recent', 'there').map((i) => i.kind)).toEqual(['server'])
  })

  it('says welcome back when the name already has saved work', () => {
    expect(welcomeBack('Maya', 3)).toBe('Welcome back, Maya: 3 projects')
    expect(welcomeBack('Maya', 1)).toBe('Welcome back, Maya: 1 project')
    expect(welcomeBack('Maya', 0)).toBeNull()
  })
})

describe('a project saved in one browser opens in another', () => {
  it('saves with its name and pictures, and the other browser lists and opens it with every picture and its canvas', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { p, front, frame } = await made(fake)
    // The save sent the picture the relay could not reach (the frame it had already), and the name.
    expect(fake.uploads.has(front.sha256)).toBe(true)
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: null, name: 'Maya waves' })
    expect(fake.projects.get(p.id)!.canvas).toEqual([{ id: 'el1', type: 'image', fileId: 'abc' }])

    // The desktop: nothing of it in this browser.
    await deleteBlob(front.sha256)
    await deleteBlob(frame.sha256)
    const desktop = browser(fake)
    const listed = await desktop.shell.serverProjects()
    expect(listed.map((r) => [r.id, r.name])).toEqual([[p.id, 'Maya waves']])
    await desktop.shell.openFromServer(listed[0])
    const s = services(desktop.shell)
    expect(s.project.id).toBe(p.id) // the same project: its saves stay one project
    expect(s.doc.get().refs.map((r) => `${r.key}_${r.variant}`)).toEqual(['maya_front'])
    expect(await getBlob(front.sha256)).toBeDefined()
    expect(await getBlob(frame.sha256)).toBeDefined()
    expect(desktop.shell.get().session!.initialCanvas).toEqual({ elements: [{ id: 'el1', type: 'image', fileId: 'abc' }], files: {} })
    const e = desktop.index.get(p.id)!
    expect(e.name).toBe('Maya waves')
    expect(e.server).toEqual({ etag: fake.projects.get(p.id)!.row.etag, savedAt: fake.projects.get(p.id)!.row.savedAt })
  })

  it('names the picture it could not download, and keeps nothing half-made', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { p, front } = await made(fake)
    fake.uploads.delete(front.sha256) // never reached the relay
    await deleteBlob(front.sha256)
    const desktop = browser(fake)
    const err = await desktop.shell.openFromServer({ id: p.id, name: 'Maya waves' }).catch((x: unknown) => x)
    expect(err).toBeInstanceOf(MissingPictures)
    expect((err as Error).message).toContain('@maya_front')
    expect(desktop.index.get(p.id)).toBeUndefined()
    expect(desktop.storage.clans.has(clanDbFor(p.id))).toBe(false)
    expect(desktop.shell.get().session).toBeNull()
  })

  it('a picture whose bytes do not match its hash counts as missing', async () => {
    const doc = { refs: [], shots: [], frames: [], takes: [], exports: [] } as unknown as ProductionDocument
    const a: DocAsset = { sha256: `sha256:${'0'.repeat(64)}`, kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [`${CDN}/out/x`] }
    expect(describeAsset(doc, a)).toBe('a clip (00000000)')
    const { fetchAssets } = await import('./serverAssets')
    const err = await fetchAssets({ ...doc, assets: [a] }, { where: async () => null, download: async () => new TextEncoder().encode('not it') }).catch((x: unknown) => x)
    expect(err).toBeInstanceOf(MissingPictures)
  })
})

describe('a save from somewhere else is never overwritten', () => {
  async function twoBrowsers() {
    forgetSent()
    const fake = new FakeRelay()
    const { laptop, p } = await made(fake)
    const desktop = browser(fake)
    await desktop.shell.openFromServer({ id: p.id })
    // The desktop changes it and saves: the laptop's copy is now behind.
    await updateDoc(services(desktop.shell).doc, (d) => { d.keys.push({ key: 'lamp', role: 'prop' }) }, 'name lamp')
    await services(desktop.shell).clan!.flush()
    await services(desktop.shell).clan!.clan.mirrorNow('manual')
    const theirs = fake.projects.get(p.id)!.row
    // The laptop changes it too, and saves on top of the copy it had.
    await updateDoc(services(laptop.shell).doc, (d) => { d.keys.push({ key: 'kite', role: 'prop' }) }, 'name kite')
    await services(laptop.shell).clan!.flush()
    const err = await services(laptop.shell).clan!.clan.mirrorNow('manual').catch((x: unknown) => x)
    return { fake, laptop, desktop, p, theirs, err }
  }

  it('sends If-Match, and a stale one stops the save and asks', async () => {
    const { fake, laptop, p, theirs, err } = await twoBrowsers()
    expect(err).toBeInstanceOf(SaveConflict)
    expect(fake.projects.get(p.id)!.row.etag).toBe(theirs.etag) // theirs is still the project
    expect(fake.saves.at(-1)!.ifMatch).toBe(laptop.index.get(p.id)!.server!.etag)
    const copy = services(laptop.shell).serverCopy!
    expect(copy.get()?.message).toContain('saved from somewhere else')
    // Until the person chooses, no save goes (the 5-minute one included).
    const before = fake.saves.length
    await expect(copy.post(new Uint8Array([80, 75, 3, 4]), { reason: 'interval' })).rejects.toBeInstanceOf(SaveConflict)
    expect(fake.saves.length).toBe(before)
  })

  it('keep theirs as a copy: theirs becomes a project of its own, and this one saves on top', async () => {
    const { fake, laptop, p, theirs } = await twoBrowsers()
    const copy = await laptop.shell.keepTheirsAsCopy()
    expect(copy.name).toBe('Maya waves (copy)')
    expect(copy.id).not.toBe(p.id)
    expect(fake.projects.get(copy.id)!.row.etag).toBe(theirs.etag) // exactly their save
    expect(fake.projects.get(copy.id)!.canvas).toEqual([{ id: 'el1', type: 'image', fileId: 'abc' }])
    expect(laptop.index.get(copy.id)!.server!.etag).toBe(theirs.etag)
    // Theirs, as a copy, is on the relay too, with the canvas; mine is the project now, saved over theirs knowingly.
    expect(fake.saves.find((s) => s.id === copy.id)).toMatchObject({ ifMatch: null, name: 'Maya waves (copy)' })
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: theirs.etag })
    expect(fake.projects.get(p.id)!.row.etag).not.toBe(theirs.etag)
    expect(services(laptop.shell).serverCopy!.get()).toBeNull()
    expect(services(laptop.shell).doc.get().keys.map((k) => k.key)).toContain('kite')
  })

  it('save this as a new version: it goes on top of theirs, which stays among the earlier saves', async () => {
    const { fake, laptop, p, theirs } = await twoBrowsers()
    await laptop.shell.saveAsNewVersion()
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: theirs.etag })
    expect(fake.projects.get(p.id)!.row.etag).not.toBe(theirs.etag)
    expect(services(laptop.shell).serverCopy!.get()).toBeNull()
    expect(laptop.index.get(p.id)!.server!.etag).toBe(fake.projects.get(p.id)!.row.etag)
  })

  it('a save with nothing in between goes through with If-Match', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { laptop, p } = await made(fake)
    const first = fake.projects.get(p.id)!.row.etag
    await updateDoc(services(laptop.shell).doc, (d) => { d.keys.push({ key: 'kite', role: 'prop' }) }, 'name kite')
    await services(laptop.shell).clan!.flush()
    await services(laptop.shell).clan!.clan.mirrorNow('manual')
    expect(fake.saves.at(-1)).toMatchObject({ ifMatch: first })
    expect(fake.projects.get(p.id)!.row.etag).not.toBe(first)
  })
})

describe('the relay client', () => {
  it('sends If-Match quoted and the name percent-encoded, and reads the ETag back', async () => {
    const seen: Headers[] = []
    const fake = new FakeRelay()
    const fetchFn = (async (u: RequestInfo | URL, i?: RequestInit) => {
      seen.push(new Headers(i?.headers))
      return fake.fetch(u, i)
    }) as typeof fetch
    const server = new ProjectServer({ base: '/api/', token: () => 't', fetchFn })
    const saved = await server.save('prj_x', new Uint8Array([80, 75, 3, 4]), { reason: 'manual', ifMatch: 'abc', name: 'Café ad' })
    expect(seen[0].get('If-Match')).toBe('"abc"')
    expect(seen[0].get('X-Project-Name')).toBe('Caf%C3%A9%20ad')
    expect(saved.name).toBe('Café ad')
    const opened = await server.open('prj_x')
    expect(opened.etag).toBe(saved.etag)
    expect(hexOf(`sha256:${opened.etag}`)).toBe(await sha256Hex(opened.bytes))
    expect(await server.canvas('prj_x')).toBeNull()
    await expect(new ProjectServer({ base: '/api', token: () => null, fetchFn }).list()).rejects.toThrow('Sign in again.')
  })
})
