// Continue in › New deck from this project: the project, a document of the library, becomes a Deck Maker
// document, carried whole, and the shell opens it. This is the OS's one plain spin-off (the same call every tool
// makes), on the page's own origin and session; outside the OS (the tool's own dev server, the local relay) there
// is no shell, and this is not offered.
//
//   POST /api/t/{tenant}/d/{doc}/spinoff  {app_id, title?}  ->  OpenView {path: <new doc id>, ...}

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
}

/** Whether this page is served by an OS that can make a deck: its shell API answers who is signed in. */
export function deckOffered(src: BriefSource = pageBriefSource()): Promise<boolean> {
  return src.available()
}

/**
 * Spin the project (its library document id) off into a Deck Maker document. The project must be saved: the
 * caller saves first, and the OS reads the library's copy.
 */
export async function newDeckFromProject(docId: string, opts: { title?: string; base?: string; fetcher?: Fetch; src?: BriefSource } = {}): Promise<DeckFromProject> {
  const base = opts.base ?? ''
  const fetcher: Fetch = opts.fetcher ?? ((i, init) => fetch(i, init))
  const src = opts.src ?? pageBriefSource()
  const session = await fetcher(`${base}/api/session`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
  const tenant = session.ok ? ((await session.json()) as { tenant?: unknown }).tenant : null
  if (typeof tenant !== 'string') throw new SpinoffError('A deck is made in Napkin, and this page is not signed in to it.')
  const r = await fetcher(`${base}/api/t/${encodeURIComponent(tenant)}/d/${encodeURIComponent(docId)}/spinoff`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ app_id: DECK_APP_ID, ...(opts.title ? { title: opts.title } : {}) }),
  })
  if (!r.ok) {
    let why = ''
    try {
      const e = ((await r.json()) as { error?: unknown }).error
      why = typeof e === 'string' ? e : String((e as { message?: unknown } | null)?.message ?? '')
    } catch { /* not JSON */ }
    // A missing app is named as the missing app, whatever status says so.
    if (/not installed/i.test(why)) throw new SpinoffError('Deck Maker is not installed here, so a deck cannot be made from this project.')
    throw new SpinoffError(r.status === 404 ? 'Napkin could not find this project in your library.' : why || `Napkin answered ${r.status}.`)
  }
  const v = (await r.json()) as { path?: unknown }
  if (typeof v.path !== 'string' || !v.path) throw new SpinoffError('Napkin made the deck but did not say where it is.')
  return { docId: v.path, url: src.openUrl(v.path) }
}
