// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The web host: the same contract, over `napkin-web`'s HTTP API.
//
// Two things the desktop gets for free and this has to arrange:
//
//  * Which document is open. Tauri commands act on the host's one open file;
//    the HTTP API addresses documents explicitly. So this module remembers what
//    the shell last opened, which is the same state, just held on this side.
//  * Reaching the clan:// API. An app inside a .clan asks for
//    `clan://localhost/patch-data`, a scheme no browser has. The server
//    composes the frame's page with that base rewritten to the frame's own
//    token URL (`/s/{token}/document`), so app HTML runs unmodified.

import { isMyExport } from './exportEvents'
import { fetchFile } from './fetchFile'
import { frameQuery } from './frame'
import type {
  ClientConfirmReply,
  Adopted,
  LegacyName,
  ClientRecord,
  LibraryFilter,
  LibraryListing,
  ClientReopenReply,
  ClientReviewReply,
  DecisionsView,
  Host,
  HostEvents,
  InstalledApp,
  OpenResult,
  RecentDoc,
  SpinoffTarget,
  Unlisten,
  UploadedAsset,
  UpstreamUpdateReply,
  UpstreamView,
  AttachTarget,
  AttachReply,
  RelatedView,
  SourceCard,
} from './types'

interface SessionInfo {
  tenant: string
  sandbox_origin: string | null
  quota: { used: number; cap: number }
  /** The signed-in person, on a server with accounts (`name@agency`). */
  user?: { username: string; agency: string; name?: string }
}

/** The signed-in person, when the server has accounts; null when it is anonymous. */
export async function signedInUser(): Promise<SessionInfo['user'] | null> {
  try { return (await session()).user ?? null } catch { return null }
}

/** `?client=<id>&app=<app_id>`, or nothing: only what the filter names. */
export function libraryQuery(filter?: LibraryFilter): string {
  const q = new URLSearchParams()
  if (filter?.client) q.set('client', filter.client)
  if (filter?.app) q.set('app', filter.app)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** An opened document, plus what the frame needs to talk to the host. */
interface OpenView extends OpenResult {
  token: string
  /** The frame's public name: an app's export event carries it. */
  frame?: string
  sandbox_origin: string | null
}

let sessionOnce: Promise<SessionInfo> | null = null

function session(): Promise<SessionInfo> {
  sessionOnce ??= fetch('/api/session', { credentials: 'same-origin' }).then(r => {
    if (!r.ok) throw new Error(`no session: ${r.status}`)
    return r.json() as Promise<SessionInfo>
  })
  // A page that started offline must be able to try again once it is back.
  sessionOnce.catch(() => { sessionOnce = null })
  return sessionOnce
}

async function base(): Promise<string> {
  return `/api/t/${(await session()).tenant}`
}

// What the shell has open. The API is explicit about documents; the Host
// contract is not, so the current one lives here.
let openDoc: string | null = null
let openToken: string | null = null
let openFrame: string | null = null
let sandboxOrigin: string | null = null

function requireDoc(): string {
  if (!openDoc) throw new Error('no file open')
  return openDoc
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const resp = await fetch(`${await base()}${path}`, { credentials: 'same-origin', ...init })
  if (!resp.ok) {
    const body = await resp.text()
    let message = body
    try {
      message = (JSON.parse(body) as { error?: string }).error ?? body
    } catch { /* not JSON: the body is the message */ }
    throw new Error(message || `${resp.status} ${resp.statusText}`)
  }
  return resp
}

const asJson = <T,>(r: Response) => r.json() as Promise<T>
const asText = (r: Response) => r.text()

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return asJson<T>(await request(path, init))
}

async function text(path: string, init?: RequestInit): Promise<string> {
  return asText(await request(path, init))
}

