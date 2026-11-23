// Personal workspaces (features/personal-workspaces.clan): Home lists the relay's projects with this
// browser's; opening one from another browser brings its .clan, canvas and every picture; a save
// someone else got in before is never an overwrite, and the person chooses.
// On the real .clan engine (napkin-wasm), against a fake relay that keeps the relay's rules.

import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import type { DocAsset, ProductionDocument, SavedProject } from '../contracts/types'
import { SnapshotStore, updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { initialAppUi, type AppUi } from '../doc/ui'
import { deleteBlob, getBlob, putBlob } from '../lib/blobs'
import { hexOf, sha256Hex } from '../lib/hash'
import { forgetMedia, setMediaBase } from '../lib/media'
import { mainStoryboard } from '../model/selectors'
import { ModelStore } from '../model/store'
import { MockRelay, type MockRenderer } from '../relay/mock'
import type { Relay } from '../relay'
import { homeItems } from './homeList'
import { emptySummary, ProjectIndex, type ProjectEntry } from './projectIndex'
import { ProjectServer, SaveConflict } from './server'
import { describeAsset, forgetSent, MissingPictures } from './serverAssets'
import type { MakeClan } from './session'
import { Shell } from './shell'
import { clanDbFor, memoryStorage } from './storage'
import { id, MAYA, seedStages, wasm } from '../test/model'

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const nameKey = (store: DocumentStore, key: string) => updateDoc(store, (d) => {
  const k = id('key')
  d.keys[k] = { id: k, v: 1, field_v: {}, key, role: 'prop' }
}, `name ${key}`)

const CDN = 'https://cdn.test'

/** Napkin OS's library routes, kept the host's way (docs/contracts/production-clan-app.md section 2): one library per
 *  tenant, a document's version is the sha256 of its bytes, a save needs If-Match and is refused with `latest` when
 *  the document moved. The pictures sit on the relay's in/ (the media base); `uploads` is what it holds. */
class FakeRelay {
  t = Date.parse('2026-10-10T10:00:00Z')
  projects = new Map<string, { row: SavedProject; bytes: Uint8Array; trashed?: string }>()
  uploads = new Map<string, Uint8Array>()
  saves: { id: string; ifMatch: string | null; reason: string | null }[] = []
  failUploads = false
  /** A save lands, and its answer never reaches the browser (the page was closed as it went: UAT U7). */
  loseAnswers = false
  /** Nothing reaches the host. */
  offline = false
  /** The session cookie is good; off, every route is 401. */
  identity = true
  n = 0
  /** Every address asked for (the pictures), to see that none comes from a document. */
  asked: string[] = []

  private stamp() { this.t += 60_000; return new Date(this.t).toISOString().replace(/\.\d+Z$/, '.000Z') }

  async make(bytes: Uint8Array, id: string, name?: string) {
    // The library lists the manifest's title, as the host reads it.
    try { name = /^title: (.+)$/m.exec(new TextDecoder().decode(unzipSync(bytes)['manifest.yaml']))?.[1]?.replace(/^['"]|['"]$/g, '') ?? name } catch { /* not a .clan */ }
    const row: SavedProject = { id, savedAt: this.stamp(), bytes: bytes.length, etag: await sha256Hex(bytes), ...(name ? { name } : {}) }
    this.projects.set(id, { row, bytes })
    return row
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const h = new Headers(init.headers)
    if (url.startsWith(`${CDN}/`)) {
      this.asked.push(url)
      const got = url.startsWith(`${CDN}/in/`) ? this.uploads.get(url.slice(`${CDN}/in/`.length)) : undefined
      return got ? new Response(got.slice()) : new Response('', { status: 404 })
    }
    if (this.offline) throw new TypeError('Failed to fetch')
    if (!this.identity) return this.json(401, { error: 'Sign in again.' })
    if (url === '/relay/uploads') {
      const req = JSON.parse(String(init.body)) as { sha256: string }
      return this.json(200, this.uploads.has(req.sha256) ? { exists: true, url: `${CDN}/in/${req.sha256}` } : { exists: false, putUrl: 'x', url: `${CDN}/in/${req.sha256}` })
    }
    const path = url.replace(/^\/api/, '')
    if (path === '/session') return this.json(200, { tenant: 't1', media_base: CDN })
    if (method === 'GET' && path === '/t/t1/library') {
      const items = [...this.projects.values()].filter((p) => !p.trashed).map((p) => ({ path: p.row.id, title: p.row.name ?? p.row.id, app_id: 'ie.napkin.production', updated_at: p.row.savedAt, client: null }))
      return this.json(200, { items, clients_unassigned: 0 })
    }
    if (method === 'POST' && path === '/t/t1/documents') {
      const id = `doc-${++this.n}`
      const title = (JSON.parse(String(init.body)) as { title: string }).title
      await this.make(await blankProject(title), id, title)
      return this.json(200, { path: id })
    }
    if (method === 'POST' && path === '/t/t1/documents/upload') {
      const id = `upload-${++this.n}`
      await this.make(new Uint8Array(init.body as Uint8Array), id)
      return this.json(200, { path: id })
    }
    const m = /^\/t\/t1\/d\/([^/]+)(\/download|\/save)?$/.exec(path)
    const p = m && this.projects.get(m[1])
    if (!m || !p || p.trashed) return this.json(404, { error: 'not found' })
    if (!m[2] && method === 'DELETE') {
      p.trashed = this.stamp()
      return this.json(200, { trashed: true, restorable_until: new Date(this.t + 30 * 864e5).toISOString() })
    }
    if (m[2] === '/download') {
      const meta = { ETag: `"sha256:${p.row.etag}"`, 'X-Saved-At': p.row.savedAt }
      return new Response(method === 'HEAD' ? null : p.bytes.slice(), { status: 200, headers: meta })
    }
    if (m[2] === '/save' && method === 'PUT') {
      const bytes = new Uint8Array(init.body as Uint8Array)
      const ifMatch = h.get('If-Match')?.replace(/"/g, '').replace(/^sha256:/, '') ?? null
      this.saves.push({ id: m[1], ifMatch, reason: h.get('X-Clan-Reason') })
      if (!ifMatch) return this.json(428, { error: 'If-Match is required' })
      if (p.row.etag !== ifMatch) {
        return this.json(409, { error: { code: 'conflict', message: 'This project was saved from somewhere else since you opened it.' }, latest: `sha256:${p.row.etag}` })
      }
      const row = await this.make(bytes, m[1], p.row.name)
      if (this.loseAnswers) throw new TypeError('Failed to fetch')
      return this.json(200, { version: `sha256:${row.etag}`, saved_at: row.savedAt, snapshot: false })
    }
    return this.json(404, { error: 'not found' })
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

/** The bytes a host makes for POST /documents: a project in the library (the real one hands over the app's blank
 *  instance, which the tool starts: clan-store/test/blank-instance.test.ts). */
async function blankProject(title: string): Promise<Uint8Array> {
  const store = new ClanDocumentStore({ wasm: wasm(), persistence: memoryStorage().clan('blank'), saveDebounceMs: 0, person: MAYA })
  await store.create({ person: MAYA, title, blank: true })
  const bytes = await store.exportClan()
  store.dispose()
  return bytes
}

/** One browser: its own storage and index, signed in as Maya, with the relay behind it. */
function browser(fake: FakeRelay) {
  const storage = memoryStorage()
  let t = Date.parse('2026-10-10T09:00:00Z')
  const index = new ProjectIndex(storage, () => new Date((t += 1000)))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google'] }, quotas: null, projects: 0 } }, null)
  const renderer: MockRenderer = { async render() { return [] } }
  const mock = new MockRelay({ renderer, now: () => 0, delayMs: 10, persistKey: null })
  // The real relay over HTTP, as far as saving is concerned.
  const relay = Object.assign(Object.create(mock) as Relay, { kind: 'http' as const, upload: fake.upload })
  const server = new ProjectServer({ base: '/relay', host: '/api', signedIn: () => !!app.get().me, fetchFn: fake.fetch as typeof fetch })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1, server })
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
  await seedStages(s.doc) // a new project is blank (owner 2026-11-03); this fixture works on the stages
  const front = await picture(`maya front ${Math.random()}`)
  const frame = await picture(`frame ${Math.random()}`)
  const frameBytes = new Uint8Array(await (await getBlob(frame.sha256))!.arrayBuffer())
  fake.uploads.set(frame.sha256, frameBytes)
  const shotId = id('shot')
  const frameId = id('frame')
  const refId = id('ref')
  await updateDoc(s.doc, (d) => {
    d.assets[front.sha256] = front
    d.assets[frame.sha256] = { ...frame, origin: 'generated' }
    d.refs[refId] = { id: refId, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: front.sha256 }
    d.shots[shotId] = { id: shotId, v: 1, field_v: {}, storyboard_id: mainStoryboard(d)!.id, rank: 'a0', kind: 'shot', duration_s: 3, camera: { size: 'wide' }, status: 'planned', action: 'Maya waves.', pick: { current: frameId } }
    d.frames[frameId] = { id: frameId, v: 1, field_v: {}, shot_id: shotId, version: 1, kind: 'generated', asset: frame.sha256, crew: 'wren' }
  }, 'add pictures')
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
})

describe('a project saved in one browser opens in another', () => {
  it('saves with its name and pictures, and the other browser lists and opens it with every picture', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { p, front, frame } = await made(fake)
    // The save sent the picture the relay could not reach (the frame it had already), on the version the library made.
    expect(fake.uploads.has(front.sha256)).toBe(true)
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, reason: 'manual' })
    expect(fake.saves.at(-1)!.ifMatch).toBeTruthy()

    // The desktop: nothing of it in this browser.
    await deleteBlob(front.sha256)
    await deleteBlob(frame.sha256)
    const desktop = browser(fake)
    const listed = await desktop.shell.serverProjects()
    expect(listed.map((r) => [r.id, r.name])).toEqual([[p.id, 'Maya waves']])
    await desktop.shell.openFromServer(listed[0])
    const s = services(desktop.shell)
    expect(s.project.id).toBe(p.id) // the same project: its saves stay one project
    expect(Object.values(s.doc.get().refs).map((r) => `${r.key}_${r.variant}`)).toEqual(['maya_front'])
    expect(await getBlob(front.sha256)).toBeDefined()
    expect(await getBlob(frame.sha256)).toBeDefined()
    const e = desktop.index.get(p.id)!
    expect(e.name).toBe('Maya waves')
    expect(e.server).toEqual({ etag: fake.projects.get(p.id)!.row.etag, savedAt: fake.projects.get(p.id)!.row.savedAt })
    // Never a draft: a blank canvas opened after it, All projects and the tidy at boot leave it, nodes and all
    // (re-test 2026-11-19).
    expect(e.draft).toBeUndefined()
    await desktop.shell.newProject()
    await desktop.shell.goHome()
    await desktop.shell.pruneDrafts()
    expect(desktop.index.all().map((x) => x.id)).toEqual([p.id])
    await desktop.shell.open(p.id)
  })

  it('sends a picture whose location is another relay\'s: an opened Export has every picture on the relay it was opened in', async () => {
    forgetSent()
    const { sendAssets } = await import('./serverAssets')
    const own = await picture(`export own ${Math.random()}`)
    const foreign = { ...(await picture(`export foreign ${Math.random()}`)), origin: 'generated' as const, locations: ['https://other-relay.test/in/x'] }
    const doc = { assets: { [own.sha256]: own, [foreign.sha256]: foreign } } as unknown as ProductionDocument
    const sent: string[] = []
    const n = await sendAssets(doc, async (blob) => { sent.push(await sha256Hex(new Uint8Array(await blob.arrayBuffer()))) })
    expect(n).toBe(2)
    expect(sent.sort()).toEqual([hexOf(own.sha256), hexOf(foreign.sha256)].sort())
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
    const doc = { refs: {}, shots: {}, frames: {}, takes: {}, renders: {}, exports: {}, assets: {} } as unknown as ProductionDocument
    const a: DocAsset = { sha256: `sha256:${'0'.repeat(64)}`, kind: 'video', mime: 'video/mp4', origin: 'generated' }
    expect(describeAsset(doc, a)).toBe('a clip (00000000)')
    const { fetchAssets } = await import('./serverAssets')
    const err = await fetchAssets({ ...doc, assets: { [a.sha256]: a } }, { where: async () => null, download: async () => new TextEncoder().encode('not it') }).catch((x: unknown) => x)
    expect(err).toBeInstanceOf(MissingPictures)
  })
})

describe('a fresh browser brings the pictures down', () => {
  it('several at once, never more than FETCH_AT_ONCE, and every one is kept', async () => {
    const { fetchAssets, FETCH_AT_ONCE } = await import('./serverAssets')
    const pics = await Promise.all(Array.from({ length: 14 }, async (_, i) => {
      const bytes = new TextEncoder().encode(`picture ${i} ${Math.random()}`)
      const hex = await sha256Hex(bytes)
      return { bytes, a: { sha256: `sha256:${hex}`, kind: 'image', mime: 'image/png', origin: 'generated' } as DocAsset }
    }))
    setMediaBase(CDN)
    const byUrl = new Map(pics.map((p) => [`${CDN}/out/${p.a.sha256}`, p.bytes]))
    let now = 0
    let most = 0
    const server = {
      where: async () => null,
      download: async (url: string) => {
        now++
        most = Math.max(most, now)
        await new Promise((r) => setTimeout(r, 5))
        now--
        return byUrl.get(url) ?? null
      },
    }
    const doc = { refs: {}, shots: {}, frames: {}, takes: {}, renders: {}, exports: {}, assets: Object.fromEntries(pics.map((p) => [p.a.sha256, p.a])) } as unknown as ProductionDocument
    expect(await fetchAssets(doc, server)).toBe(14)
    expect(most).toBeGreaterThan(1)
    expect(most).toBeLessThanOrEqual(FETCH_AT_ONCE)
    for (const p of pics) expect(await getBlob(p.a.sha256)).toBeDefined()
    forgetMedia()
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
    await nameKey(services(desktop.shell).doc, 'lamp')
    await services(desktop.shell).clan!.flush()
    await services(desktop.shell).clan!.clan.mirrorNow('manual')
    const theirs = fake.projects.get(p.id)!.row
    // The laptop changes it too, and saves on top of the copy it had.
    await nameKey(services(laptop.shell).doc, 'kite')
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
    expect(fake.projects.get(copy.id)!.row.etag).toBe(theirs.etag) // exactly their save, as the library's own document
    expect(laptop.index.get(copy.id)!.server!.etag).toBe(theirs.etag)
    // Theirs, as a copy, is on the relay too, with the canvas; mine is the project now, saved over theirs knowingly.
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: theirs.etag })
    expect(fake.projects.get(p.id)!.row.etag).not.toBe(theirs.etag)
    expect(services(laptop.shell).serverCopy!.get()).toBeNull()
    expect(Object.values(services(laptop.shell).doc.get().keys).map((k) => k.key)).toContain('kite')
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
    await nameKey(services(laptop.shell).doc, 'kite')
    await services(laptop.shell).clan!.flush()
    await services(laptop.shell).clan!.clan.mirrorNow('manual')
    expect(fake.saves.at(-1)).toMatchObject({ ifMatch: first })
    expect(fake.projects.get(p.id)!.row.etag).not.toBe(first)
  })

  it('a tab with no base never saves blind over the relay\u2019s copy: the person chooses (re-test N3)', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { laptop, p } = await made(fake)
    const first = fake.projects.get(p.id)!.row.etag
    const copy = services(laptop.shell).serverCopy!
    await copy.settle(null) // this tab knows no version of the relay's
    // The same bytes as the relay's: that is its base, and nothing is sent.
    const before = fake.saves.length
    await services(laptop.shell).clan!.clan.mirrorNow('manual')
    expect(fake.saves.length).toBe(before)
    expect(copy.basedOn()?.etag).toBe(first)
    expect(laptop.index.get(p.id)!.server!.etag).toBe(first)
    // Changed since: no save without If-Match, the choice is asked for.
    await copy.settle(null)
    await nameKey(services(laptop.shell).doc, 'kite')
    await services(laptop.shell).clan!.flush()
    const err = await services(laptop.shell).clan!.clan.mirrorNow('manual').catch((x: unknown) => x)
    expect(err).toBeInstanceOf(SaveConflict)
    expect(fake.saves.length).toBe(before)
    expect(fake.projects.get(p.id)!.row.etag).toBe(first)
    await laptop.shell.saveAsNewVersion()
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: first })
  })
})

