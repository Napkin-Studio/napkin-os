// The open project's copy in the library (features/production-in-library.clan): what Save, the
// minute save and a lock send (the .clan store's mirror calls `post`).
//
// Each save sends If-Match with the ETag of the relay's version THIS TAB's document is based on: the one
// it opened, its own last save, or the one it took when the person chose in a conflict (re-test R1,
// 2026-11-18: the index's mark is this browser's newest, shared by every tab, so a stale tab sent
// another tab's mark and the relay took its stale copy over that tab's save). When someone saved the
// project since (another browser, another tab, the same name), the relay refuses it and nothing is
// overwritten: the save stops here, `conflict` says so, and the person chooses (projects/shell.ts):
// keep theirs as a copy, or save this as a new version. Until then no save goes, so the choice is
// theirs, never a race.
//
// The index's mark (projectIndex.ts) stays this browser's newest, for "saved HH:MM" and Home; it is
// never a tab's If-Match. What this browser's own copy is based on, and whether it changed since, is
// kept under base:<id> (LocalBase), so opening it can tell a newer save elsewhere from local work
// (re-test R2, shell.ts `open`).

import type { InputMime, ProductionDocument } from '../contracts/types'
import { sha256Hex } from '../lib/hash'
import type { ProjectIndex, ServerMark } from './projectIndex'
import { RelayError } from '../relay'
import { SaveConflict, type ProjectServer } from './server'
import { sendAssets } from './serverAssets'
import { baseKeyFor, type ProjectStorage } from './storage'

/** What this browser's copy of a project is based on: the relay's version it was opened from or last saved
 *  as (null: none), and whether it has changes the relay does not have. Written by the tab whose copy it is. */
export interface LocalBase {
  mark: ServerMark | null
  unsaved: boolean
  /** The saves this browser sent and had no answer to (newest last, at most UNANSWERED): each one's etag, and
   *  whether this browser changed the project after it went. A page closed while one went (UAT 2026-11-18, U7: a
   *  browser killed mid-save reopened to a conflict with its own save) finds the relay's newest among them: its
   *  own save, so its base. */
  unanswered?: Unanswered[]
}

export interface Unanswered { etag: string; edited: boolean }
/** How many unanswered saves are remembered (a close-time save that failed after one that landed, and so on). */
const UNANSWERED = 4

/** The copy's base as kept, else (a copy kept before there was one) the index's mark, with changes assumed:
 *  never taken as clean without knowing. */
export async function readBase(storage: ProjectStorage, index: ProjectIndex, id: string): Promise<LocalBase> {
  const kept = await storage.get<LocalBase>(baseKeyFor(id)).catch(() => undefined)
  return kept ?? { mark: index.get(id)?.server ?? null, unsaved: true }
}

export interface Conflict {
  /** The relay's message: when it was saved elsewhere. */
  message: string
}

// The mirror's reasons are the host's X-Clan-Reason values as they are (handoff, export and landing take a snapshot too).
type Reason = 'interval' | 'accept' | 'manual' | 'handoff' | 'export' | 'landing'

export interface ServerCopyDeps {
  id: string
  server: ProjectServer
  index: ProjectIndex
  storage: ProjectStorage
  doc: () => ProductionDocument
  upload: (blob: Blob, mime: InputMime) => Promise<unknown>
  onPosted?: (at: Date) => void
  /** What this tab's document is based on as it opens (readBase). */
  base: LocalBase
}

export class ServerCopy {
  private readonly d: ServerCopyDeps
  private conflict: Conflict | null = null
  private readonly listeners = new Set<() => void>()
  /** The relay's version this tab's document is based on: its If-Match. */
  private base: ServerMark | null
  /** Changes made in this tab (document and canvas), counted: a save knows if more came while it went. */
  private edits = 0
  private noting: Promise<void> | null = null
  private toNote: LocalBase | null = null
  /** Saves on their way or never answered (LocalBase.unanswered), noted with the base until one is answered. */
  private unanswered: Unanswered[] = []

