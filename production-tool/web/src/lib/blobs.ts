// The local blob store: bytes by content address. Documents hold only hashes
// and locations (idb://sha256/<hex> first); the bytes live here.

import { idbGet, idbPut } from './idb'
import { hexOf, sha256Of } from './hash'

const urls = new Map<string, string>()
const pending = new Map<string, Promise<Blob | undefined>>()
const live = new Map<string, Blob>()

export async function putBlob(blob: Blob): Promise<string> {
  const sha = await sha256Of(blob)
  await putBlobAs(sha, blob)
  return sha
}

export async function putBlobAs(sha: string, blob: Blob): Promise<void> {
  live.set(sha, blob)
  await idbPut('blobs', hexOf(sha), blob)
}

export async function getBlob(sha: string): Promise<Blob | undefined> {
  const hot = live.get(sha)
  if (hot) return hot
  let p = pending.get(sha)
  if (!p) {
    p = idbGet<Blob>('blobs', hexOf(sha)).then((b) => {
      if (b) live.set(sha, b)
      return b
    })
    pending.set(sha, p)
    p.finally(() => pending.delete(sha))
  }
  return p
}

/** An object URL for a hash, cached for the session (never revoked: assets are few and small). */
export async function blobUrl(sha: string): Promise<string | undefined> {
  const cached = urls.get(sha)
  if (cached) return cached
  const blob = await getBlob(sha)
  if (!blob) return undefined
  const url = URL.createObjectURL(blob)
  urls.set(sha, url)
  return url
}

export function cachedBlobUrl(sha: string): string | undefined {
  return urls.get(sha)
}

export function idbLocation(sha: string): string {
  return `idb://sha256/${hexOf(sha)}`
}
