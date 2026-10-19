import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { blobUrl, cachedBlobUrl } from '../lib/blobs'
import { oneAtATime } from '../lib/guard'
import { placeFloating, type Anchor } from '../lib/place'

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
export function useColorScheme(): 'light' | 'dark' {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const fn = (e: MediaQueryListEvent) => setDark(e.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return dark ? 'dark' : 'light'
}

/**
 * Position a floating element (toolbar, popover) by its anchor, kept fully inside
 * its positioned parent: measured after layout, so it is placed before it paints.
 */
export function useFloating<T extends HTMLElement>(anchor: Anchor): { ref: React.RefObject<T | null>; style: CSSProperties } {
  const ref = useRef<T>(null)
  const [dims, setDims] = useState<{ w: number; h: number; bw: number; bh: number } | null>(null)
  // Every render on purpose: the content (a busy label, an error) changes the size;
  // the comparison inside stops the loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.offsetParent as HTMLElement | null
    const next = { w: el.offsetWidth, h: el.offsetHeight, bw: box?.clientWidth ?? window.innerWidth, bh: box?.clientHeight ?? window.innerHeight }
    if (!dims || next.w !== dims.w || next.h !== dims.h || next.bw !== dims.bw || next.bh !== dims.bh) setDims(next)
  })
  if (!dims) return { ref, style: { left: anchor.x, top: anchor.top, visibility: 'hidden' } }
  const p = placeFloating(anchor, { w: dims.w, h: dims.h }, { w: dims.bw, h: dims.bh })
  return { ref, style: { left: p.left, top: p.top, transform: 'none' } }
}
