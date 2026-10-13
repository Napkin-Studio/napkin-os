// Whether this person can use the tool, and why not (features/os-sign-in.clan; UI spec 3.15).
// Behind Napkin OS, napkin-web answers /production/api: its own 401 ({signin:true}) means no
// Napkin Studio session, so the page offers Sign in and comes back. The relay's 401
// ({error:{code:'unauthorised'}}) means napkin-web's identity was not accepted: no redirect, so a key
// mismatch can never loop. The relay's 403 flag_off on GET /me means the agency is not switched on.

export type Access = 'ok' | 'signed_out' | 'unconfirmed' | 'not_enabled'

/** What a refused answer means for access; null when it says nothing about who may use the tool.
 *  `onMe`: the answer to GET /me (only there is flag_off the agency's, not a step's switch). */
export function accessOf(status: number, body: unknown, onMe = false): Access | null {
  const b = (body ?? {}) as { signin?: unknown; error?: { code?: unknown } }
  if (status === 401) return b.signin === true ? 'signed_out' : 'unconfirmed'
  if (status === 403 && onMe && b.error?.code === 'flag_off') return 'not_enabled'
  return null
}

/** What the page says for each refusal (UI spec 3.15). */
export const NO_ACCESS: Record<Exclude<Access, 'ok'>, { title: string; body?: string }> = {
  signed_out: { title: 'Sign in to Napkin Studio to use Production' },
  unconfirmed: {
    title: 'We could not confirm who you are',
    body: 'Napkin Studio signed you in, but Production could not confirm it. Reload the page; if this stays, tell the Napkin team.',
  },
  not_enabled: {
    title: 'The Production Tool is not on for your agency yet.',
    body: 'Ask the Napkin team to switch it on for your agency.',
  },
}

/** Napkin OS sign-in, coming back to this same page. */
export function signInHref(loc: { pathname: string; search: string }): string {
  return `/?next=${encodeURIComponent(loc.pathname + loc.search)}`
}

/** Served by napkin-web at /production (same origin, its sign-in): not the standalone mock or local relay. */
export function behindNapkinOs(relayUrl: string | undefined): boolean {
  return !!relayUrl && relayUrl.startsWith('/production')
}

/** Napkin OS sign-out (napkin-web clears its session cookie), then the OS home. */
export async function signOut(fetchFn: typeof fetch = (...a) => fetch(...a), go: (url: string) => void = (u) => location.assign(u)): Promise<void> {
  try {
    await fetchFn('/api/auth/sign-out', { method: 'POST' })
  } catch { /* signed out or not, the OS home shows which */ }
  go('/')
}

/** The current access, outside the persisted UI (a refusal is about now, never the next load). */
export class AccessStore {
  private value: Access = 'ok'
  private readonly subs = new Set<() => void>()

  get = (): Access => this.value

  set(a: Access): void {
    if (a === this.value) return
    this.value = a
    for (const fn of this.subs) fn()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  }
}
