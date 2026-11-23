// One open project: its document, its UI, its job runner and its chains, its
// canvas and its server copy (features/project-home.clan). Opening builds them
// from the project's own storage; closing saves them and stops the runner.
// Jobs still being made when a project closes stay in its document and land
// the next time it is opened (runner.resume, resumeChains): never in another.
// A project made under another contract is refused (ProjectRefused): said,
// never created over, its bytes left where they are.

import { type Persistence, type Person } from '../../../clan-store/src'
import type { ProjectHandle, Services } from '../app/context'
import type { CanvasSnapshot } from '../canvas/controller'
import type { Config, Me } from '../contracts/types'
import { isRefused, openDocument } from '../doc/open'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialProjectUi, type AppUi, type ProjectUi } from '../doc/ui'
import { JobRunner } from '../jobs/runner'
import { CONFIGS } from '../contracts/load'
import { resumeChains, wireJobs } from '../jobs/wire'
import { ModelStore, type ModelStoreOptions } from '../model/store'
import { pendingKey } from '../model/recover'
import { browserClanStore } from '../store/browser'
import type { Relay } from '../relay'
import type { ProjectIndex } from './projectIndex'
import type { ProjectServer } from './server'
import { readBase, ServerCopy } from './serverCopy'
import { canvasKeyFor, clanDbFor, uiKeyFor, type ProjectStorage } from './storage'
import { autoName, summarise } from './summary'
import { ProjectUiStore } from './uiStore'

/** How often the project is sent to the server when it changed. */
export const MIRROR_EVERY_MS = 60_000

/** A .clan store over a project's own database (the browser's by default; tests pass the wasm and memory).
 *  `person` is who writes (absent: only to read it); `undo` where its undo steps are kept. */
export type MakeClan = (persistence: Persistence, opts?: { person?: Person; undo?: ModelStoreOptions['undo']; recover?: ModelStoreOptions['recover'] }) => ModelStore

/** In the browser the .clan lives in the project's store Worker, the one writer (features/engine-store.clan). */
export const browserClan: MakeClan = (persistence, opts = {}) => {
  if (!persistence.idbName) throw new Error('the browser store needs an IndexedDB database')
  return new ModelStore(browserClanStore(persistence.idbName, opts.person), { undo: opts.undo, recover: opts.recover })
}

/** Who writes when nobody is signed in (the in-browser mock, or a relay that cannot say who). */
export const LOCAL_PERSON: Person = { id: 'p_local', handle: 'guest', tenant_id: '00000000-0000-0000-0000-000000000000' }

/** Save moments (features/pt-film-r1.clan, B7): a landed generation is posted this long after it lands (several in a
 *  row make one post), a project the server has never had this long after its first change. */
export const LANDING_SAVE_MS = 10_000
export const CREATED_SAVE_MS = 1_500

/** The person the app UI's `me` names, as the document records them. */
export function personOf(me: Me | undefined): Person {
  return me ? { id: me.participantId, handle: me.handle, tenant_id: me.tenant.id } : LOCAL_PERSON
}

/** A project this build cannot open (made under another contract): why, in words. Nothing was written. */
export class ProjectRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectRefused'
  }
}

export interface SessionDeps {
  relay: Relay
  app: SnapshotStore<AppUi>
  index: ProjectIndex
  storage: ProjectStorage
  remoteConfig: Config | null
  makeClan: MakeClan
  /** The person's projects on the relay (projects/server.ts); absent on the in-browser mock. */
  server?: ProjectServer
  /** How long the summary waits after a change before it goes into the index. */
  summaryDelayMs?: number
}

export interface ProjectSession {
  id: string
  services: Services
  initialCanvas: CanvasSnapshot | null
  /** Put what the project is now into the index (Home's card). */
  record(changed?: boolean): Promise<void>
  close(): Promise<void>
}

export function projectUiStore(storage: ProjectStorage, id: string): SnapshotStore<ProjectUi> {
  const key = uiKeyFor(id)
  return new SnapshotStore<ProjectUi>(initialProjectUi(), { load: () => storage.get<ProjectUi>(key), save: (v) => storage.put(key, v) })
}