  constructor(deps: ServerCopyDeps) {
    this.d = deps
    this.base = deps.base.mark
    // Saves an earlier page of this browser sent and never heard back about (it reloaded as they went) are this tab's
    // own still (UAT round 5, R5-F7: a reload's save went with the old base and was refused as "somewhere else").
    this.unanswered = (deps.base.unanswered ?? []).map((u) => ({ ...u }))
    this.sent = this.unanswered.map((u) => u.etag)
    this.inherited = new Set(this.sent)
  }

  /** The etags of saves an earlier page sent with no answer: before sending one of them again, ask the relay first. */
  private readonly inherited: Set<string>

  get = (): Conflict | null => this.conflict
  /** Why the last save did not land, in words for the bar, until a save lands: the server refused it (UAT acceptance
   *  A24: 37 saves were refused and the bar kept "saved 03:57 AM"), or this browser could not make it (A24 re-test: the
   *  store Worker could not, and the bar kept "saved 09:45 AM"). Unlike a conflict it holds nothing back: the next
   *  save goes as usual. */
  refused = (): string | null => this.refusal
  private refusal: string | null = null
  /** The relay's version this tab's document is based on (null: none known). */
  basedOn = (): ServerMark | null => this.base

  /** Something changed in this tab's project (its document or its canvas): this browser's copy now has work the
   *  relay lacks, on top of this tab's base. Written at once, so a reload knows (one small local write, coalesced). */
  edited = () => {
    this.edits++
    for (const u of this.unanswered) u.edited = true
    this.note(true)
  }

  /** A save this browser could not make (clan-store onSaveError): nothing reached the server, so the bar says
   *  "not saved" with the reason until a save lands. */
  unsaved(message: string, where: 'browser' | 'server') {
    this.refusal = where === 'server' ? `This project could not be saved: ${message}` : `This browser could not keep the project: ${message}`
    for (const fn of this.listeners) fn()
  }

