// Home and the projects (features/project-home.clan): which view is showing,
// the open project's session, and what Home can do to a project (new, open,
// rename, duplicate, export, delete, open a file). One action at a time, in
// order, so two clicks never open two projects.

import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument, SavedProject } from '../contracts/types'
import { CURRENT } from '../doc/open'
import { normaliseDocument } from '../doc/store'
import { exportBundle } from '../export'
import { putBlobAs } from '../lib/blobs'
import { copyName, newProjectId, type ProjectEntry, type ServerMark } from './projectIndex'
import { NotAProject, unpackFile, type Unpacked } from './openFile'
import { fetchAssets } from './serverAssets'
import type { ServerCopy } from './serverCopy'
import { openProjectSession, type ProjectSession, type SessionDeps } from './session'
import { canvasKeyFor, clanDbFor, docKeyFor, uiKeyFor } from './storage'
import { autoName, summarise } from './summary'

export interface ShellState {
  view: 'home' | 'project'
  session: ProjectSession | null
  /** What is under way ("Opening…"), for Home to say. */
  busy: string | null
  /** A short line for Home, until dismissed ("Welcome back, Maya: 3 projects"). */
  notice: string | null
}

export class Shell {
  readonly deps: SessionDeps
  private state: ShellState = { view: 'home', session: null, busy: null, notice: null }
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: SessionDeps) {
    this.deps = deps
  }

  get = (): ShellState => this.state
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get index() {
    return this.deps.index
  }

  /** After boot: back where the person was (a reload keeps the open project), else Home. */
  start(): Promise<void> {
    const { view, project } = this.deps.app.get()
    if (view === 'project' && project && this.index.get(project)) return this.open(project)
    return this.goHome()
  }

  open(id: string): Promise<void> {
    return this.serial('Opening…', async () => {
      if (!this.index.get(id)) throw new Error('That project is not in this browser any more.')
      if (this.state.session?.id !== id) {
        await this.closeSession()
        const session = await openProjectSession(id, this.deps)
        this.set({ session })
      }
      this.set({ view: 'project' })
      await this.remember({ view: 'project', project: id })
    })
  }

  goHome(): Promise<void> {
    return this.serial(null, async () => {
      await this.closeSession()
      this.set({ view: 'home' })
      await this.remember({ view: 'home' })
    })
  }

  /** A new, empty project, opened at the Canvas. The one in hand is saved first; nothing is overwritten. */
  async newProject(): Promise<ProjectEntry> {
    const entry = await this.serial('Starting a new project…', async () => {
      await this.closeSession()
      return this.index.create()
    })
    await this.open(entry.id)
    return entry
  }

  rename(id: string, name: string): Promise<void> {
    return this.index.rename(id, name)
  }

  /** A copy with its own document, canvas and UI; the pictures are shared, as all of them are. */
  duplicate(id: string): Promise<ProjectEntry> {
    return this.serial('Duplicating…', async () => {
      const src = this.index.get(id)
      if (!src) throw new Error('That project is not in this browser any more.')
      if (this.state.session?.id === id) await this.state.session.close().then(() => this.set({ session: null, view: 'home' }))
      const { storage, index } = this.deps
      const entry = await index.create({ name: copyName(src.name, index.all().map((p) => p.name)), naming: 'person', summary: { ...src.summary, active: 0, making: undefined } })
      const saved = await storage.clan(clanDbFor(id)).read()
      if (saved) await storage.clan(clanDbFor(entry.id)).write(saved)
      const json = await storage.get(docKeyFor(id))
      if (json) await storage.put(docKeyFor(entry.id), json)
      const canvas = await storage.get(canvasKeyFor(id))
      if (canvas) await storage.put(canvasKeyFor(entry.id), canvas)
      // Its own undo steps and drafts; not a run that was under way (that run belongs to the original).
      const ui = await storage.get<Record<string, unknown>>(uiKeyFor(id))
      if (ui) {
        const { following: _f, drawingRest: _d, ...rest } = ui
        await storage.put(uiKeyFor(entry.id), rest)
      }
      return entry
    })
  }

  /** Delete: the project's own document, canvas and UI. Never the pictures (other projects may use
   *  them; Clean up handles those), never the server's copy. */
  remove(id: string): Promise<void> {
    return this.serial(null, async () => {
      if (this.state.session?.id === id) {
        await this.closeSession()
        this.set({ view: 'home' })
        await this.remember({ view: 'home' })
      }
      const { storage, index } = this.deps
      await index.remove(id)
      await storage.dropClan(clanDbFor(id))
      await Promise.all([storage.del(canvasKeyFor(id)), storage.del(uiKeyFor(id)), storage.del(docKeyFor(id))])
    })
  }

  /** The project's Export zip, from Home's card. */
  exportProject(id: string): Promise<{ blob: Blob; name: string; missing: number }> {
    return this.serial('Packing…', async () => {
      const entry = this.index.get(id)
      if (!entry) throw new Error('That project is not in this browser any more.')
      const open = this.state.session
      const { storage, makeClan } = this.deps
      const read = (k: string) => storage.get<CanvasSnapshot>(k)
      if (open?.id === id) return exportBundle(open.services.doc, open.services.project.canvasKey, entry.name, read)
      const store = makeClan(storage.clan(clanDbFor(id)), () => undefined)
      if (!(await store.load())) throw new Error('That project has nothing saved to export yet.')
      try {
        return await exportBundle(store, canvasKeyFor(id), entry.name, read)
      } finally {
        await store.flush().catch(() => {})
        store.clan.dispose()
      }
    })
  }

  /** Open a file: an Export zip or a bare .clan becomes a new project, opened. */
  async openFile(file: Blob, fileName: string): Promise<ProjectEntry> {
    const entry = await this.serial('Opening the file…', async () => {
      const unpacked = await unpackFile(new Uint8Array(await file.arrayBuffer()), fileName)
      return this.importUnpacked(unpacked, { id: newProjectId() })
    })
    await this.open(entry.id)
    return entry
  }

  // ── the person's projects on the relay (features/personal-workspaces.clan) ──

  /** The person's saved projects on the relay, or none without one. */
  serverProjects(): Promise<SavedProject[]> {
    const { server } = this.deps
    return server?.signedIn ? server.list() : Promise.resolve([])
  }

  /** A project saved from another browser: its .clan, canvas and every picture it uses come down, and
   *  it opens as a project of this browser, under the same id (so its saves stay one project). */
  async openFromServer(row: Pick<SavedProject, 'id' | 'name'>): Promise<ProjectEntry> {
    if (this.index.get(row.id)) {
      await this.open(row.id)
      return this.index.get(row.id)!
    }
    const entry = await this.serial('Downloading the project…', async () => {
      const got = await this.download(row.id)
      return this.importUnpacked(
        { clan: got.bytes, assets: [], mismatched: 0, fileName: row.name ?? '', canvas: got.canvas },
        { id: row.id, name: row.name, server: { etag: got.etag, savedAt: got.savedAt }, fetchAssets: true },
      )
    })
    await this.open(entry.id)
    return entry
  }

  /** Someone saved the open project since this browser did: keep their save as a copy (a new project,
   *  on the relay too), then save this one on top of it. Nothing is lost either way. */
  keepTheirsAsCopy(): Promise<ProjectEntry> {
    return this.serial('Keeping their version as a copy…', async () => {
      const { session, copy, server } = this.inConflict()
      const src = this.index.get(session.id)!
      const got = await this.download(session.id)
      const name = copyName(src.name, this.index.all().map((p) => p.name))
      const entry = await this.importUnpacked(
        { clan: got.bytes, assets: [], mismatched: 0, fileName: name, canvas: got.canvas },
        { id: newProjectId(), name, naming: 'person', fetchAssets: true },
      )
      const saved = await server.save(entry.id, got.bytes, { reason: 'manual', name })
      await this.index.setServer(entry.id, { etag: saved.etag, savedAt: saved.savedAt })
      if (got.canvas) await server.putCanvas(entry.id, got.canvas.elements).catch(() => {})
      await this.saveOver(session, copy, { etag: got.etag, savedAt: got.savedAt })
      return entry
    })
  }

  /** Someone saved the open project since this browser did: save this one as the newest version.
   *  Theirs stays on the relay among the project's earlier saves. */
  saveAsNewVersion(): Promise<void> {
    return this.serial('Saving…', async () => {
      const { session, copy, server } = this.inConflict()
      const latest = (await server.list()).find((p) => p.id === session.id)
      await this.saveOver(session, copy, latest ?? null)
    })
  }

  /** A short line for Home ("Welcome back, Maya: 3 projects"); null clears it. */
  say(notice: string | null) {
    this.set({ notice })
  }

  // ── inside ──

  private inConflict() {
    const session = this.state.session
    const copy = session?.services.serverCopy
    const server = this.deps.server
    if (!session || !copy?.get() || !server) throw new Error('There is nothing to choose: the project saved.')
    return { session, copy, server }
  }

  /** Save the open project on top of `theirs` (the relay's newest copy; null when it has none). */
  private async saveOver(session: ProjectSession, copy: ServerCopy, theirs: ServerMark | null) {
    await copy.settle(theirs)
    const clan = session.services.clan
    if (clan) {
      await clan.flush()
      await clan.clan.mirrorNow('manual')
    }
  }

  private async download(id: string) {
    const server = this.deps.server
    if (!server) throw new Error('There is no server to open it from.')
    const got = await server.open(id)
    const canvas = await server.canvas(id).catch(() => null)
    return { ...got, canvas: canvas ? { elements: canvas.elements, files: {} } as unknown as CanvasSnapshot : undefined }
  }

  /** A file's or the relay's project into this browser. With `fetchAssets`, every picture it uses
   *  that this browser lacks comes from the relay first; one that cannot stops it, and nothing is kept. */
  private async importUnpacked(unpacked: Unpacked, opts: { id: string; name?: string; naming?: ProjectEntry['naming']; server?: ServerMark; fetchAssets?: boolean }): Promise<ProjectEntry> {
    const { storage, makeClan, index, server } = this.deps
    const id = opts.id
    const fetchFirst = async (doc: ProductionDocument) => {
      if (opts.fetchAssets && server) await fetchAssets(doc, server)
    }
    let doc: ProductionDocument
    if (unpacked.clan) {
      const store = makeClan(storage.clan(clanDbFor(id)), () => undefined)
      try {
        doc = normaliseDocument((await store.clan.open(unpacked.clan)) as unknown as ProductionDocument)
        if (doc.contract_version !== CURRENT) throw new NotAProject('That .clan was made by an older Production Tool and cannot be opened here.')
        await fetchFirst(doc)
        await store.clan.flush()
      } catch (e) {
        await storage.dropClan(clanDbFor(id))
        throw e instanceof NotAProject ? e : new NotAProject(`That .clan could not be opened: ${e instanceof Error ? e.message : e}`)
      } finally {
        store.clan.dispose()
      }
    } else {
      doc = normaliseDocument(unpacked.json!)
      if (doc.contract_version !== CURRENT) throw new NotAProject('That export was made by an older Production Tool and cannot be opened here.')
      await fetchFirst(doc)
      await storage.put(docKeyFor(id), doc)
    }
    const mimeOf = new Map(doc.assets.map((a) => [a.sha256, a.mime]))
    for (const a of unpacked.assets) await putBlobAs(a.sha256, new Blob([a.bytes.slice().buffer as ArrayBuffer], { type: mimeOf.get(a.sha256) ?? a.mime }))
    if (unpacked.canvas) await storage.put(canvasKeyFor(id), unpacked.canvas satisfies CanvasSnapshot)
    const auto = autoName(doc)
    const name = opts.name ?? auto ?? unpacked.fileName
    const naming = opts.naming ?? (opts.name ? (opts.name === auto ? 'auto' : 'person') : auto || !unpacked.fileName ? 'auto' : 'person')
    return index.create({ id, name, naming, summary: summarise(doc), server: opts.server })
  }

  private async closeSession() {
    const s = this.state.session
    if (!s) return
    this.set({ session: null, view: 'home' })
    await s.close()
  }

  private async remember(v: { view: 'home' | 'project'; project?: string }) {
    this.deps.app.update((a) => {
      a.view = v.view
      if (v.project) a.project = v.project
    })
    await this.deps.app.flush()
  }

  private serial<T>(busy: string | null, fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (busy) this.set({ busy })
      try {
        return await fn()
      } finally {
        if (busy) this.set({ busy: null })
      }
    })
    this.queue = run.catch(() => {})
    return run
  }

  private set(p: Partial<ShellState>) {
    this.state = { ...this.state, ...p }
    for (const fn of this.listeners) fn()
  }
}
