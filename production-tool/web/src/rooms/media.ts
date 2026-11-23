// What the rooms' pictures and players share: a file's URL (this browser's copy, else the relay's), whether it
// is a still (the mock makes stills for clips), and a time as the rooms write it.

import { useDoc } from '../app/context'
import { resolveMediaUrl } from '../lib/media'
import { useBlobUrl } from '../ui/hooks'
import { useEffect, useState } from 'react'

/** The URL a take's file plays from: this browser's copy, else the relay's (found by its hash, lib/media.ts). */
export function useAssetUrl(sha: string | undefined): string | undefined {
  const doc = useDoc()
  const local = useBlobUrl(sha)
  const asset = sha ? doc.assets[sha] : undefined
  const [remote, setRemote] = useState<{ sha: string; url: string } | null>(null)
  useEffect(() => {
    let alive = true
    if (!sha || !asset || local) return
    void resolveMediaUrl(asset).then((url) => { if (alive && url) setRemote({ sha, url }) })
    return () => { alive = false }
  }, [sha, asset, local])
  return local ?? (remote && remote.sha === sha ? remote.url : undefined)
}

export function isStill(doc: { assets: Record<string, { mime: string } | undefined> }, sha: string | undefined): boolean {
  return !!sha && !!doc.assets[sha]?.mime.startsWith('image/')
}

/** "0:03.5". */
export const tc = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, '0')}`

/** The Edit room preview's mute, remembered in this browser only (owner 2026-11-18). Unmuted unless chosen. */
export const PREVIEW_MUTE_KEY = 'napkin.production.previewMuted'

export function loadPreviewMuted(read: () => string | null = () => localStorage.getItem(PREVIEW_MUTE_KEY)): boolean {
  try {
    return read() === '1'
  } catch {
    return false
  }
}

export function savePreviewMuted(muted: boolean, write: (v: string) => void = (v) => localStorage.setItem(PREVIEW_MUTE_KEY, v)) {
  try {
    write(muted ? '1' : '0')
  } catch { /* private window: unmuted again next time */ }
}
