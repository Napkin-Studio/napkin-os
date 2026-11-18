// A page shown over the canvas without a bar of its own (the Sizes overview): it names itself here, so the
// canvas's bar reads "› Canvas › Sizes" with Canvas a link that closes it (Shrey 2026-11-19: the crumb is
// always "› Canvas › <this page>", and Canvas always takes you back).

import { useEffect, useRef, useSyncExternalStore } from 'react'

export interface CanvasPage { label: string; close: () => void }

let page: CanvasPage | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

/** While mounted, this page is what the canvas's bar shows past Canvas; `close` is what Canvas does. */
export function useCanvasPage(label: string, close: () => void) {
  const latest = useRef(close)
  useEffect(() => { latest.current = close })
  useEffect(() => {
    const me: CanvasPage = { label, close: () => latest.current() }
    page = me
    emit()
    return () => {
      if (page === me) { page = null; emit() }
    }
  }, [label])
}

/** The page over the canvas now, if any. */
export function useCurrentCanvasPage(): CanvasPage | null {
  return useSyncExternalStore(subscribe, () => page, () => null)
}
