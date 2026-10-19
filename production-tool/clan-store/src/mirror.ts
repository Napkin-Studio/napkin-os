// A MirrorPost for the relay route proposed in README.md ("Mirror"). The
// route is NOT in the locked contracts yet: until the infra lane exposes it,
// pass your own function to startMirror() instead.
import type { MirrorPost } from './store'

/** `projectId`: the project the bytes are (X-Project-Id), so the relay keeps one copy per project; absent, its per-participant copy.
 *  `onPosted`: called after each post the relay took (the app shows when it last saved). */
export function postClanMirror(opts: { relay: string; token: () => string | null; projectId?: string; onPosted?: (at: Date) => void; fetchFn?: typeof fetch }): MirrorPost {
  const f = opts.fetchFn ?? fetch
  return async (bytes, meta) => {
    const token = opts.token()
    if (!token) return // not signed in: nothing to mirror to
    const resp = await f(`${opts.relay.replace(/\/$/, '')}/clan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.clan+zip',
        Authorization: `Bearer ${token}`,
        'X-Clan-Reason': meta.reason,
        ...(opts.projectId ? { 'X-Project-Id': opts.projectId } : {}),
      },
      body: bytes as unknown as BodyInit,
    })
    if (!resp.ok) throw new Error(`mirror: POST /clan ${resp.status}`)
    opts.onPosted?.(new Date())
  }
}
