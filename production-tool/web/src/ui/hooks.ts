import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { blobUrl, cachedBlobUrl } from '../lib/blobs'
import { oneAtATime } from '../lib/guard'
import { getTheme, onThemeChange, type Theme } from '../theme'
import { placeFloating, type Anchor, type Rect } from '../lib/place'

/** An object URL for a content hash from the local blob store. */
export function useBlobUrl(sha: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (sha ? cachedBlobUrl(sha) : undefined))
  useEffect(() => {
    let alive = true
    if (!sha) return
    blobUrl(sha).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [sha])
  return sha ? url ?? cachedBlobUrl(sha) : undefined
}

/** A button's send, one at a time (lib/guard.ts): `sending` for its label and disabled state, and
 *  `send(fn)`, which drops a second click made while the first is still going (a double click paid twice). */
export function useSending(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const guard = useRef<ReturnType<typeof oneAtATime> | null>(null)
  const [sending, setSending] = useState(false)
  const send = useCallback(<T,>(fn: () => Promise<T>) => {
    guard.current ??= oneAtATime()
    return guard.current.run(async () => {
      setSending(true)
      try {
        return await fn()
      } finally {
        setSending(false)
      }
    })
  }, [])
  return [sending, send]
}

/** Seconds since an ISO time, ticking once a second. */
export function useElapsed(since: string | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  if (!since) return 0
  return Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
}

export function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

/** Light or dark, following the OS. */
/** The theme the shell's switch picked (theme.ts), for what draws its own colours (Excalidraw). */
export function useColorScheme(): Theme {
  return useSyncExternalStore(onThemeChange, getTheme, () => 'light')
}

/** Whether a media query matches now, kept up to date (phone and tablet layouts, ui-behaviour 2.5). */
export function useMedia(q: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const m = typeof window !== 'undefined' ? window.matchMedia?.(q) : undefined
    m?.addEventListener('change', cb)
    return () => m?.removeEventListener('change', cb)
  }, [q])
  return useSyncExternalStore(subscribe, () => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches, () => false)
}

/** A phone (below 600px wide) gets Phone review; an iPad or a narrow window (below 1180px, or touch) the tablet layout. */
export const PHONE = '(max-width: 599px)'
export const TABLET = '(max-width: 1179px), (pointer: coarse)'

/** Marks canvas chrome a floating bar, popover or card keeps clear of (the boards rail, the top bar, the tool bar). */
export const FLOAT_AVOID = 'data-float-avoid'

/** The chrome marked FLOAT_AVOID, in `box`'s coordinates (where `el`'s left and top are measured), but not `el` itself. */
export function avoidRects(el: HTMLElement, box: HTMLElement | null): Rect[] {
  if (typeof document === 'undefined') return []
  const b = box?.getBoundingClientRect() ?? { left: 0, top: 0 }
  const out: Rect[] = []
  for (const a of document.querySelectorAll<HTMLElement>(`[${FLOAT_AVOID}]`)) {
    if (a.contains(el)) continue
    const r = a.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) out.push({ left: r.left - b.left, top: r.top - b.top, right: r.right - b.left, bottom: r.bottom - b.top })
  }
  return out
}

/**
 * Position a floating element (toolbar, popover) by its anchor, kept fully inside
 * its positioned parent and clear of the canvas chrome (FLOAT_AVOID; ui-behaviour 3.9):
 * measured after layout, so it is placed before it paints.
 */
export function useFloating<T extends HTMLElement>(anchor: Anchor): { ref: React.RefObject<T | null>; style: CSSProperties } {
  const ref = useRef<T>(null)
  const [dims, setDims] = useState<{ w: number; h: number; bw: number; bh: number; avoid: Rect[]; key: string } | null>(null)
  // Every render on purpose: the content (a busy label, an error) changes the size;
  // the comparison inside stops the loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.offsetParent as HTMLElement | null
    const avoid = avoidRects(el, box)
    const next = { w: el.offsetWidth, h: el.offsetHeight, bw: box?.clientWidth ?? window.innerWidth, bh: box?.clientHeight ?? window.innerHeight, avoid }
    const key = JSON.stringify(next)
    if (!dims || key !== dims.key) setDims({ ...next, key })
  })
  if (!dims) return { ref, style: { left: anchor.x, top: anchor.top, visibility: 'hidden' } }
  const p = placeFloating(anchor, { w: dims.w, h: dims.h }, { w: dims.bw, h: dims.bh }, 14, 8, dims.avoid)
  return { ref, style: { left: p.left, top: p.top, transform: 'none' } }
}
