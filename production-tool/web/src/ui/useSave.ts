// Save state, one source (features/topbar-declutter.clan): the canvas bar's status, More's "Save now"
// and Ctrl/Cmd+S (registered once, by SaveKeys in App) read and drive the same store, so the bar's
// words and the menu item always agree. Saving sends the project to the server now (the relay keeps
// it: S3 on AWS, .local-data/clan locally), on top of the save every minute (when something changed) and on a lock.
//
// "saved HH:MM" is the server copy's time, whoever sent it (live test 2026-11-18: the timed and lock
// saves never moved it, and a reload said "not saved yet"): the project index's server mark
// (projects/serverCopy.ts writes it on every post, and it is kept across reloads), or a later Save now.

import { useCallback, useContext, useSyncExternalStore } from 'react'
import { ShellContext, useServices } from '../app/context'
import { errorShown, record } from '../dogfood/recorder'

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'failed'; why: string }

const IDLE: SaveState = { kind: 'idle' }

/** A save store: one state, one save at a time. `owner` ties the state to one project's store. */
export function createSaveStore() {
  let owner: unknown = null
  let state: SaveState = IDLE
  const listeners = new Set<() => void>()
  const set = (s: SaveState) => { state = s; for (const l of listeners) l() }
  return {
    subscribe(l: () => void) { listeners.add(l); return () => void listeners.delete(l) },
    get(of: unknown): SaveState { return of === owner ? state : IDLE },
    /** Runs one save for `of`; a second call while one runs does nothing. */
    async run(of: unknown, task: () => Promise<void>): Promise<SaveState> {
      if (of === owner && state.kind === 'saving') return state
      owner = of
      set({ kind: 'saving' })
      try {
        await task()
        set({ kind: 'saved', at: new Date() })
      } catch (e) {
        set({ kind: 'failed', why: e instanceof Error ? e.message : 'the server did not answer' })
      }
      return state
    },
  }
}

const store = createSaveStore()

/** A save made by another control (the conflict's two choices): through the same store, so the bar follows it
 *  (re-test N-C: after "Save this as a new version" the relay answered 200 and the bar kept "not saved · retry"
 *  until the next Ctrl+S). Throws what the save threw. */
export async function saveThrough(of: unknown, task: () => Promise<unknown>, s = store): Promise<void> {
  let error: unknown
  const r = await s.run(of, async () => {
    try {
      await task()
    } catch (e) {
      error = e
      throw e
    }
  })
  if (r.kind === 'failed') throw error
}

export const saveTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The save state and Save now. `can` is false without the relay and the .clan store (the in-browser
 *  mock, the plain-data fallback): then there is no Save anywhere. */
export function useSave(): { can: boolean; state: SaveState; save: () => Promise<boolean> } {
  const { clan, relay, project, serverCopy } = useServices()
  const index = useContext(ShellContext)?.index
  const manual = useSyncExternalStore(store.subscribe, () => store.get(clan))
  const serverAt = useSyncExternalStore(index ? index.subscribe : noSubscribe, () => index?.get(project.id)?.server?.savedAt ?? null)
  const conflict = useSyncExternalStore(serverCopy ? serverCopy.subscribe : noSubscribe, () => serverCopy?.get()?.message ?? null)
  // A background save that did not land says so, with its reason (UAT acceptance A24), until a save lands: the server
  // refused it, or this browser could not make it.
  const refused = useSyncExternalStore(serverCopy ? serverCopy.subscribe : noSubscribe, () => serverCopy?.refused?.() ?? null)
  const state = merged(manual, serverAt, conflict ?? refused)
  const can = !!clan && relay.kind === 'http'
  const save = useCallback(async () => {
    if (!clan || relay.kind !== 'http') return false
    const start = Date.now()
    const r = await store.run(clan, async () => {
      await clan.flush() // what was just changed goes too
      await clan.clan.mirrorNow('manual')
    })
    if (r.kind === 'saving') return true // one was already on its way
    record('save', 'manual', { ok: r.kind === 'saved', ms: Date.now() - start })
    if (r.kind === 'failed') errorShown('save', r.why)
    return r.kind !== 'failed'
  }, [clan, relay.kind])
  return { can, state, save }
}

const noSubscribe = () => () => {}

/** A Save now that is running or failed says so; a choice waiting (SaveConflict, also as a project opens: re-test
 *  R2) is not saved; otherwise the latest of a Save now and the server copy's time. */
export function merged(manual: SaveState, serverAt: string | null, conflict: string | null = null): SaveState {
  if (manual.kind === 'saving' || manual.kind === 'failed') return manual
  if (conflict) return { kind: 'failed', why: conflict }
  const there = serverAt ? new Date(serverAt) : null
  const at = there && !Number.isNaN(there.getTime()) && (manual.kind !== 'saved' || there > manual.at) ? there : manual.kind === 'saved' ? manual.at : null
  return at ? { kind: 'saved', at } : IDLE
}
