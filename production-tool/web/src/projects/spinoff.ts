// Continue in › New deck from this project (features/production-spinoff.clan): the saved project becomes a Deck
// Maker document in Napkin OS, carried whole, and the shell opens it. The OS does it: its server reads the
// project from the relay through this person's signed identity, drops the canvas checkpoint and spins it off
// with the host's own spin-off (napkin-web src/spinoff.rs). The Production Tool runs at /production on the OS's
// own origin and session, so it calls the shell API directly, as brief/os.ts does; outside the OS (the tool's own
// dev server, the local relay) there is no shell, and this is not offered.
//
//   POST /api/t/{tenant}/production/{project}/spinoff  {target_app_id, title?}  ->  {ok, path: <doc id>, source_uri}

import { pageBriefSource, type BriefSource } from '../brief/os'

export const DECK_APP_ID = 'ie.napkin.deck-maker'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** The OS's own words for why it would not, or ours. */
export class SpinoffError extends Error {}

export interface DeckFromProject {
  /** The new deck's document id in the OS library. */
  docId: string
  /** Where the shell opens it (a full page load, outside the tool). */
  url: string
  /** The source the deck records. */
  sourceUri: string
}

/** Whether this page is served by an OS that can make a deck: its shell API answers who is signed in. */
export function deckOffered(src: BriefSource = pageBriefSource()): Promise<boolean> {
  return src.available()
}

/**
 * Spin the project (the relay's project id, which is the project's id in this browser too) off into a Deck Maker
 * document. The project must be saved: the caller saves first, and the OS reads the relay's copy.
 */
export async function newDeckFromProject(projectId: string, opts: { title?: string; base?: string; fetcher?: Fetch; src?: BriefSource } = {}): Promise<DeckFromProject> {
  const base = opts.base ?? ''
  const fetcher: Fetch = opts.fetcher ?? ((i, init) => fetch(i, init))
  const src = opts.src ?? pageBriefSource()
  const session = await fetcher(`${base}/api/session`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
  const tenant = session.ok ? ((await session.json()) as { tenant?: unknown }).tenant : null
  if (typeof tenant !== 'string') throw new SpinoffError('A deck is made in Napkin, and this page is not signed in to it.')
  const r = await fetcher(`${base}/api/t/${encodeURIComponent(tenant)}/production/${encodeURIComponent(projectId)}/spinoff`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ target_app_id: DECK_APP_ID, ...(opts.title ? { title: opts.title } : {}) }),
  })
  if (!r.ok) {
    let why = ''
    try {
      why = String(((await r.json()) as { error?: unknown }).error ?? '')
    } catch { /* not JSON */ }
    // The same 404 says the app is not installed (the target tool is missing here) or the project is not found.
    if (r.status === 404 && /not installed/i.test(why)) throw new SpinoffError('Deck Maker is not installed here, so a deck cannot be made from this project.')
    throw new SpinoffError(r.status === 404 ? 'Napkin could not find the saved project. Save it, then try again.' : why || `Napkin answered ${r.status}.`)
  }
  const v = (await r.json()) as { path?: unknown; source_uri?: unknown }
  if (typeof v.path !== 'string' || !v.path) throw new SpinoffError('Napkin made the deck but did not say where it is.')
  return { docId: v.path, url: src.openUrl(v.path), sourceUri: typeof v.source_uri === 'string' ? v.source_uri : '' }
}
