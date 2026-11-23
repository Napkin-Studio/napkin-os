// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one Trash for every tool (production-clan-app.md 8a): a document is moved to it from a client page or a
// tool's own menu, listed there for 30 days, and moved back. This is the state behind the client page's Trash
// link, the Trash page and the "Moved to Trash / Restored · Undo" toast: a small store, so what it does is
// tested without a browser.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TrashApi, TrashItem } from '../../host/types'
import { toolOfApp } from '../landing/tools'

export const RETAIN_DAYS = 30
const DAY = 86_400_000

/** "today", "yesterday", "3 days ago": when it was deleted. */
export function agoWords(trashedAt: string, now = Date.now()): string {
  const d = Math.max(0, Math.floor((now - new Date(trashedAt).getTime()) / DAY))
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/** Whole days left to restore it (never below 0). */
export function daysLeft(restorableUntil: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(restorableUntil).getTime() - now) / DAY))
}

/** "Deleted 3 days ago by Aoife · restorable for 27 more days". */
export function trashLine(r: Pick<TrashItem, 'trashed_at' | 'restorable_until' | 'by'>, now = Date.now()): string {
  const left = daysLeft(r.restorable_until, now)
  return `Deleted ${agoWords(r.trashed_at, now)}${r.by ? ` by ${r.by}` : ''} · restorable for ${left} more ${left === 1 ? 'day' : 'days'}`
}

/** The tool a deleted document came from, for its icon: Production's app id is its tool too (toolOfApp). */
export const trashIcon = (appId: string | null): 'brief' | 'research' | 'deck' | 'production' => {
  const t = toolOfApp(appId)
  return t?.id === 'brief' || t?.id === 'research' || t?.id === 'deck' ? t.id : 'production'
}

export interface TrashToast { text: string; undo: () => void }
export interface TrashState { rows: TrashItem[]; toast: TrashToast | null; error: string | null; loaded: boolean }

export class TrashDesk {
  private state: TrashState = { rows: [], toast: null, error: null, loaded: false }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null

  /** `scope` is the client whose Trash this is (null: the agency's, all of it); `changed` re-reads the library after a move. */
  private readonly api: TrashApi
  private readonly scope: string | null
  private readonly changed: () => Promise<void>
  constructor(api: TrashApi, scope: string | null, changed: () => Promise<void>) {
    this.api = api
    this.scope = scope
    this.changed = changed
  }

  get = (): TrashState => this.state
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private set(p: Partial<TrashState>) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()) }

  async reload(): Promise<void> {
    try { this.set({ rows: await this.api.list(this.scope), loaded: true }) } catch { this.set({ loaded: true }) }
  }

  dismiss(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.set({ toast: null })
  }

  private say(text: string, undo: () => void): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), 9000)
    this.set({ toast: { text, undo } })
  }

  /** Move a document to the Trash. Resolves false (and says why) when the host refused. */
  async move(path: string): Promise<boolean> {
    try { await this.api.move(path) } catch (e) { this.set({ error: words(e, 'Could not move it to the Trash.') }); return false }
    this.set({ error: null })
    await Promise.all([this.reload(), this.changed()])
    this.say('Moved to Trash', () => { void this.restore(path, false) })
    return true
  }

  /** Bring a document back to its section. The toast's Undo moves it to the Trash again. */
  async restore(path: string, toast = true): Promise<boolean> {
    try { await this.api.restore(path) } catch (e) { this.set({ error: words(e, 'Could not restore it.') }); return false }
    this.set({ error: null })
    await Promise.all([this.reload(), this.changed()])
    if (toast) this.say('Restored', () => { void this.moveAgain(path) })
    else this.dismiss()
    return true
  }

  private async moveAgain(path: string): Promise<void> {
    try { await this.api.move(path) } catch (e) { this.set({ error: words(e, 'Could not move it to the Trash.') }); return }
    this.dismiss()
    await Promise.all([this.reload(), this.changed()])
  }
}

const words = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** One Trash desk for a scope, read once on arrival. Undefined where the host has no Trash. */
export function useTrashDesk(api: TrashApi | undefined, scope: string | null, changed: () => Promise<void>): { desk: TrashDesk; state: TrashState } | null {
  const desk = useMemo(() => (api ? new TrashDesk(api, scope, changed) : null), [api, scope, changed])
  useEffect(() => { void desk?.reload(); return () => desk?.dismiss() }, [desk])
  const empty = useMemo(() => new TrashDesk({ list: async () => [], move: async () => {}, restore: async () => {} }, null, async () => {}), [])
  const state = useSyncExternalStore((desk ?? empty).subscribe, (desk ?? empty).get)
  return desk ? { desk, state } : null
}
