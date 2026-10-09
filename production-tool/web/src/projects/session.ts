// One open project: its document, its UI, its job runner and its chains, its
// canvas and its server copy (features/project-home.clan). Opening builds them
// from the project's own storage; closing saves them and stops the runner.
// Jobs still being made when a project closes stay in its document and land
// the next time it is opened (runner.resume, resumeChains): never in another.

import type { Persistence } from '../../../clan-store/src'
import type { ProjectHandle, Services } from '../app/context'
import type { CanvasSnapshot } from '../canvas/controller'
import type { Config } from '../contracts/types'
import { ClanBackedStore } from '../doc/clan'
import type { JobCtxOf } from '../doc/describe'
import { openDocument } from '../doc/open'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialProjectUi, type AppUi, type ProjectUi } from '../doc/ui'
import { keepUndo } from '../doc/undo'
import { JobRunner } from '../jobs/runner'
import { resumeChains, wireJobs } from '../jobs/wire'
import type { OwnKeysStore } from '../keys/ownKeys'
import type { Relay } from '../relay'
import type { ProjectIndex } from './projectIndex'
import type { ProjectServer } from './server'
import { ServerCopy } from './serverCopy'
import { canvasKeyFor, clanDbFor, uiKeyFor, type ProjectStorage } from './storage'
import { autoName, summarise } from './summary'
import { ProjectUiStore } from './uiStore'

/** A .clan store over a project's own database (the browser's by default; tests pass the wasm and memory). */
export type MakeClan = (persistence: Persistence, ctxOf: JobCtxOf) => ClanBackedStore

export const browserClan: MakeClan = (persistence, ctxOf) => ClanBackedStore.inBrowser({ persistence, ctxOf })

export interface SessionDeps {
  relay: Relay
  app: SnapshotStore<AppUi>
  index: ProjectIndex
  storage: ProjectStorage
  remoteConfig: Config | null
  ownKeys: OwnKeysStore
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

export async function openProjectSession(id: string, deps: SessionDeps): Promise<ProjectSession> {
  const { relay, app, index, storage } = deps
  const part = projectUiStore(storage, id)
  await part.restore((v) => ({ ...initialProjectUi(), ...v }))
  const ui = new ProjectUiStore(app, part)

  const signedIn = app.get().session
  const participant = signedIn ? { id: signedIn.participantId, handle: signedIn.handle } : { id: 'p_local', handle: 'guest' }
  const ctxOf: JobCtxOf = (jobId) => ui.get().jobCtx[jobId]
  const { doc, clan, storeNote } = await openDocument({
    project: id,
    participant,
    ctxOf,
    make: () => deps.makeClan(storage.clan(clanDbFor(id)), ctxOf),
    storage,
  })
  // A project made before signing in, or opened from a file: from now on it is the signed-in person's.
  if (signedIn && doc.get().participant.id !== participant.id) {
    await systemUpdate(doc, (d) => { d.participant = participant }, 'sign in')
  }
  // Undo and redo steps live with the project's UI (doc/undo.ts), so they survive a reload and stay its own.
  keepUndo(doc, { get: () => ui.get().undo ?? { done: [], undone: [] }, set: (s) => ui.update((u) => { u.undo = s }) })

  const runner = new JobRunner(relay, doc, ui)
  runner.stage = () => doc.get().stage.current
  // Landed jobs, and the chains they move on: Draw the rest, Fix it in the shot, Update what follows.
  const frameDeps = { relay, doc, ui, runner }
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
    await index.touch(id, summarise(d, ui.get().jobCtx), { name: autoName(d), changed })
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
  const services: Services = { project, relay, doc, ui, runner, remoteConfig: deps.remoteConfig, clan, storeNote, ownKeys: deps.ownKeys, serverCopy }

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
