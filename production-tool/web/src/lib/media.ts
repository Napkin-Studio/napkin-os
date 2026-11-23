// Where a picture's bytes are, found from its sha256 alone (features/production-in-library.clan, S1-16).
// A document stores no address: not an idb:// key, not a CloudFront URL, and a document that still carries one
// is not believed. The order is this browser (lib/blobs.ts), then the session's media base (GET /api/session
// `media_base`), then the relay's by-hash route (projects/server.ts `where`).
//
// The media base serves what the relay keeps, under the keys relay/blobs.py writes:
//   in/sha256:<hex>   what an agency uploaded (and every clip or render this tool sent up when it saved)
//   out/sha256:<hex>  what a provider made
// A render, cutdown or patch is made at ads/<jobId>.mp4, which no hash can name: it is reachable from
// another browser only after a save sent it to in/ (serverAssets.sendAssets), so each reader tries both.

import type { DocAsset } from '../contracts/types'
import { hexOf } from './hash'

let base: string | null = null

/** Set from GET /api/session. Absent or not https/http: none (a local relay's files are in this browser anyway). */
export function setMediaBase(b: string | null | undefined) {
  base = b && /^https?:\/\//.test(b) ? b.replace(/\/+$/, '') : null
}
export const mediaBase = () => base

type Prefix = 'in' | 'out'

/** The prefixes to try, the likelier first: made things are out/, brought things in/. */
export function prefixesFor(origin: DocAsset['origin'] | undefined): Prefix[] {
  return origin === 'generated' || origin === 'mock' ? ['out', 'in'] : ['in', 'out']
}

/** Every address the media base could hold this asset at (none without a base). */
export function mediaUrls(a: Pick<DocAsset, 'sha256' | 'origin'>): string[] {
  if (!base) return []
  return prefixesFor(a.origin).map((p) => `${base}/${p}/sha256:${hexOf(a.sha256)}`)
}

const found = new Map<string, string>()

/** The first address that answers for this asset, remembered. null: none does (or no base). */
export async function resolveMediaUrl(a: Pick<DocAsset, 'sha256' | 'origin'>, fetchFn: typeof fetch = (...x) => fetch(...x)): Promise<string | null> {
  const hit = found.get(a.sha256)
  if (hit) return hit
  for (const url of mediaUrls(a)) {
    try {
      const res = await fetchFn(url, { method: 'HEAD' })
      if (res.ok) {
        found.set(a.sha256, url)
        return url
      }
    } catch { /* try the next */ }
  }
  return null
}

/** For tests. */
export function forgetMedia() {
  found.clear()
  base = null
}
