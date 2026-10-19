// The open project's copy on the relay (features/personal-workspaces.clan): what Save, the
// 5-minute save and a lock send (the .clan store's mirror calls `post`).
//
// Each save sends If-Match with the ETag of the copy this browser last saved or opened. When
// someone saved the project since (another browser, another tab, the same name), the relay
// refuses it and nothing is overwritten: the save stops here, `conflict` says so, and the person
// chooses (projects/shell.ts): keep theirs as a copy, or save this as a new version. Until then
// no save goes, so the choice is theirs, never a race.

import type { CanvasSnapshot } from '../canvas/controller'
import type { InputMime, ProductionDocument } from '../contracts/types'
import type { ProjectIndex, ServerMark } from './projectIndex'
import { SaveConflict, type ProjectServer } from './server'
import { sendAssets } from './serverAssets'
import type { ProjectStorage } from './storage'

export interface Conflict {
  /** The relay's message: when it was saved elsewhere. */
  message: string
}

type Reason = 'interval' | 'accept' | 'manual'

export interface ServerCopyDeps {
  id: string
  server: ProjectServer
  index: ProjectIndex
  storage: ProjectStorage
  canvasKey: string
  doc: () => ProductionDocument
  upload: (blob: Blob, mime: InputMime) => Promise<unknown>
  onPosted?: (at: Date) => void
}

export class ServerCopy {
  private readonly d: ServerCopyDeps
  private conflict: Conflict | null = null
  private readonly listeners = new Set<() => void>()

  constructor(deps: ServerCopyDeps) {
    this.d = deps
  }

  get = (): Conflict | null => this.conflict
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** The .clan store's MirrorPost. Throws SaveConflict while a choice is waiting. */
  post = async (bytes: Uint8Array, meta: { reason: Reason }): Promise<void> => {
    const { server, index, id } = this.d
    if (!server.signedIn) return // not signed in: nothing to save to
    if (this.conflict) throw new SaveConflict(this.conflict.message)
    // Pictures first: a project the relay lists must open elsewhere with every one of them.
    await sendAssets(this.d.doc(), this.d.upload)
    const entry = index.get(id)
    let saved
    try {
      saved = await server.save(id, bytes, { reason: meta.reason, ifMatch: entry?.server?.etag, name: entry?.name })
    } catch (e) {
      if (e instanceof SaveConflict) this.set({ message: e.message })
      throw e
    }
    await index.setServer(id, { etag: saved.etag, savedAt: saved.savedAt })
    this.d.onPosted?.(new Date(saved.savedAt))
    await this.sendCanvas().catch((e) => console.warn('could not save the canvas to the server', e))
  }

  /** The canvas as it is kept in this browser, elements only (the pictures come back from the assets). */
  async sendCanvas(): Promise<void> {
    const canvas = await this.d.storage.get<CanvasSnapshot>(this.d.canvasKey)
    if (canvas) await this.d.server.putCanvas(this.d.id, canvas.elements ?? [])
  }

  /** The person chose (shell.ts): saves go again, on top of `theirs`, the copy now on the relay
   *  (null: it has none any more, so the next save needs no If-Match). */
  async settle(theirs: ServerMark | null): Promise<void> {
    await this.d.index.setServer(this.d.id, theirs ?? undefined)
    this.set(null)
  }

  private set(c: Conflict | null) {
    this.conflict = c
    for (const fn of this.listeners) fn()
  }
}
