// Which master the Make all sizes sheet is open for (one at a time), and the Campaign board's view
// choices this browser keeps (safe areas shown). A tiny store for useSyncExternalStore.

import type { MasterInfo } from './master'

export interface SheetOpen { master: MasterInfo; nearId?: string }

let open: SheetOpen | null = null
let safeAreas = true
const subs = new Set<() => void>()
const emit = () => { for (const f of subs) f() }

export const campaignSheet = {
  subscribe(fn: () => void) {
    subs.add(fn)
    return () => { subs.delete(fn) }
  },
  get: () => open,
  open(o: SheetOpen) {
    open = o
    emit()
  },
  close() {
    open = null
    emit()
  },
  safeAreas: () => safeAreas,
  toggleSafeAreas() {
    safeAreas = !safeAreas
    emit()
  },
}
