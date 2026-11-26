// A Territories route's picture, found by its hash alone (features/territories-spinoff-out-production.clan). The document holds a
// link, never bytes, so any browser can draw it: this browser's own copy first (lib/blobs.ts), else the session's media base,
// asked by sha256 the way every Production picture is (lib/media.ts resolveMediaUrl, in/ then out/).

import { useEffect, useState } from 'react'
import type { RoutePicture } from '../contracts/types'
import { resolveMediaUrl, workspacePictureUrl } from '../lib/media'
import { useBlobUrl } from '../ui/hooks'

/** A Territories frame the OS host keeps in this workspace's store (the route's own document's picture): its address when it answers. */
async function workspacePicture(sha256: string, fetchFn: typeof fetch = (...x) => fetch(...x)): Promise<string | null> {
  const url = workspacePictureUrl(sha256)
  if (!url) return null
  try { return (await fetchFn(url, { method: 'HEAD', credentials: 'same-origin' })).ok ? url : null } catch { return null }
}

/** `url` once found; `state` says whether the quiet tile is for a picture still loading or one that cannot be found. */
export function useRoutePicture(p: Pick<RoutePicture, 'sha256' | 'rights'>): { url?: string; state: 'loading' | 'found' | 'missing' } {
  const local = useBlobUrl(p.sha256)
  const [remote, setRemote] = useState<{ sha: string; url: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    if (local) return
    void resolveMediaUrl({ sha256: p.sha256, origin: p.rights === 'generated' ? 'generated' : 'uploaded' })
      .then((url) => url ?? workspacePicture(p.sha256))
      .then((url) => alive && setRemote({ sha: p.sha256, url }))
      .catch(() => alive && setRemote({ sha: p.sha256, url: null }))
    return () => { alive = false }
  }, [p.sha256, p.rights, local])
  if (local) return { url: local, state: 'found' }
  if (remote && remote.sha === p.sha256) return remote.url ? { url: remote.url, state: 'found' } : { state: 'missing' }
  return { state: 'loading' }
}