describe('opening a project checks the relay for a newer version (re-test R2)', () => {
  const quiet = () => new Promise((r) => setTimeout(r, 30))
  /** The laptop saved and closed it; the desktop then saved a newer version. */
  async function newerElsewhere(laptopWorks: boolean) {
    forgetSent()
    const fake = new FakeRelay()
    const { laptop, p } = await made(fake)
    if (laptopWorks) {
      // Work on the laptop that never reached the relay (the tab was closed before its save went).
      await nameKey(services(laptop.shell).doc, 'kite')
      await services(laptop.shell).clan!.flush()
      services(laptop.shell).serverCopy!.hold('the tab closed before its save went') // its close-time save stops
    }
    await laptop.shell.goHome()
    await quiet()
    const desktop = browser(fake)
    await desktop.shell.openFromServer({ id: p.id })
    await nameKey(services(desktop.shell).doc, 'lamp')
    await services(desktop.shell).clan!.flush()
    await services(desktop.shell).clan!.clan.mirrorNow('manual')
    const theirs = fake.projects.get(p.id)!.row
    const listed = fake.saves.length
    await laptop.shell.open(p.id)
    return { fake, laptop, p, theirs, listed }
  }
  const keys = (shell: Shell) => Object.values(services(shell).doc.get().keys).map((k) => k.key)

  it('nothing of its own here: the newer version opens, and the next save goes on it', async () => {
    const { fake, laptop, p, theirs, listed } = await newerElsewhere(false)
    expect(keys(laptop.shell)).toContain('lamp')
    const copy = services(laptop.shell).serverCopy!
    expect(copy.get()).toBeNull()
    expect(copy.basedOn()?.etag).toBe(theirs.etag)
    expect(laptop.index.get(p.id)!.server).toEqual({ etag: theirs.etag, savedAt: theirs.savedAt })
    expect(fake.saves.length).toBe(listed) // opening saved nothing
    await nameKey(services(laptop.shell).doc, 'kite')
    await services(laptop.shell).clan!.flush()
    await services(laptop.shell).clan!.clan.mirrorNow('manual')
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: theirs.etag })
    expect(fake.projects.get(p.id)!.row.etag).not.toBe(theirs.etag)
  })

  it('work of its own here: it opens as it was, and the choice is asked for before any save', async () => {
    const { fake, laptop, p, theirs, listed } = await newerElsewhere(true)
    expect(keys(laptop.shell)).toContain('kite')
    expect(keys(laptop.shell)).not.toContain('lamp')
    const copy = services(laptop.shell).serverCopy!
    expect(copy.get()?.message).toContain('this browser has changes of its own')
    await expect(services(laptop.shell).clan!.clan.mirrorNow('manual')).rejects.toBeInstanceOf(SaveConflict)
    expect(fake.saves.length).toBe(listed)
    expect(fake.projects.get(p.id)!.row.etag).toBe(theirs.etag)
    await laptop.shell.saveAsNewVersion()
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: theirs.etag })
    expect(copy.get()).toBeNull()
  })

  it('its own save, whose answer never came back (the page closed as it went), and work after it: no question (UAT U7)', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { laptop, p } = await made(fake)
    await nameKey(services(laptop.shell).doc, 'kite')
    await services(laptop.shell).clan!.flush()
    fake.loseAnswers = true
    await services(laptop.shell).clan!.clan.mirrorNow('manual').catch(() => {})
    const mine = fake.projects.get(p.id)!.row
    // More work here after it went, and then the browser died: nothing more reaches the relay.
    await nameKey(services(laptop.shell).doc, 'lamp')
    await services(laptop.shell).clan!.flush()
    fake.offline = true
    await laptop.shell.goHome()
    await quiet()
    fake.loseAnswers = fake.offline = false
    const saves = fake.saves.length
    await laptop.shell.open(p.id)
    // Its own save is its base, not "saved from another browser or tab"; the work after it is still here, and it goes
    // up at once on that base (S1-12: not at the minute's save).
    const copy = services(laptop.shell).serverCopy!
    expect(copy.get()).toBeNull()
    expect(keys(laptop.shell)).toEqual(expect.arrayContaining(['kite', 'lamp']))
    await vi.waitFor(() => expect(fake.saves.length).toBe(saves + 1))
    expect(fake.saves.at(-1)).toMatchObject({ id: p.id, ifMatch: mine.etag })
    // The fake counts a save when it arrives and stores it after an async hash, so wait for it to land.
    await vi.waitFor(() => expect(fake.projects.get(p.id)!.row.etag).not.toBe(mine.etag))
    expect(copy.get()).toBeNull()
  })

  it('the same version as here: it opens with no question and no download', async () => {
    forgetSent()
    const fake = new FakeRelay()
    const { laptop, p } = await made(fake)
    await laptop.shell.goHome()
    await quiet()
    const saves = fake.saves.length
    await laptop.shell.open(p.id)
    expect(services(laptop.shell).serverCopy!.get()).toBeNull()
    expect(services(laptop.shell).serverCopy!.basedOn()?.etag).toBe(fake.projects.get(p.id)!.row.etag)
    expect(fake.saves.length).toBe(saves)
  })
})

