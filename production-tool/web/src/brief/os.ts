// Reading Brief Maker briefs from Napkin OS (features/brief-node.clan). The Production Tool runs at
// /production on the OS's own origin and session, so it reads the shell API directly:
// - GET /api/session: the tenant;
// - GET /api/t/{tenant}/library?app=ie.napkin.brief-maker: the agency's briefs (the link picker);
// - GET /api/t/{tenant}/d/{doc}/data: one brief's data, title and the sha256 of its shared/data.yaml
//   (napkin-web api.rs document_data), the same hash an OS link keeps.
// Nothing here writes to the OS: Production never writes a brief back (non-goal).
//
// Outside the OS (the tool's own dev server, the local relay) there is no shell API: `available()`
// says false and Start from a brief is not offered.

import { BRIEF_APP_ID } from './spine'

/** One brief the person could link. */
export interface OsBriefItem {
  /** The OS document id (library path, doc-…). */
  documentId: string
  title: string
  updatedAt: string
  client?: { id?: string; name: string }
}

/** One brief as it stands now in the OS. */
export interface OsBriefRead {
  documentId: string
  title: string
  appId: string | null
  /** sha256 of its shared/data.yaml: a different hash later means the brief changed. */
  dataSha256: string
  data: unknown
}

/** Where briefs come from; tests and the dev server give their own. */
export interface BriefSource {
  available(): Promise<boolean>
  list(): Promise<OsBriefItem[]>
  read(documentId: string): Promise<OsBriefRead>
  /** Where the shell opens it (Open in Brief Maker). */
  openUrl(documentId: string): string
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export class BriefReadError extends Error {}

/** The shell API of the OS this page is served from (`base`: '' on the same origin). */
export function osBriefSource(base = '', fetcher: Fetch = (i, init) => fetch(i, init)): BriefSource {
  let tenant: Promise<string | null> | null = null
  const getJson = async (path: string): Promise<unknown> => {
    const r = await fetcher(`${base}${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    if (!r.ok) throw new BriefReadError(r.status === 404 ? 'That brief is no longer in Napkin.' : `Napkin answered ${r.status}.`)
    return r.json()
  }
  const who = () => {
    tenant ??= getJson('/api/session')
      .then((s) => (s && typeof s === 'object' && typeof (s as { tenant?: unknown }).tenant === 'string' ? (s as { tenant: string }).tenant : null))
      .catch(() => null)
    return tenant
  }
  const need = async () => {
    const t = await who()
    if (!t) throw new BriefReadError('Briefs are read from Napkin, and this page is not signed in to it.')
    return encodeURIComponent(t)
  }
  return {
    async available() {
      return (await who()) !== null
    },
    async list() {
      const t = await need()
      const v = (await getJson(`/api/t/${t}/library?app=${encodeURIComponent(BRIEF_APP_ID)}`)) as { items?: { path: string; app_id?: string | null; title: string; updated_at: string; client?: { id?: string; name: string } | null }[] }
      return (v.items ?? [])
        .filter((i) => !i.app_id || i.app_id === BRIEF_APP_ID)
        .map((i) => ({ documentId: i.path, title: i.title, updatedAt: i.updated_at, ...(i.client ? { client: i.client } : {}) }))
    },
    async read(documentId) {
      const t = await need()
      const v = (await getJson(`/api/t/${t}/d/${encodeURIComponent(documentId)}/data`)) as { path?: string; title?: string; app_id?: string | null; data_sha256?: string; data?: unknown }
      if (!v.data_sha256 || !/^sha256:[0-9a-f]{64}$/.test(v.data_sha256)) throw new BriefReadError('Napkin sent the brief without its version.')
      if (v.app_id && v.app_id !== BRIEF_APP_ID) throw new BriefReadError('That document is not a brief.')
      return { documentId: v.path ?? documentId, title: (v.title ?? '').trim() || 'Brief', appId: v.app_id ?? null, dataSha256: v.data_sha256, data: v.data }
    },
    openUrl(documentId) {
      return `${base}/?open=${encodeURIComponent(documentId)}`
    },
  }
}

/** The briefs this page reads: Napkin's (the OS), or in dev a stand-in (window.__briefSource) for the paired
 *  screenshots on a local stack. The Start card and Assets › From Napkin read the same one. */
let OS: BriefSource | null = null
export function pageBriefSource(): BriefSource {
  const dev = import.meta.env.DEV ? (globalThis as unknown as { __briefSource?: BriefSource }).__briefSource : undefined
  // One source for the page: callers put it in effects' dependencies.
  return dev ?? (OS ??= osBriefSource())
}
