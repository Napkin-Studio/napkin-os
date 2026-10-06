import { useEffect, useState } from 'react'
import { blobUrl, cachedBlobUrl } from '../lib/blobs'

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
