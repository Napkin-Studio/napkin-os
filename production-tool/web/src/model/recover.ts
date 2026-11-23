// An edit followed at once by a reload is kept (S1-12). The model store writes a change 250 ms after the last one and
// the store Worker writes it to the browser 300 ms after that; a page that goes inside those 550 ms took the edit
// with it (UAT round 6). So every change also writes, at once and synchronously, what differs from what the browser
// has durably (a merge patch: small), under a key of this project; the write to the browser clears it. Opening
// the project applies what is still there, so the edit is in the working copy before anything else reads it.

export interface Recover {
  /** localStorage's (the only synchronous store a page that is going away can still write). */
  key: string
  store?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}

export const pendingKey = (project: string) => `napkin-production:pending:${project}`

const storeOf = (r: Recover) => {
  if (r.store !== undefined) return r.store
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // blocked storage: the debounced path is all there is
  }
}

export function keepPending(r: Recover, patch: unknown): void {
  const s = storeOf(r)
  if (!s) return
  try {
    if (patch === undefined || (typeof patch === 'object' && patch !== null && Object.keys(patch).length === 0)) s.removeItem(r.key)
    else s.setItem(r.key, JSON.stringify({ patch, at: new Date().toISOString() }))
  } catch { /* over quota: the debounced path is all there is */ }
}

export function takePending(r: Recover): { patch: object; at: string } | null {
  const s = storeOf(r)
  if (!s) return null
  try {
    const raw = s.getItem(r.key)
    if (!raw) return null
    const v = JSON.parse(raw) as { patch?: object; at?: string }
    return v.patch && typeof v.patch === 'object' ? { patch: v.patch, at: v.at ?? '' } : null
  } catch {
    return null
  }
}

export function clearPending(r: Recover): void {
  try { storeOf(r)?.removeItem(r.key) } catch { /* nothing to clear */ }
}