function postJson(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/** What napkin-web says as `code` when the token itself is refused (sandbox.rs `STALE_TOKEN`). */
export const STALE_TOKEN = 'sandbox_token'

/** Whether `resp` is napkin-web refusing a token it does not hold (a deploy, or its TTL). */
export async function isStaleToken(resp: Response): Promise<boolean> {
  if (resp.status !== 403) return false
  try {
    return ((await resp.clone().json()) as { code?: unknown } | null)?.code === STALE_TOKEN
  } catch {
    return false
  }
}

let renewing: Promise<string | null> | null = null

/**
 * The open document's frame origin after a token was refused as stale: the
 * document is opened again, which mints a token the server holds now. `held`
 * is the origin the caller was refused on; when the open document already has
 * another, that one is the answer and nothing is asked. One open at a time,
 * however many calls were refused together. Null when there is no document
 * open, the open fails, or the shell moved to another document meanwhile.
 */
export function renewToken(held?: string): Promise<string | null> {
  const doc = openDoc
  if (!doc) return Promise.resolve(null)
  if (held && held !== httpHost.clanOrigin()) return Promise.resolve(httpHost.clanOrigin())
  renewing ??= json<OpenView>(`/d/${encodeURIComponent(doc)}`)
    .then(view => {
      if (openDoc !== doc) return null
      openToken = view.token
      openFrame = view.frame ?? null
      sandboxOrigin = view.sandbox_origin
      return httpHost.clanOrigin()
    }, () => null)
    .finally(() => { renewing = null })
  return renewing
}

/**
 * Fetch a `clan://` route on the frame's token URL; when the token is refused
 * as stale, open the document again and send the same request once more.
 * Once: a second refusal is the caller's to see, so this never loops.
 */
async function clanFetch(route: string, init?: RequestInit): Promise<Response> {
  const held = httpHost.clanOrigin()
  const resp = await fetch(`${held}${route}`, init)
  if (!(await isStaleToken(resp))) return resp
  const origin = await renewToken(held)
  return origin && origin !== held ? fetch(`${origin}${route}`, init) : resp
}

/**
 * A `clan://` route, reached as the frame reaches it: on the frame's token
 * URL, so it acts on the document the frame shows. No content type, as the
 * app's own calls send none — a plain request, which the sandbox origin
 * answers across origins. A refusal is thrown as the host's own words.
 */
async function clanCall<T>(route: string, init?: RequestInit): Promise<T> {
  const resp = await clanFetch(route, init)
  const body = await resp.text()
  let parsed: unknown = null
  try { parsed = JSON.parse(body) } catch { /* not JSON: the body is the message */ }
  if (!resp.ok) {
    const err = (parsed as { error?: unknown } | null)?.error
    const message = typeof err === 'string' ? err : (err as { message?: string } | undefined)?.message
    throw new Error(message || body || `${route.slice(1)}: ${resp.status}`)
  }
  return parsed as T
}

const clanPost = <T,>(route: string, body: unknown) =>
  clanCall<T>(route, { method: 'POST', body: JSON.stringify(body) })

/** Opens asked for so far. Only the latest one may become the open document. */
let opens = 0

/**
 * Open something, and remember it as what the shell has open — unless another
 * open was asked for while this one was in flight.
 *
 * Responses do not come back in the order they were asked for. The shell asks
 * for home and for a `?open=` document at the same moment on load, and when
 * home answered last it became "the open document" underneath a frame showing
 * the other one: that frame's token, its /chain and its writes all went to
 * home. The last open *asked for* is the one the shell is showing, so it is the
 * one that wins.
 */
async function adopt(request: Promise<OpenView>): Promise<OpenResult> {
  const mine = ++opens
  const view = await request
  if (mine === opens) {
    openDoc = view.path
    openToken = view.token
    openFrame = view.frame ?? null
    sandboxOrigin = view.sandbox_origin
  }
  return view
}

/** Save bytes the server is offering, without leaving the page. */
function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Save bytes already fetched, under `name`. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // after the click has handed the bytes to the browser
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// One stream per page, fanned out to the shell's listeners.
//
// The promise is what is memoised, not the EventSource. The shell registers all
// of its listeners in a single tick, so caching the value instead would let
// every one of them get past the check while the first was still awaiting its
// URL — and seven streams is not merely wasteful: each holds a connection, and
// six is all a browser will give one origin over HTTP/1.1, so the rest of the
// app stops loading.
let streamOnce: Promise<EventSource> | null = null

function events(): Promise<EventSource> {
  streamOnce ??= base().then(b => new EventSource(`${b}/events`, { withCredentials: true }))
  return streamOnce
}

/**
 * The open document as the server holds it now: its packed `.clan` and the
 * manifest that describes it. What "Present offline" keeps.
 *
 * The same `/download` route "Save as" uses — the single-file handoff, which
 * is exactly what N3 says an offline copy is: a snapshot, never a working
 * copy. The manifest is read first, so a revision is never newer than the
 * bytes stored with it.
 */
export async function fetchOpenDocument(): Promise<{ manifest: OpenResult['manifest']; bytes: ArrayBuffer }> {
  const doc = requireDoc()
  const { manifest } = await json<OpenView>(`/d/${encodeURIComponent(doc)}`)
  const bytes = await (await request(`/d/${doc}/download`, { cache: 'no-store' })).arrayBuffer()
  return { manifest, bytes }
}

export const httpHost: Host = {
  // Signed in, the person is their account (`human:engineer@napkin`, as
  // napkin-web's Acting records them); anonymous, the tenant is the person.
  whoAmI: async () => {
    const { tenant, user } = await session()
    if (user) return { actor: `human:${user.username}`, id: user.username, name: user.name ?? null }
    return { actor: `human:${tenant}`, id: tenant, name: null }
  },

  openClan: path => adopt(json<OpenView>(`/d/${encodeURIComponent(path)}`)),
  openHome: () => adopt(json<OpenView>('/home')),
  newDocumentFromApp: async (appId, title, clientId) =>
    adopt(json<OpenView>('/documents', postJson({ app_id: appId, title, ...(clientId ? { client_id: clientId } : {}) }))),

  // A shared link — `?open=<document>` — is the web's answer to double-clicking
  // a .clan. Consumed once, then cleared so a reload does not re-open it.
  takeLaunchFile: async () => {
    const params = new URLSearchParams(window.location.search)
    const doc = params.get('open')
    if (!doc) return null
    params.delete('open')
    const query = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
    return doc
  },

  getData: () => text(`/d/${requireDoc()}/entry/data`),
  // A clan:// route, so it is the frame's token that reaches it.
  getDecisions: async () => {
    const resp = await clanFetch('/decisions')
    if (!resp.ok) throw new Error(`decisions: ${resp.status}`)
    return resp.json() as Promise<DecisionsView>
  },
  acknowledge: async decision => {
    const resp = await clanFetch('/acknowledge', { method: 'POST', body: JSON.stringify({ decision }) })
    if (!resp.ok) throw new Error(((await resp.json().catch(() => null)) as { error?: string } | null)?.error ?? `acknowledge: ${resp.status}`)
  },

  verify: async (finding, rationale) => { await clanPost<unknown>('/verify', { finding, rationale }) },

  upstream: () => clanCall<UpstreamView>('/upstream'),
  updateFromUpstream: () => clanPost<UpstreamUpdateReply>('/upstream/update', {}),
  attachTargets: () => clanCall<AttachTarget[]>('/attach-targets'),
  attach: documentId => clanPost<AttachReply>('/attach', { document_id: documentId }),
  updateLinked: documentId => clanPost<AttachReply>('/upstream/update', { document_id: documentId }),
  detach: documentId => clanPost<AttachReply>('/attach/detach', { document_id: documentId }),
  related: () => clanCall<RelatedView>('/related'),
  setTitle: async (title: string) => { await clanPost<unknown>('/set-title', { title }) },
  cites: async refs => (await clanPost<{ cites: Record<string, SourceCard> }>('/cite', { refs })).cites,

  clientReview: body => clanPost<ClientReviewReply>('/client-review', body),
  clientReviewConfirm: body => clanPost<ClientConfirmReply>('/client-review/confirm', body),
  clientReviewReopen: answer => clanPost<ClientReopenReply>('/client-review/reopen', { answer }),
  uploadAsset: (name, bytes) =>
    clanCall<UploadedAsset>(`/upload-asset?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: bytes as unknown as BodyInit,
    }),

  setEditMode: async active => {
    await request(`/d/${requireDoc()}/edit-mode`, postJson({ active }))
  },
  savePatch: async (id, content) => {
    await request(`/d/${requireDoc()}/patch`, postJson({ id, content }))
  },

  clanOrigin: () => `${sandboxOrigin ?? window.location.origin}/s/${openToken ?? 'no-token'}`,
  renewToken,

  // The frame loads its page from the server, composed there from the view
  // (napkin-host frame.rs): one GET, nothing posted (features/doc-open-direct.clan).
  frameLoad: 'url',
  frameSrc: opts => `${httpHost.clanOrigin()}/document?${frameQuery(opts)}`,
  compose: () => Promise.reject(new Error('the frame loads its page by address in this build')),
  handleFromFrame: () =>
    Promise.reject(new Error('the frame reaches the host directly in this build')),

  listApps: () => json<InstalledApp[]>('/apps'),
  installApp: srcPath =>
    json<InstalledApp>(`/apps/from/${encodeURIComponent(srcPath)}`, { method: 'POST' }),

  // The tenant's own /recent (napkin-web api.rs), not the frame's clan://
  // origin: that one needs an open document's token, and home has none.
  listRecent: () => json<RecentDoc[]>('/recent'),

  listLibrary: (filter?: LibraryFilter) => json<LibraryListing>(`/library${libraryQuery(filter)}`),
  settleJob: (path: string, jobId: string) =>
    json<unknown>(`/d/${encodeURIComponent(path)}/jobs/${encodeURIComponent(jobId)}/settle`, { method: 'POST' }),
  docOps: async (path: string) => {
    const view = await json<OpenView>(`/d/${encodeURIComponent(path)}`)
    const origin = `${view.sandbox_origin ?? window.location.origin}/s/${view.token}`
    const call = async <T,>(route: string, init?: RequestInit): Promise<T> => {
      const resp = await fetch(`${origin}${route}`, init)
      const body = await resp.text()
      let parsed: unknown = null
      try { parsed = body ? JSON.parse(body) : null } catch { /* not JSON */ }
      if (!resp.ok) throw new Error((parsed as { error?: string } | null)?.error ?? (body || `${route}: ${resp.status}`))
      return parsed as T
    }
    const post = (route: string, body: unknown) => call<unknown>(route, { method: 'POST', body: JSON.stringify(body) })
    return {
      decisions: () => call<DecisionsView>('/decisions'),
      related: () => call<RelatedView>('/related'),
      upstream: () => call<UpstreamView>('/upstream'),
      verify: async (finding: string, rationale: string) => { await post('/verify', { finding, rationale }) },
      acknowledge: async (decision: string) => { await post('/acknowledge', { decision }) },
      data: () => text(`/d/${encodeURIComponent(path)}/entry/data`),
      approve: async (rationale: string) => { await post('/approve', { rationale }) },
    }
  },
  clients: {
    list: (includeArchived = false) => json<ClientRecord[]>(`/clients${includeArchived ? '?archived=1' : ''}`),
    create: (name, material) => json<ClientRecord>('/clients', postJson({ name, ...(material ? { material } : {}) })),
    update: (id, patch) =>
      json<ClientRecord>(`/clients/${encodeURIComponent(id)}`, { ...postJson(patch), method: 'PATCH' }),
    archive: id => json<ClientRecord>(`/clients/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
    restore: id => json<ClientRecord>(`/clients/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
    legacy: () => json<LegacyName[]>('/clients/legacy'),
    adopt: names => json<Adopted>('/clients/adopt', postJson({ names })),
  },

  spinoffTargets: () => json<SpinoffTarget[]>(`/d/${requireDoc()}/spinoff-targets`),
  spinoffDocument: (appId, title, map) =>
    adopt(
      json<OpenView>(
        `/d/${requireDoc()}/spinoff`,
        postJson({ app_id: appId, title, map }),
      ),
    ),

  saveClanTo: async () => {
    download(`${await base()}/d/${requireDoc()}/download`)
  },
  // The handle comes back in this reply and nowhere else: the event stream
  // reaches every tab of the tenant (the whole agency, with accounts), and a
  // handle broadcast there went to whichever tab claimed it first.
  exportCurrent: async (kind, provenance, noBrand) => {
    const r = await request(`/d/${requireDoc()}/export`, postJson({ kind, provenance, no_brand: noBrand }))
    const { handle, filename } = (await r.json()) as { handle: string; filename: string }
    const name = `${filename}.${kind}`
    const blob = await fetchFile(`${await base()}/export/${encodeURIComponent(handle)}?kind=${encodeURIComponent(kind)}`)
    saveBlob(blob, name)
    return name
  },
  // An app's own export: claimed with this tab's frame token, the only key
  // that opens it. Fetched rather than linked, so a failure reaches the shell
  // as "Export failed" with the server's reason.
  finishExport: async (kind, tmpHtml, dest) => {
    const token = openToken ? `&token=${encodeURIComponent(openToken)}` : ''
    const blob = await fetchFile(`${await base()}/export/${encodeURIComponent(tmpHtml)}?kind=${encodeURIComponent(kind)}${token}`)
    saveBlob(blob, dest)
    return dest
  },

  // There is no destination to pick in a browser — the file lands wherever
  // downloads go. The name is still worth having, for the toast.
  pickSaveDestination: async (defaultName, ext) => `${defaultName}.${ext}`,

  // "Pick a file" means upload one: the document has to exist server-side
  // before it can be opened, so the picker returns the id it was given.
  pickClanToOpen: () =>
    new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.clan'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        try {
          const view = await json<OpenView>('/documents/upload', {
            method: 'POST',
            body: await file.arrayBuffer(),
          })
          resolve(view.path)
        } catch (e) {
          console.error('upload failed', e)
          resolve(null)
        }
      }
      // A cancelled picker fires nothing in some browsers; `cancel` covers it.
      input.oncancel = () => resolve(null)
      input.click()
    }),

  agentEndpoint: async () => (await json<{ endpoint: string }>('/agent/endpoint')).endpoint,
  agentPrompt: text_ => json<unknown>('/agent/prompt', postJson({ text: text_ })),

  on: async <K extends keyof HostEvents>(
    event: K,
    handler: (payload: HostEvents[K]) => void,
  ): Promise<Unlisten> => {
    const source = await events()
    const listener = (e: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(e.data)
        // an export another tab asked for is not this tab's to claim
        if (event === 'clan-export-request' && !isMyExport(payload, openFrame)) return
        handler(payload as HostEvents[K])
      } catch {
        console.warn(`malformed ${event} event`, e.data)
      }
    }
    source.addEventListener(event, listener as EventListener)
    return () => source.removeEventListener(event, listener as EventListener)
  },
}