  /** A newer version is on the relay and this browser's copy has work of its own (shell.ts `open`, re-test R2):
   *  the choice is asked for before any save, as a refused save would. */
  hold(message: string) {
    this.set({ message })
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Saves on their way, one at a time: each goes on the base the one before it left (UAT 2026-11-21, F1: two saves
   *  0.24 s apart both sent the old base, and the relay refused the second as someone else's save). */
  private queue: Promise<unknown> = Promise.resolve()
  /** The versions this tab sent (newest last), and an earlier page's unanswered ones: a refusal whose newer copy is
   *  one of ours is not a conflict. */
  private sent: string[] = []

  /** The .clan store's MirrorPost. Throws SaveConflict while a choice is waiting. */
  post = (bytes: Uint8Array, meta: { reason: Reason }): Promise<void> => {
    const run = this.queue.then(() => this.postNow(bytes, meta), () => this.postNow(bytes, meta))
    this.queue = run.catch(() => {})
    return run
  }

  private postNow = async (bytes: Uint8Array, meta: { reason: Reason }, again = false): Promise<void> => {
    const { server, id } = this.d
    if (!server.signedIn) return // not signed in: nothing to save to
    if (this.conflict) throw new SaveConflict(this.conflict.message)
    // Pictures first: a project the relay lists must open elsewhere with every one of them.
    const edits = this.edits
    await sendAssets(this.d.doc(), this.d.upload)
    const etag = await sha256Hex(bytes)
    // The same bytes as the version this tab is based on: nothing new to send (two save moments at once).
    if (this.base?.etag === etag) return
    // No base: never a blind save over a copy the relay has (re-test N3: a lost mark sent a save with no
    // If-Match, and the relay took it). The same bytes: that is the base. Others: the person chooses.
    if (!this.base) {
      const there = await server.version(id)
      if (there) {
        if (there.etag === etag) {
          await this.based({ etag: there.etag, savedAt: there.savedAt }, this.edits !== edits)
          return
        }
        const message = `This project was saved on the server at ${new Date(there.savedAt).toLocaleString()}, and this browser does not know that copy.`
        this.set({ message })
        throw new SaveConflict(message)
      }
    }
    // These very bytes went from an earlier page whose answer never came (R5-F7): when the relay has them, they are the
    // base, and nothing goes (no refused save, no banner).
    if (this.inherited.has(etag)) {
      this.inherited.delete(etag)
      const there = await server.version(id).catch(() => null)
      if (there?.etag === etag) {
        this.unanswered = this.unanswered.filter((u) => u.etag !== etag)
        await this.based({ etag: there.etag, savedAt: there.savedAt }, this.edits !== edits)
        return
      }
    }
    // Noted before it goes (not awaited: the save never waits on it), so a page closed before the answer can
    // tell its own save from someone else's when it opens again (shell.ts newerThere).
    const went: Unanswered = { etag, edited: this.edits !== edits }
    for (const u of this.unanswered) u.edited ||= u.etag !== etag
    this.unanswered = [...this.unanswered.filter((u) => u.etag !== etag), went].slice(-UNANSWERED)
    this.note(true)
    this.sent = [...this.sent.filter((x) => x !== etag), etag].slice(-8)
    let saved
    try {
      saved = await server.save(id, bytes, { reason: meta.reason, ifMatch: this.base?.etag })
    } catch (e) {
      // Refused: it did not land. Any other failure (the network went with the answer) may have landed, so
      // what went stays noted for the next open to recognise.
      if (e instanceof SaveConflict) {
        this.unanswered = this.unanswered.filter((u) => u !== went)
        this.note(true)
        // The newer copy on the relay is one this tab sent (its answer was lost, or two of ours crossed): that is our
        // base, and this save goes again on it. Never the "another browser" banner for our own save (F1).
        const there = again ? undefined : e.latest ? { etag: e.latest, savedAt: new Date().toISOString() } : (await server.version(id).catch(() => null)) ?? undefined
        // The relay holds these very bytes (an earlier page's save, or a twin of this one): that is the base, and this
        // save has nothing to add (R5-F7).
        if (there && there.etag === etag) {
          await this.based({ etag: there.etag, savedAt: there.savedAt }, this.edits !== edits)
          return
        }
        if (there && this.sent.includes(there.etag)) {
          await this.based({ etag: there.etag, savedAt: there.savedAt }, true)
          return this.postNow(bytes, meta, true)
        }
        this.set({ message: e.message })
      } else if (e instanceof RelayError && e.status >= 400 && e.status < 500) {
        // Refused outright (not a conflict): it did not land, so the bar must not keep an older "saved".
        this.unanswered = this.unanswered.filter((u) => u !== went)
        this.note(true)
        this.refusal = `The server did not take the last save: ${e.message}`
        for (const fn of this.listeners) fn()
      }
      throw e
    }
    if (this.refusal) {
      this.refusal = null
      for (const fn of this.listeners) fn()
    }
    this.unanswered = []
    await this.based({ etag: saved.etag, savedAt: saved.savedAt }, this.edits !== edits)
    this.d.onPosted?.(new Date(saved.savedAt))
  }

  /** The person chose (shell.ts): saves go again, on top of `theirs`, the copy now on the relay
   *  (null: it has none any more, so the next save needs no If-Match). */
  async settle(theirs: ServerMark | null): Promise<void> {
    this.base = theirs
    await this.d.index.setServer(this.d.id, theirs ?? undefined)
    // This tab's work is not on the relay yet: it goes on top of theirs with the save that follows.
    this.note(true)
    await this.noted()
    this.set(null)
  }

  /** This tab's document is now based on `mark` (`unsaved`: and changed since): the browser's index learns the
   *  mark (it only moves forward), and this browser's copy records its base. */
  private async based(mark: ServerMark, unsaved: boolean) {
    this.base = mark
    await this.d.index.setServer(this.d.id, mark)
    this.note(unsaved)
    await this.noted()
  }

  /** Write this tab's base (the newest wanted one; one write at a time). */
  private note(unsaved: boolean) {
    this.toNote = { mark: this.base, unsaved, ...(this.unanswered.length ? { unanswered: this.unanswered.map((u) => ({ ...u })) } : {}) }
    this.noting ??= (async () => {
      while (this.toNote) {
        const v = this.toNote
        this.toNote = null
        await this.d.storage.put(baseKeyFor(this.d.id), v).catch(() => {})
      }
      this.noting = null
    })()
  }

  private noted(): Promise<void> {
    return this.noting ?? Promise.resolve()
  }

  private set(c: Conflict | null) {
    this.conflict = c
    for (const fn of this.listeners) fn()
  }
}
