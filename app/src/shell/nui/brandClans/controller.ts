// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the client window's Brand Clans section is doing: which screen it
// shows (the list, a Brand Bible, an edit, a draft, the publish confirm,
// the history, an old version, a new version to review), the candidate being
// edited, and the one thing it never does on its own: it never updates a work
// document. `updateWork` is called only by the press of an Update chip.

import type { BrandBible, BrandBehind, BrandClanList, BrandClanView, BrandHistoryEntry } from '../../../host/types'
import type { BrandApi } from '../../../host/brandClans'
import { bibleOf, changesSince } from './model'

export type Screen = 'list' | 'bible' | 'edit' | 'draft' | 'confirm' | 'history' | 'old' | 'changes'

export interface BrandState {
  list: BrandClanList | null
  loading: boolean
  /** The host's own words for the last refusal. */
  error: string | null
  screen: Screen
  view: BrandClanView | null
  history: BrandHistoryEntry[] | null
  /** The bible being edited (the `edit` screen). */
  candidate: BrandBible | null
  /** The version just published, until the person leaves it. */
  published: { name: string; version: number } | null
  /** Which waiting changes a person takes (the `changes` screen); every id is in, taken by default. */
  taken: Record<string, boolean>
  busy: boolean
  /** Adding a Brand Clan by hand: the name form. */
  adding: boolean
}

const START: BrandState = {
  list: null, loading: false, error: null, screen: 'list', view: null, history: null,
  candidate: null, published: null, taken: {}, busy: false, adding: false,
}

