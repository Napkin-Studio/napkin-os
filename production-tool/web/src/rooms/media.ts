// What the rooms' pictures and players share: a file's URL (this browser's copy, else the relay's), whether it
// is a still (the mock makes stills for clips), and a time as the rooms write it.

import { useDoc } from '../app/context'
import { remoteUrl } from '../jobs/assets'
import { useBlobUrl } from '../ui/hooks'

/** The URL a take's file plays from: this browser's copy, else the relay's. */
export function useAssetUrl(sha: string | undefined): string | undefined {
  const doc = useDoc()
  return useBlobUrl(sha) ?? remoteUrl(doc, sha)
}

export function isStill(doc: { assets: Record<string, { mime: string } | undefined> }, sha: string | undefined): boolean {
  return !!sha && !!doc.assets[sha]?.mime.startsWith('image/')
}

/** "0:03.5". */
export const tc = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, '0')}`
