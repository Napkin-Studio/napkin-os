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
import { SnapshotStore } from '../doc/store'
import { initialProjectUi, type AppUi, type ProjectUi } from '../doc/ui'
import { JobRunner } from '../jobs/runner'
import { CONFIGS } from '../contracts/load'
import { effectiveConfig } from '../capabilities'
import { resumeChains, wireJobs } from '../jobs/wire'
import { ModelStore, type ModelStoreOptions } from '../model/store'
import { browserClanStore } from '../store/browser'
import type { Relay } from '../relay'
import type { ProjectIndex } from './projectIndex'
import type { ProjectServer } from './server'
import { ServerCopy } from './serverCopy'
import { canvasKeyFor, clanDbFor, uiKeyFor, type ProjectStorage } from './storage'
import { autoName, summarise } from './summary'
import { ProjectUiStore } from './uiStore'

/** A .clan store over a project's own database (the browser's by default; tests pass the wasm and memory).
 *  `person` is who writes (absent: only to read it); `undo` where its undo steps are kept. */
export type MakeClan = (persistence: Persistence, opts?: { person?: Person; undo?: ModelStoreOptions['undo'] }) => ModelStore

/** In the browser the .clan lives in the project's store Worker, the one writer (features/engine-store.clan). */
export const browserClan: MakeClan = (persistence, opts = {}) => {
  if (!persistence.idbName) throw new Error('the browser store needs an IndexedDB database')
  return new ModelStore(browserClanStore(persistence.idbName, opts.person), { undo: opts.undo })
}

/** Who writes when nobody is signed in (the in-browser mock, or a relay that cannot say who). */
export const LOCAL_PERSON: Person = { id: 'p_local', handle: 'guest', tenant_id: '00000000-0000-0000-0000-000000000000' }

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
    make: () => deps.makeClan(storage.clan(clanDbFor(id)), { person, undo }),
    storage,
  })
  if (isRefused(opened)) {
    await ui.close()
    throw new ProjectRefused(opened.refused)
  }
  const { doc, clan, storeNote } = opened

  const runner = new JobRunner(relay, doc, ui)
  // Never send past the relay's per-person limit: the rest wait here, "In the queue" (it answered 429 before).
  runner.inFlightLimit = () => (deps.remoteConfig ?? CONFIGS.live).inFlightPerParticipant
  // Landed jobs, and the chains they move on: Draw the rest, Fix it in the shot, Update what follows.
  // The rooms (flags.makeAndEdit) read from the config the person runs on, at each landing.
  const rooms = () => !!effectiveConfig(ui.get().configChoice, ui.get().providerChoice, undefined, deps.remoteConfig).flags.makeAndEdit
  const frameDeps = { relay, doc, ui, runner, rooms }
  wireJobs(frameDeps)
  runner.resume()
  void resumeChains(frameDeps)

  const canvasKey = canvasKeyFor(id)

  // The project's copy on the relay (POST /clan with X-Project-Id), which the same name opens from
  // any browser: every 5 minutes when something changed, on each lock, on export and on Save, each
  // checked against the copy this browser last saved or opened (serverCopy.ts). Not on the mock.
  let serverCopy: ServerCopy | null = null
  if (clan && relay.kind === 'http' && deps.server) {
    serverCopy = new ServerCopy({
      id, server: deps.server, index, storage, canvasKey, doc: () => doc.get(),
      upload: (blob, mime) => relay.upload(blob, mime),
      onPosted: (at) => app.update((a) => { a.savedAt = at.toISOString() }),
    })
    clan.clan.startMirror((bytes, meta) => serverCopy!.post(bytes, meta), { everyMs: 300_000 })
  }
  const initialCanvas = (await storage.get<CanvasSnapshot>(canvasKey)) ?? null

  // Home's card follows the project: its stage, counts, picture and (until renamed) its name.
  const record = async (changed = true) => {
    const d = doc.get()
    await index.touch(id, summarise(d, ui.get()), { name: autoName(d), changed })
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let changedSinceOpen = false
  const offChange = doc.onChange(() => {
    changedSinceOpen = true
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
