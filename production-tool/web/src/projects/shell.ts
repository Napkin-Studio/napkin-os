// Home and the projects (features/project-home.clan): which view is showing,
// the open project's session, and what Home can do to a project (new, open,
// rename, duplicate, export, delete, open a file). One action at a time, in
// order, so two clicks never open two projects. A project made under another
// contract is refused in words (ProjectRefused, NotAProject) and never created
// over: its bytes stay where they are.

import { newUlidId, UnsupportedContract } from '../../../clan-store/src'
import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument, SavedProject } from '../contracts/types'
import { CURRENT } from '../doc/open'
import { exportBundle } from '../export'
import { RelayError } from '../relay/types'
import { putBlobAs } from '../lib/blobs'
import { copyName, newProjectId, type ProjectEntry, type ServerMark } from './projectIndex'
import { NotAProject, unpackFile, type Unpacked } from './openFile'
import { fetchAssets } from './serverAssets'
import { readBase, type LocalBase, type ServerCopy } from './serverCopy'
import { openProjectSession, personOf, ProjectRefused, type ProjectSession, type SessionDeps } from './session'
import { baseKeyFor, canvasKeyFor, clanDbFor, docKeyFor, uiKeyFor } from './storage'
import { autoName, hasContent, summarise, UNTITLED as UNTITLED_TITLE } from './summary'
import { updateDoc } from '../doc/store'
import { sha256Hex } from '../lib/hash'
import { clearPending, pendingKey } from '../model/recover'
import { clearLiveLog } from '../store/liveLog'
import type { ProjectUi } from '../doc/ui'

export interface ShellState {
  view: 'home' | 'project'
  session: ProjectSession | null
  /** What is under way ("Opening…"), for Home to say. */
  busy: string | null
  /** A short line for Home, until dismissed ("Welcome back, Maya: 3 projects"). */
  notice: string | null
}

/** A new project id for the document (the bus never patches an id, so it is a data patch on the .clan), recorded
 *  as a decision. Its jobs then go to the relay as their own project. */
