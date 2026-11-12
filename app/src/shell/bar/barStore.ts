// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The bar's state, outside React so the field (drawn inside the OS bar, by whichever Toolbar is on screen)
// and the panel (mounted once, beside the shell's overlays) share it without a prop passing through both
// trees: whether it is open, what was typed, which result is active, where focus goes back to.

import { useSyncExternalStore } from 'react'

export interface BarState {
  open: boolean
  /** The shortcuts sheet is showing. */
  shortcuts: boolean
  query: string
  /** A person's card is showing in place of the results. */
  card: { name: string; line: string; jobs: string[] } | null
  /** The id of the active result, for aria-activedescendant. */
  activeId: string | null
  /** Bumped when the field should take focus (Cmd K while it is already open). */
  focusTick: number
  /** The open document's undo and redo, when it has any (registered by the host of the document). */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void } | null
}

let state: BarState = { open: false, shortcuts: false, query: '', card: null, activeId: null, focusTick: 0, history: null }
const listeners = new Set<() => void>()
/** Where focus was when the bar opened: Escape puts it back there. */
let returnTo: HTMLElement | null = null
/** The panel's key handler, registered by BarMount: the field's input hands its keys here. */
let keyHandler: ((e: { key: string; preventDefault: () => void; nativeEvent?: unknown }) => void) | null = null

function set(patch: Partial<BarState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export const getBar = (): BarState => state
export const subscribeBar = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useBar = (): BarState => useSyncExternalStore(subscribeBar, getBar, getBar)

const focused = (): HTMLElement | null => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null))
const here = (el: Element | null | undefined): HTMLElement | null => (el instanceof HTMLElement && el !== document.body ? el : null)

/** Open the bar. `from` is where focus was (a click on the field says so); else the focused element. */
export function openBar(from?: Element | null) {
  if (state.open) { set({ focusTick: state.focusTick + 1, shortcuts: false }); return }
  returnTo = here(from) ?? here(focused())
  set({ open: true, shortcuts: false, focusTick: state.focusTick + 1 })
}

/** Close it and clear what was typed; give focus back to where it was unless the caller is navigating away. */
export function closeBar(refocus = true) {
  const back = returnTo
  returnTo = null
  set({ open: false, shortcuts: false, query: '', card: null, activeId: null })
  if (refocus && back?.isConnected) back.focus({ preventScroll: true })
  else if (!refocus) return
  else (focused() as HTMLElement | null)?.blur?.()
}

export function openShortcuts() {
  if (!state.open && !state.shortcuts) returnTo = here(focused())
  set({ shortcuts: true, open: false })
}

export function closeShortcuts(refocus = true) {
  const back = returnTo
  returnTo = null
  set({ shortcuts: false })
  if (refocus && back?.isConnected) back.focus({ preventScroll: true })
}

export const setQuery = (query: string) => set({ query })
export const setCard = (card: BarState['card']) => set({ card })
export const setActiveId = (activeId: string | null) => { if (state.activeId !== activeId) set({ activeId }) }
export const setHistory = (history: BarState['history']) => set({ history })

export function setKeyHandler(h: typeof keyHandler) { keyHandler = h }
export function handleFieldKey(e: { key: string; preventDefault: () => void }) { keyHandler?.(e) }