export class BrandClansController {
  private state: BrandState = START
  private readonly subs = new Set<() => void>()
  readonly api: BrandApi
  readonly clientId: string
  constructor(api: BrandApi, clientId: string) { this.api = api; this.clientId = clientId }

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f) } }
  snapshot = () => this.state
  private set(p: Partial<BrandState>) { this.state = { ...this.state, ...p }; this.subs.forEach(f => f()) }

  private async run<T>(f: () => Promise<T>): Promise<T | null> {
    this.set({ busy: true, error: null })
    try { return await f() } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
      return null
    } finally { this.set({ busy: false }) }
  }

  /** The list and the work that is behind. Safe to call any time. */
  async load() {
    this.set({ loading: true })
    try { this.set({ list: await this.api.list(this.clientId), error: null }) } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    } finally { this.set({ loading: false }) }
  }

  private async refresh() { try { this.set({ list: await this.api.list(this.clientId) }) } catch { /* the list shows what it had */ } }

  private show(view: BrandClanView, screen?: Screen) {
    // A draft is offered from the published view (a banner), never opened over it.
    const s: Screen = screen ?? (view.pending ? 'changes' : 'bible')
    const taken = s === 'changes' ? Object.fromEntries((view.pending?.changes ?? []).map(c => [c.id, true])) : this.state.taken
    this.set({ view, screen: s, taken, candidate: null })
  }

  async open(path: string) {
    const v = await this.run(() => this.api.get(path))
    if (v) { this.set({ published: null }); this.show(v) }
  }
  async back() {
    this.set({ screen: 'list', view: null, candidate: null, history: null, published: null, adding: false, error: null })
    await this.refresh()
  }

  // ── Editing ───────────────────────────────────────────────────────────────
  startEdit() {
    const v = this.state.view
    if (!v || v.readonly) return
    this.set({ screen: 'edit', candidate: v.draft ? structuredClone(v.draft.candidate) : bibleOf(v.data), published: null, error: null })
  }
  edit(f: (c: BrandBible) => BrandBible) {
    if (this.state.screen === 'edit' && this.state.candidate) this.set({ candidate: f(this.state.candidate) })
  }
  cancelEdit() {
    const v = this.state.view
    this.set({ screen: v?.draft ? 'draft' : 'bible', candidate: null, error: null })
  }
  async saveDraft() {
    const { view, candidate } = this.state
    if (!view || !candidate) return
    const v = await this.run(() => this.api.saveDraft(view.path, candidate, view.version))
    if (v) { this.show(v, v.draft ? 'draft' : 'bible'); await this.refresh() }
  }
  async discard() {
    const view = this.state.view
    if (!view) return
    const v = await this.run(() => this.api.discardDraft(view.path))
    if (v) { this.show(v, 'bible'); await this.refresh() }
  }
  confirm() { if (this.state.view?.draft) this.set({ screen: 'confirm', error: null }) }
  unconfirm() { this.set({ screen: 'draft', error: null }) }
  async publish() {
    const view = this.state.view
    if (!view?.draft) return
    const v = await this.run(() => this.api.publish(view.path, view.version))
    if (v) { this.show(v, 'bible'); this.set({ published: { name: v.name, version: v.version } }); await this.refresh() }
  }

  // ── History and old versions ──────────────────────────────────────────────
  async showHistory() {
    const view = this.state.view
    if (!view) return
    const h = await this.run(() => this.api.history(view.path))
    if (h) this.set({ history: h, screen: 'history', published: null })
  }
  async openVersion(version: number) {
    const view = this.state.view
    if (!view) return
    const v = await this.run(() => this.api.get(view.path, version))
    if (v) this.set({ view: { ...v, draft: view.draft, pending: view.pending }, screen: 'old', published: null })
  }
  /** Back from an old version or the history to the Brand Clan as it stands. */
  async closeHistory() { const v = this.state.view; if (v) { const now = await this.run(() => this.api.get(v.path)); if (now) this.show(now, 'bible') } }
  backToHistory() { this.set({ screen: 'history', error: null }) }
  async startDraftFrom(version: number) {
    const view = this.state.view
    if (!view) return
    const v = await this.run(() => this.api.startDraft(view.path, version))
    if (v) { this.show(v, 'draft'); await this.refresh() }
  }

  // ── A new version waiting ─────────────────────────────────────────────────
  toggle(id: string, on: boolean) { this.set({ taken: { ...this.state.taken, [id]: on } }) }
  async accept() {
    const { view, taken } = this.state
    if (!view?.pending) return
    const ids = view.pending.changes.filter(c => taken[c.id]).map(c => c.id)
    if (!ids.length) return
    const all = ids.length === view.pending.changes.length
    const v = await this.run(() => this.api.accept(view.path, all ? 'all' : ids, view.version))
    if (v) { this.show(v, 'bible'); this.set({ published: { name: v.name, version: v.version } }); await this.refresh() }
  }
  async keepOld() {
    const view = this.state.view
    if (!view) return
    const v = await this.run(() => this.api.keep(view.path))
    if (v) { this.show(v, 'bible'); await this.refresh() }
  }

  // ── The default, a new one ────────────────────────────────────────────────
  async makeDefault(documentId: string) {
    const r = await this.run(() => this.api.setDefault(this.clientId, documentId))
    if (r) {
      await this.refresh()
      const v = this.state.view
      if (v && v.document_id === documentId) this.set({ view: { ...v, default: true } })
    }
  }
  startAdding() { this.set({ adding: true, error: null }) }
  stopAdding() { this.set({ adding: false, error: null }) }
  async create(name: string) {
    const v = await this.run(() => this.api.create(this.clientId, name))
    if (v) { this.set({ adding: false }); this.show(v, 'bible'); await this.refresh() }
  }
  async putAsset(file: { name: string; bytes: Uint8Array }): Promise<string | null> {
    const view = this.state.view
    if (!view) return null
    const r = await this.run(() => this.api.putAsset(view.path, file.name, file.bytes))
    return r ? r.path : null
  }

  // ── The Update chip ───────────────────────────────────────────────────────
  /** What changed since `behind.held`, for the chip's list. Reads only. */
  async whatChanged(behind: BrandBehind) {
    const item = this.state.list?.items.find(i => i.document_id === behind.brand_clan)
    if (!item) return []
    return changesSince(await this.api.history(item.path), behind.held)
  }
  /** The press. The only call that writes into a work document. */
  async update(behind: BrandBehind): Promise<boolean> {
    const item = this.state.list?.items.find(i => i.document_id === behind.brand_clan)
    if (!item) return false
    const r = await this.run(() => this.api.updateWork(item.path, behind.path))
    await this.refresh()
    return r !== null
  }
}