describe('the host client', () => {
  it('sends If-Match as the version, reads the ETag back, and a refusal carries `latest`', async () => {
    const seen: Headers[] = []
    const fake = new FakeRelay()
    const fetchFn = (async (u: RequestInfo | URL, i?: RequestInit) => {
      seen.push(new Headers(i?.headers))
      return fake.fetch(u, i)
    }) as typeof fetch
    const server = new ProjectServer({ base: '/relay', host: '/api/', signedIn: () => true, fetchFn })
    const id = await server.create('Ad')
    const first = await server.open(id)
    const saved = await server.save(id, new Uint8Array([80, 75, 3, 4]), { reason: 'manual', ifMatch: first.etag })
    const sent = seen.find((h) => h.get('X-Clan-Reason'))!
    expect(sent.get('If-Match')).toBe(`"sha256:${first.etag}"`)
    expect(sent.has('Authorization')).toBe(false)
    const opened = await server.open(id)
    expect(opened.etag).toBe(saved.etag)
    expect(hexOf(`sha256:${opened.etag}`)).toBe(await sha256Hex(opened.bytes))
    const stale = await server.save(id, new Uint8Array([1]), { reason: 'interval', ifMatch: first.etag }).catch((e: unknown) => e)
    expect(stale).toBeInstanceOf(SaveConflict)
    expect((stale as SaveConflict).latest).toBe(saved.etag)
    expect((await server.version(id))?.etag).toBe(saved.etag)
    await expect(server.save(id, new Uint8Array([1]), { reason: 'interval' })).rejects.toThrow('based on')
    await expect(new ProjectServer({ base: '/relay', signedIn: () => false, fetchFn }).list()).rejects.toThrow('Sign in through Napkin Studio.')
    fake.identity = false
    await expect(server.list()).rejects.toMatchObject({ status: 401 })
  })

  it('lists only the library\'s Production documents, newest first', async () => {
    const fake = new FakeRelay()
    const server = new ProjectServer({ base: '/relay', host: '/api', signedIn: () => true, fetchFn: fake.fetch as typeof fetch })
    const a = await server.create('A')
    const b = await server.create('B')
    expect((await server.list()).map((r) => r.id)).toEqual([b, a])
  })
})