async function newProjectIdIn(store: { clan: { patch(body: object, why: { action: string; rationale?: string }): Promise<unknown> } }): Promise<void> {
  await store.clan.patch({ project: { id: newUlidId('proj') } }, { action: 'a copy is its own project', rationale: 'Opened as a copy: its jobs are its own, never filed under the original project.' })
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
  async start(): Promise<void> {
    const { view, project } = this.deps.app.get()
    if (view === 'project' && project && this.index.get(project)) {
      try {
        return await this.open(project)
      } catch (e) {
        // Back on Home, saying why (the project stays in the list, untouched).
        if (e instanceof ProjectRefused) return this.say(e.message)
        // Signed out (a 401): a state, not an error. onUnauthorised has said so, and the page offers Sign in.
        if (e instanceof RelayError && e.status === 401) return this.goHome()
        throw e
      }
    }
    return this.goHome()
  }

  /** Open a project of this browser. Throws ProjectRefused (Home stays) for one made under another contract. */
  open(id: string): Promise<void> {
    return this.serial('Opening…', async () => {
      if (!this.index.get(id)) throw new Error('That project is not in this browser any more.')
      if (this.state.session?.id !== id) {
        await this.closeSession()
        try {
          const held = await this.newerThere(id)
          const session = await openProjectSession(id, this.deps)
          if (held) session.services.serverCopy?.hold(held)
          else await this.pushUnsaved(id, session)
          this.set({ session })
        } catch (e) {
          if (e instanceof ProjectRefused) await this.remember({ view: 'home' })
          throw e
        }
      }
      this.set({ view: 'project' })
      await this.remember({ view: 'project', project: id })
    })
  }

  /** A copy opened with work the host lacks (a reload came before the minute's save, S1-12) goes up at once, on the
   *  version it is based on: a refusal is the usual choice (serverCopy.ts), never an overwrite. */
  private async pushUnsaved(id: string, session: ProjectSession): Promise<void> {
    const { storage, index } = this.deps
    const clan = session.services.clan
    if (!clan || !session.services.serverCopy || !(await readBase(storage, index, id)).unsaved) return
    void clan.clan.mirrorNow('landing').catch((e) => console.warn('could not send the work kept from before the reload', e))
  }

  goHome(): Promise<void> {
    return this.serial(null, async () => {
      await this.closeSession()
      this.set({ view: 'home' })
      await this.remember({ view: 'home' })
    })
  }

  /** A new, blank film, opened at the Canvas (the entry when no film is named, owner 2026-11-18). It is a draft
   *  until something is added: not on All projects, and gone if it is left blank. The one in hand is saved
   *  first; nothing is overwritten. */
  async newProject(): Promise<ProjectEntry> {
    const entry = await this.serial('Starting a new project…', async () => {
      await this.closeSession()
      const { server, relay } = this.deps
      // With the host: the project is a library document first (its id is the library's), brought down and started.
      if (server?.signedIn && relay.kind === 'http') {
        const id = await server.create(UNTITLED_TITLE, this.deps.clientId)
        const got = await server.open(id)
        return this.importUnpacked(
          { clan: got.bytes, assets: [], mismatched: 0, fileName: '' },
          { id, draft: true, server: { etag: got.etag, savedAt: got.savedAt }, unsaved: true },
        )
      }
      return this.index.create({ draft: true })
    })
    await this.open(entry.id)
    return entry
  }

  /** The name in this browser's list and, for the open film, in its .clan (project.title), so an export, an
   *  import or another browser keeps it (live test 2026-11-18: the .clan kept "Untitled project"). */
  async rename(id: string, name: string): Promise<void> {
    await this.index.rename(id, name)
    const session = this.state.session
    if (session?.id !== id) return
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    const doc = session.services.doc
    if (doc.get().project.title === (n || UNTITLED_TITLE)) return
    await updateDoc(doc, (d) => { d.project.title = n || UNTITLED_TITLE }, n ? `rename the film to ${n}` : 'let the film name itself')
    // The library lists the manifest's title, so the name reaches it too.
    await session.services.clan?.setTitle(n || UNTITLED_TITLE).catch((e) => console.warn('could not name the library document', e))
    // A name is a save moment: a tab closed straight after it cannot wait for the minute's save.
    if (session.services.serverCopy) void session.services.clan?.clan.mirrorNow('manual').catch(() => {})
  }

  /** A copy with its own document, canvas and UI; the pictures are shared, as all of them are. */
  duplicate(id: string): Promise<ProjectEntry> {
    return this.serial('Duplicating…', async () => {
      const src = this.index.get(id)
      if (!src) throw new Error('That project is not in this browser any more.')
      if (this.state.session?.id === id) await this.state.session.close().then(() => this.set({ session: null, view: 'home' }))
      const { storage, index } = this.deps
      const saved = await storage.clan(clanDbFor(id)).read()
      // With the host a copy is a library document of its own, made from this copy's bytes.
      const home = await this.hostHome(saved?.bytes)
      const entry = await index.create({ id: home?.id, server: home?.mark, name: copyName(src.name, index.all().map((p) => p.name)), naming: 'person', summary: { ...src.summary, active: 0, making: undefined } })
      if (saved) {
        await storage.clan(clanDbFor(entry.id)).write(saved)
        await this.ownProjectId(entry.id, entry.name)
        if (home) await storage.put(baseKeyFor(entry.id), { mark: home.mark, unsaved: true } satisfies LocalBase)
      }
      const json = await storage.get<ProductionDocument>(docKeyFor(id))
      if (json) await storage.put(docKeyFor(entry.id), { ...json, project: { ...json.project, id: newUlidId('proj') } })
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

  /** Delete: the project goes to the host's Trash (restorable for 30 days), and this browser's copy, canvas and UI
   *  go. Never the pictures (other projects may use them; Clean up handles those). A project the host does not have
   *  (a draft that never saved, or no host) is only forgotten here. */
  remove(id: string): Promise<void> {
    return this.serial(null, async () => {
      const { server, relay } = this.deps
      if (server?.signedIn && relay.kind === 'http') {
        try {
          await server.remove(id)
        } catch (e) {
          if (!(e instanceof RelayError && e.status === 404)) throw e // not there (or already in the Trash): forgotten here
        }
      }
      if (this.state.session?.id === id) {
        await this.closeSession()
        this.set({ view: 'home' })
        await this.remember({ view: 'home' })
      }
      const { storage, index } = this.deps
      await index.remove(id)
      clearPending({ key: pendingKey(id) })
      await storage.dropClan(clanDbFor(id))
      await Promise.all([storage.del(canvasKeyFor(id)), storage.del(uiKeyFor(id)), storage.del(docKeyFor(id)), storage.del(baseKeyFor(id))])
    })
  }

  /** Undo of a Move to Trash, from Home's toast: the host's copy comes back to the library (this browser's copy went
   *  with the move; opening it brings it down again). False when there is no host to restore from. */
  async restore(id: string): Promise<boolean> {
    const { server, relay } = this.deps
    if (!server?.signedIn || relay.kind !== 'http') return false
    await server.restore(id)
    return true
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
      const store = makeClan(storage.clan(clanDbFor(id)), { person: personOf(this.deps.app.get().me) })
      try {
        if (!(await store.load())) throw new Error('That project has nothing saved to export yet.')
        return await exportBundle(store, canvasKeyFor(id), entry.name, read)
      } finally {
        await store.close().catch(() => {})
      }
    })
  }

  /** Open a file: an Export zip or a bare .clan becomes a new project, opened. */
  async openFile(file: Blob, fileName: string): Promise<ProjectEntry> {
    const entry = await this.serial('Opening the file…', async () => {
      const unpacked = await unpackFile(new Uint8Array(await file.arrayBuffer()), fileName)
      const home = await this.hostHome(unpacked.clan)
      return this.importUnpacked(unpacked, { id: home?.id ?? newProjectId(), copy: true, server: home?.mark })
    })
    await this.open(entry.id)
    return entry
  }

  // ── the person's projects on the relay (features/personal-workspaces.clan) ──

  /** The person's saved projects on the relay, or none without one. */
  serverProjects(): Promise<SavedProject[]> {
    const { server } = this.deps
    if (!server?.signedIn) return Promise.resolve([])
    return server.list().then((rows) => {
      this.index.knowRemote(rows)
      return rows
    })
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
        { clan: got.bytes, assets: [], mismatched: 0, fileName: row.name ?? '' },
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
      const { session, copy } = this.inConflict()
      const src = this.index.get(session.id)!
      const got = await this.download(session.id)
      const name = copyName(src.name, this.index.all().map((p) => p.name))
      // Theirs becomes a library document of its own (the host keeps the bytes as they are); this browser's copy of
      // it carries its own project id and name, a change the host's copy lacks.
      const home = await this.hostHome(got.bytes)
      const entry = await this.importUnpacked(
        { clan: got.bytes, assets: [], mismatched: 0, fileName: name },
        { id: home?.id ?? newProjectId(), name, naming: 'person', fetchAssets: true, copy: true, server: home?.mark },
      )
      await this.saveOver(session, copy, { etag: got.etag, savedAt: got.savedAt })
      return entry
    })
  }

  /** Someone saved the open project since this browser did: save this one as the newest version.
   *  Theirs stays on the relay among the project's earlier saves. */
  saveAsNewVersion(): Promise<void> {
    return this.serial('Saving…', async () => {
      const { session, copy, server } = this.inConflict()
      const latest = await server.version(session.id)
      await this.saveOver(session, copy, latest)
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

  /**
   * Before a project of this browser opens: is a newer version on the relay than the one this browser's copy is
   * based on (saved from another browser, or another tab)? One GET /projects (re-test R2, 2026-11-18: a reload
   * opened this browser's copy and said "saved", and the next save was refused). With no work of its own here,
   * the relay's version comes down and opens; with work of its own, the choice is asked for as it opens (the
   * message returned). Offline or signed out: what is here opens, and a save still checks (If-Match).
   */
  private async newerThere(id: string): Promise<string | null> {
    const { server, storage, index, relay } = this.deps
    if (!server?.signedIn || relay.kind !== 'http') return null
    let there: { etag: string; savedAt: string } | null
    try {
      there = await server.version(id)
    } catch {
      return null
    }
    if (!there) return null
    const base = await readBase(storage, index, id)
    if (base.mark?.etag === there.etag) return null
    const mark: ServerMark = { etag: there.etag, savedAt: there.savedAt }
    // The relay's newest is a save this browser sent whose answer never came back (the page closed as it went,
    // UAT U7): this browser's own version, so its base, with whatever was changed here after it went unsaved.
    const own = base.unanswered?.find((u) => u.etag === there.etag)
    if (own) {
      await this.based(id, { mark, unsaved: own.edited })
      return null
    }
    // This browser's copy is the relay's version byte for byte: that is its base.
    const local = await storage.clan(clanDbFor(id)).read().catch(() => null)
    if (local && (await sha256Hex(local.bytes)) === there.etag) {
      await this.based(id, { mark, unsaved: false })
      return null
    }
    const at = new Date(there.savedAt).toLocaleString()
    if (base.unsaved) return `A newer version of this project was saved at ${at}, and this browser has changes of its own.`
    try {
      await this.takeFromServer(id)
      return null
    } catch (e) {
      console.warn('could not bring the newer version down', e)
      return `A newer version of this project was saved at ${at}, and it could not be brought down here: ${e instanceof Error ? e.message : e}`
    }
  }

  /** The relay's newest version of a project of this browser, in place of this browser's copy (which has no work
   *  the relay lacks): its .clan with every picture, its canvas, its scene from the .clan's checkpoint. Undo steps
   *  made on the copy it replaces go. */
  private async takeFromServer(id: string): Promise<void> {
    const { storage, makeClan, index, server } = this.deps
    const got = await this.download(id)
    const store = makeClan(storage.clan(clanDbFor(id)), { person: personOf(this.deps.app.get().me) })
    let doc: ProductionDocument
    try {
      doc = await store.open(got.bytes)
      if (server) await fetchAssets(doc, server, id)
    } finally {
      await store.close().catch(() => {})
    }
    clearPending({ key: pendingKey(id) }) // an edit the replaced copy never wrote is not applied to the host's version
    // The scene's live store is the replaced copy's: the scene opens from the new .clan's checkpoint instead.
    await clearLiveLog(`${clanDbFor(id)}:scene`)
    const ui = await storage.get<ProjectUi>(uiKeyFor(id))
    if (ui?.undo) {
      const { undo: _gone, ...rest } = ui
      await storage.put(uiKeyFor(id), rest)
    }
    const mark = { etag: got.etag, savedAt: got.savedAt }
    await index.setServer(id, mark)
    await index.touch(id, summarise(doc), { name: autoName(doc), changed: false })
    await this.based(id, { mark, unsaved: false })
  }

  /** What this browser's copy of `id` is based on now (serverCopy.ts LocalBase). */
  private async based(id: string, base: LocalBase): Promise<void> {
    await this.deps.storage.put(baseKeyFor(id), base)
    if (base.mark) await this.deps.index.setServer(id, base.mark)
  }

  private async download(id: string) {
    const server = this.deps.server
    if (!server) throw new Error('There is no server to open it from.')
    return server.open(id)
  }

  /** A .clan's bytes as a library document of their own (a copy, a file opened): its id and the version the host holds
   *  (the bytes' own hash). null without a host (the in-browser mock): the project is only this browser's. */
  private async hostHome(bytes: Uint8Array | undefined): Promise<{ id: string; mark: ServerMark } | null> {
    const { server, relay } = this.deps
    if (!bytes || !server?.signedIn || relay.kind !== 'http') return null
    const id = await server.upload(bytes)
    return { id, mark: { etag: await sha256Hex(bytes), savedAt: new Date().toISOString() } }
  }

  /** A file's or the relay's project into this browser. With `fetchAssets`, every picture it uses
   *  that this browser lacks comes from the relay first; one that cannot stops it, and nothing is kept. */
  /** A copy is its own project to the relay: a new document project id, so its jobs are never filed under the
   *  original's (QA 2026-11-17: the QA copy's jobs went under Shrey's proj_01M7MFGTR1GJR90QJDH74R08TM). */
  private async ownProjectId(projectId: string, title?: string): Promise<void> {
    const { storage, makeClan } = this.deps
    const store = makeClan(storage.clan(clanDbFor(projectId)), { person: personOf(this.deps.app.get().me) })
    try {
      if (!(await store.load())) return
      await newProjectIdIn(store)
      if (title) await store.setTitle(title).catch((e) => console.warn('could not name the library document', e))
      await store.flush()
    } finally {
      await store.close().catch(() => {})
    }
  }

  /** `copy`: opened from a file or kept as a copy, so it gets its own project id; a project opened from the
   *  server keeps its own. */
  private async importUnpacked(unpacked: Unpacked, opts: { id: string; name?: string; naming?: ProjectEntry['naming']; server?: ServerMark; fetchAssets?: boolean; copy?: boolean; draft?: boolean; unsaved?: boolean }): Promise<ProjectEntry> {
    const { storage, makeClan, index, server } = this.deps
    const id = opts.id
    const fetchFirst = async (doc: ProductionDocument) => {
      if (opts.fetchAssets && server) await fetchAssets(doc, server, opts.id)
    }
    let doc: ProductionDocument
    if (unpacked.clan) {
      // Opened, never created: a .clan of another contract is refused with the bytes as they were.
      const store = makeClan(storage.clan(clanDbFor(id)), { person: personOf(this.deps.app.get().me) })
      try {
        doc = await store.open(unpacked.clan)
        await fetchFirst(doc)
        if (opts.copy) {
          await newProjectIdIn(store)
          await store.flush()
          doc = store.get()
        }
        if (opts.name && opts.copy) await store.setTitle(opts.name).catch((e) => console.warn('could not name the library document', e))
        await store.close()
      } catch (e) {
        await store.close().catch(() => {})
        await storage.dropClan(clanDbFor(id))
        if (e instanceof NotAProject) throw e
        if (e instanceof UnsupportedContract) throw new NotAProject(e.message)
        throw new NotAProject(`That .clan could not be opened: ${e instanceof Error ? e.message : e}`)
      }
    } else {
      const json = unpacked.json!
      if (json.contract_version !== CURRENT) throw new NotAProject(new UnsupportedContract((json as { contract_version?: string }).contract_version ?? null).message)
      doc = opts.copy ? { ...json, project: { ...json.project, id: newUlidId('proj') } } : json
      await fetchFirst(doc)
      await storage.put(docKeyFor(id), doc)
    }
    const mimeOf = new Map(Object.values(doc.assets).map((a) => [a.sha256, a.mime]))
    for (const a of unpacked.assets) await putBlobAs(a.sha256, new Blob([a.bytes.slice().buffer as ArrayBuffer], { type: mimeOf.get(a.sha256) ?? a.mime }))
    if (unpacked.canvas) await storage.put(canvasKeyFor(id), unpacked.canvas satisfies CanvasSnapshot)
    const auto = autoName(doc)
    const name = opts.name ?? auto ?? unpacked.fileName
    const naming = opts.naming ?? (opts.name ? (opts.name === auto ? 'auto' : 'person') : auto || !unpacked.fileName ? 'auto' : 'person')
    // Brought down from the relay: this browser's copy is that version, with nothing of its own yet.
    if (opts.server) await storage.put(baseKeyFor(id), { mark: opts.server, unsaved: !!opts.copy || !!opts.unsaved } satisfies LocalBase)
    return index.create({ id, name, naming, summary: summarise(doc), server: opts.server, ...(opts.draft ? { draft: true as const } : {}) })
  }

  private async closeSession() {
    const s = this.state.session
    if (!s) return
    // Read before it closes: what the film holds now decides whether a draft is kept.
    const held = hasContent(s.services.doc.get())
    this.set({ session: null, view: 'home' })
    await s.close()
    await this.settleDraft(s.id, held)
  }

  /** Drafts left by an earlier visit (owner 2026-11-18): each kept if it holds anything, else removed. Never the
   *  open one. */
  async pruneDrafts(): Promise<void> {
    for (const p of this.index.all().filter((x) => x.draft && x.id !== this.state.session?.id)) await this.settleDraft(p.id)
  }

  /**
   * A draft that was left: removed with its storage only when it is certainly blank, so opening the tool leaves
   * no empty "Untitled" behind. Anything else keeps it as a project: a document with any entity or asset (the open
   * one's, or the stored one's), a mark on its canvas (a drawing changes no document), a name given by hand, a
   * summary with anything in it, or a stored copy that cannot be read. A film that is not a draft is never touched.
   */
  private async settleDraft(id: string, held?: boolean): Promise<void> {
    const entry = this.index.get(id)
    if (!entry?.draft) return
    const { storage, index } = this.deps
    const s = entry.summary
    if (held || entry.naming === 'person' || s.pictures || s.shots || s.active || s.adSeconds !== null) return index.keep(id)
    try {
      const canvas = await storage.get<CanvasSnapshot>(canvasKeyFor(id))
      if (canvas?.elements?.some((e) => !(e as { isDeleted?: boolean }).isDeleted)) return index.keep(id)
      if (held === undefined && (await this.storedContent(id))) return index.keep(id)
    } catch (e) {
      console.warn('kept a blank film whose storage could not be read', e)
      return index.keep(id)
    }
    // A blank draft the host made a document for goes to the Trash (restorable), not left in the library.
    if (entry.server && this.deps.server?.signedIn) await this.deps.server.remove(id).catch(() => {})
    await index.remove(id)
    await storage.dropClan(clanDbFor(id)).catch(() => {})
    await Promise.all([storage.del(canvasKeyFor(id)), storage.del(uiKeyFor(id)), storage.del(docKeyFor(id)), storage.del(baseKeyFor(id))]).catch(() => {})
  }

  /** Whether a closed film's stored document holds anything (its .clan, else the older JSON copy). Throws when the
   *  .clan is there but cannot be read, so the caller keeps it. */
  private async storedContent(id: string): Promise<boolean> {
    const { storage, makeClan } = this.deps
    const json = await storage.get<ProductionDocument>(docKeyFor(id))
    if (json && hasContent(json)) return true
    const store = makeClan(storage.clan(clanDbFor(id)), { person: personOf(this.deps.app.get().me) })
    try {
      return (await store.load()) ? hasContent(store.get()) : false
    } finally {
      await store.close().catch(() => {})
    }
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
