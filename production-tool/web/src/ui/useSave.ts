// Save state, one source (features/topbar-declutter.clan): the canvas bar's status, More's "Save now"
// and Ctrl/Cmd+S (registered once, by SaveKeys in App) read and drive the same store, so the bar's
// words and the menu item always agree. Saving sends the project to the server now (the relay keeps
// it: S3 on AWS, .local-data/clan locally), on top of the save every 5 minutes and on a lock.

import { useCallback, useSyncExternalStore } from 'react'
import { useServices } from '../app/context'
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

export const saveTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The save state and Save now. `can` is false without the relay and the .clan store (the in-browser
 *  mock, the plain-data fallback): then there is no Save anywhere. */
export function useSave(): { can: boolean; state: SaveState; save: () => Promise<void> } {
  const { clan, relay } = useServices()
  const state = useSyncExternalStore(store.subscribe, () => store.get(clan))
  const can = !!clan && relay.kind === 'http'
  const save = useCallback(async () => {
    if (!clan || relay.kind !== 'http') return
    const start = Date.now()
    const r = await store.run(clan, async () => {
      await clan.flush() // what was just changed goes too
      await clan.clan.mirrorNow('manual')
    })
    if (r.kind === 'saving') return // one was already on its way
    record('save', 'manual', { ok: r.kind === 'saved', ms: Date.now() - start })
    if (r.kind === 'failed') errorShown('save', r.why)
  }, [clan, relay.kind])
  return { can, state, save }
}
