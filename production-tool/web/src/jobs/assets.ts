// Turning local hashes into AssetRefs the relay and providers can read.

import type { AssetRef, InputMime } from '../contracts/types'
import { getBlob } from '../lib/blobs'
import type { Relay } from '../relay'
import { RelayError } from '../relay'

const uploaded = new Map<string, AssetRef>()

export async function assetRef(relay: Relay, sha: string): Promise<AssetRef> {
  const hit = uploaded.get(sha)
  if (hit) return hit
  const blob = await getBlob(sha)
  if (!blob) throw new RelayError({ code: 'invalid_input', message: 'A picture is missing from this browser. Add it again.', retryable: false })
  const mime = (blob.type || 'image/png') as InputMime
  const res = await relay.upload(blob, mime)
  const ref: AssetRef = { sha256: res.sha256, url: res.url, mime }
  uploaded.set(sha, ref)
  return ref
}