/** Open project `id`. Throws ProjectRefused for a project made under another contract. */
export async function openProjectSession(id: string, deps: SessionDeps): Promise<ProjectSession> {
  const { relay, app, index, storage } = deps
  const part = projectUiStore(storage, id)
  await part.restore((v) => ({ ...initialProjectUi(), ...v }))
  const ui = new ProjectUiStore(app, part)

  const person = personOf(app.get().me)
  // Undo and redo steps live with the project's UI (LocalUndo, model/store.ts), so they survive a reload
  // and stay its own.
  const undo = { saved: ui.get().undo, save: (s: NonNullable<ProjectUi['undo']>) => ui.update((u) => { u.undo = s }) }
  const opened = await openDocument({
    project: id,
    person,
    title: index.get(id)?.name,
    undo,
    make: () => deps.makeClan(storage.clan(clanDbFor(id)), { person, undo, recover: { key: pendingKey(id) } }),
    storage,
  })
  if (isRefused(opened)) {
    await ui.close()
    throw new ProjectRefused(opened.refused)
  }
  const { doc, clan, storeNote } = opened
  // An address a document carries (an older save: idb://, a CloudFront URL) is never read and is not kept: the next
  // save is without it (S1-16). Quiet, no decision.
  if (Object.values(doc.get().assets).some((a) => (a as { locations?: unknown }).locations !== undefined)) {
    await systemUpdate(doc, (d) => { for (const a of Object.values(d.assets)) delete (a as { locations?: unknown }).locations }, 'drop stored addresses').catch((e) => console.warn('could not drop stored addresses', e))
  }

  const runner = new JobRunner(relay, doc, ui)
  // Never send past the relay's per-person limit: the rest wait here, "In the queue" (it answered 429 before).
  runner.inFlightLimit = () => (deps.remoteConfig ?? CONFIGS.live).inFlightPerParticipant
  // Landed jobs, and the chains they move on: Draw the rest, Fix it in the shot, Update what follows.
  // The Film editor is the rooms (owner 2026-11-18): a new take lands beside the others, never in the cut.
  // A landed generation is a save moment (B7, below): the server's copy is posted soon after.
  let saveSoon: (ms: number) => void = () => {}
  const frameDeps = { relay, doc, ui, runner, rooms: () => true, landed: () => saveSoon(LANDING_SAVE_MS) }
  wireJobs(frameDeps)
  runner.resume()
  void resumeChains(frameDeps)

  const canvasKey = canvasKeyFor(id)

  // The project's copy in the library (PUT /api/t/{t}/d/{doc}/save), which any browser opens by its id: every minute
  // when something changed, on each lock, on export and on Save, each checked against the version this tab's
  // document is based on (serverCopy.ts). Not on the mock.
  let serverCopy: ServerCopy | null = null
  if (clan && relay.kind === 'http' && deps.server) {
    serverCopy = new ServerCopy({
      id, server: deps.server, index, storage, doc: () => doc.get(),
      upload: (blob, mime) => relay.upload(blob, mime),
      onPosted: (at) => app.update((a) => { a.savedAt = at.toISOString() }),
      base: await readBase(storage, index, id),
    })
    // Every minute when something changed (clan-store startMirror posts nothing otherwise): every 5 minutes left
    // "saved hh:mm" up to 5 minutes behind the work, and people pressed Ctrl+S to be sure (UAT round 1 IMG-22).
    clan.clan.startMirror((bytes, meta) => serverCopy!.post(bytes, meta), { everyMs: MIRROR_EVERY_MS })
    // Save moments besides the minute tick, a lock and Save (UAT 2026-11-21, B7: a film started from "Continue in"
    // was never on the server and closing the browser lost it): a project the server has never had, at its first
    // change; and every landed generation. One post per moment, the last change in it included.
    const mirror = clan.clan
    saveSoon = (ms: number) => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { saveTimer = null; void mirror.mirrorNow('landing').catch(() => {}) }, ms)
    }
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const initialCanvas = (await storage.get<CanvasSnapshot>(canvasKey)) ?? null

  // Home's card follows the project: its stage, counts, picture and (until renamed) its name.
  const record = async (changed = true) => {
    const d = doc.get()
    await index.touch(id, summarise(d, ui.get()), { name: autoName(d), changed })
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let changedSinceOpen = false
  let savedOnce = false
  const offChange = doc.onChange(() => {
    changedSinceOpen = true
    // Something was added to a blank film: it is a project now (owner 2026-11-18).
    if (index.get(id)?.draft) void index.keep(id)
    // A project the server has never had (a new film, one started from "Continue in") goes there at once.
    if (!index.get(id)?.server && !savedOnce) { savedOnce = true; saveSoon(CREATED_SAVE_MS) }
    serverCopy?.edited()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void record()
    }, deps.summaryDelayMs ?? 800)
  })

  const project: ProjectHandle = {
    id,
    canvasKey,
    beforeClose: new Set(),
    usedElsewhere: (sha) => index.usedElsewhere(sha, id),
  }
  const services: Services = { project, relay, doc, ui, runner, remoteConfig: deps.remoteConfig, clan, storeNote, serverCopy }

  let closing: Promise<void> | null = null
  const close = () => (closing ??= (async () => {
    for (const fn of [...project.beforeClose]) {
      try {
        await fn()
      } catch (e) {
        console.warn('could not save before closing the project', e)
      }
    }
    runner.stop()
    offChange()
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; changedSinceOpen = true }
    const pending = !!timer
    if (timer) clearTimeout(timer)
    timer = null
    await doc.flush()
    await record(pending)
    // The server's copy, once more, as it is now (when it changed, and only when it is being copied at all).
    if (changedSinceOpen && clan && serverCopy) void clan.clan.mirrorNow('manual').catch(() => {})
    if (clan) await clan.close()
    await ui.close()
  })())

  return { id, services, initialCanvas, record, close }
}
