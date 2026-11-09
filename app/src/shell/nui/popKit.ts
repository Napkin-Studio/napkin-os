// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The popovers' keyboard and their one-at-a-time state (Pop.tsx).

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

const items = (el: HTMLElement | null) =>
  Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [role="menuitem"]:not([aria-disabled="true"])') ?? [])

/** Keyboard inside a menu-like list: arrows, Home, End; Escape closes. */
export function onListKey(e: KeyboardEvent, list: HTMLElement | null, close: () => void) {
  const els = items(list)
  const i = els.indexOf(document.activeElement as HTMLElement)
  const go = (n: number) => { e.preventDefault(); els[(n + els.length) % els.length]?.focus() }
  switch (e.key) {
    case 'ArrowDown': go(i + 1); break
    case 'ArrowUp': go(i - 1); break
    case 'Home': go(0); break
    case 'End': go(els.length - 1); break
    case 'Escape': e.preventDefault(); e.stopPropagation(); close(); break
  }
}

/** One popover open at a time, by name, with its anchor. */
export function usePop<K extends string>() {
  const [open, setOpen] = useState<{ key: K; anchor: HTMLElement } | null>(null)
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open })
  const toggle = useCallback((key: K, anchor: HTMLElement) => setOpen(o => (o?.key === key ? null : { key, anchor })), [])
  const close = useCallback((refocus: boolean) => {
    if (refocus) openRef.current?.anchor.focus()
    setOpen(null)
  }, [])
  return { open, toggle, close, setOpen }
}
