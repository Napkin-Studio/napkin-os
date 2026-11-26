// The person's projects in the library of Napkin OS (features/production-in-library.clan): each project is a
// library document of the app ie.napkin.production, and its id here is the library's document id. Napkin OS's
// own routes (docs/contracts/production-clan-app.md), under the origin's /api, with the session cookie:
//   GET    /session                        the tenant, and media_base (where pictures are, lib/media.ts)
//   GET    /t/{t}/library                  the documents; this keeps the Production ones
//   POST   /t/{t}/documents                a new project: {app_id, title} answers the open view (`path` is its id)
//   GET    /t/{t}/d/{doc}/download         the newest .clan bytes, with their ETag (the version) and X-Saved-At
//   PUT    /t/{t}/d/{doc}/save             a save; If-Match is the version this copy is based on, 409 + `latest` when not
//   DELETE /t/{t}/d/{doc}                  to the Trash, restorable for 30 days
// A version is "sha256:<hex>" on the wire; here (ServerMark.etag) it is the bare hex, the sha256 of the bytes.
// And the relay, which only keeps the pictures, through napkin-web's own route for the document:
//   POST /t/{t}/d/{doc}/production/uploads   "do you have this picture?" (in/<sha256>), and the place to put it
// Only with the real relay and host: the in-browser mock keeps nothing on a server.

import type { InputMime, SavedProject, UploadResponse } from '../contracts/types'
import { RelayError } from '../relay'
import { accessOf, type Access } from '../relay/access'
import { setMediaBase, setWorkspace } from '../lib/media'

/** Someone saved the project (from another browser or tab) since this one last saved or opened it. */
export class SaveConflict extends Error {
  /** The version now on the host (bare hex), when it said. */
  readonly latest?: string
  constructor(message: string, latest?: string) {
    super(message)
    this.latest = latest
  }
}

/** What POST /uploads takes; a picture of another type can only travel in an Export. */
export const SENDABLE: readonly InputMime[] = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4']

export const APP_ID = 'ie.napkin.production'
const bare = (v: string) => v.replace(/^W\//, '').replace(/"/g, '').replace(/^sha256:/, '')
const wire = (hex: string) => `"sha256:${hex}"`

export interface Opened {
  bytes: Uint8Array
  etag: string
  savedAt: string
}

export interface ServerSession { tenant: string; media_base: string | null }

export class ProjectServer {
  private readonly host: string
  private readonly signedIn_: () => boolean
  private readonly fetchFn: typeof fetch
  private session_: Promise<ServerSession> | null = null
  /** Told when an answer says this person cannot use the tool (relay/access.ts), as HttpRelay does. */
  onUnauthorised?: (why: Access) => void

  /** `host`: where Napkin OS's /api is (default the page's origin). No token: who is asking is the session cookie. */
  constructor(opts: { host?: string; signedIn: () => boolean; fetchFn?: typeof fetch; onUnauthorised?: (why: Access) => void }) {
    this.onUnauthorised = opts.onUnauthorised
    this.host = (opts.host ?? '/api').replace(/\/+$/, '')
    this.signedIn_ = opts.signedIn
    this.fetchFn = opts.fetchFn ?? ((...a) => fetch(...a))
  }

  get signedIn(): boolean {
    return this.signedIn_()
  }

  private async req(base: string, method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
    if (!this.signedIn) throw new RelayError({ code: 'unauthorised', message: 'Sign in through Napkin Studio.', retryable: false }, 401)
    let res: Response
    try {
      res = await this.fetchFn(base + path, { method, body: init.body, headers: init.headers })
    } catch {
      throw new RelayError({ code: 'provider_unavailable', message: 'Could not reach the server. Check your connection.', retryable: true })
    }
    return res
  }

  /** Every refusal here is the host's (the relay's by-hash route answers null instead): its 401 is the session that ended. */
  private async fail(res: Response): Promise<never> {
    let body: unknown = null
    try {
      body = await res.json()
    } catch { /* not JSON */ }
    const access = res.status === 401 ? 'signed_out' as const : accessOf(res.status, body)
    if (access) this.onUnauthorised?.(access)
    const raw = (body as { error?: RelayError['error'] | string } | null)?.error
    let err = raw && typeof raw === 'object' ? raw : typeof raw === 'string' ? { code: 'internal' as const, message: raw, retryable: res.status >= 500 } : null
    if (!err && access === 'signed_out') err = { code: 'unauthorised', message: 'Sign in to Napkin Studio to use Production.', retryable: false }
    throw new RelayError(err ?? { code: 'internal', message: `The server answered ${res.status}.`, retryable: res.status >= 500 }, res.status)
  }

  /** The tenant and the media base, asked once (the media base is told to lib/media.ts). */
  session(): Promise<ServerSession> {
    this.session_ ??= (async () => {
      const res = await this.req(this.host, 'GET', '/session')
      if (!res.ok) return this.fail(res)
      const s = (await res.json()) as { tenant: string; media_base?: string | null }
      setMediaBase(s.media_base)
      setWorkspace(s.tenant)
      return { tenant: s.tenant, media_base: s.media_base ?? null }
    })()
    this.session_.catch(() => { this.session_ = null })
    return this.session_
  }

  private async doc(id: string, rest = ''): Promise<string> {
    return `/t/${encodeURIComponent((await this.session()).tenant)}/d/${encodeURIComponent(id)}${rest}`
  }

  /** The person's Production projects, newest first. `etag` is not in the listing (the version is asked for with `version`). */
  async list(): Promise<SavedProject[]> {
    const t = encodeURIComponent((await this.session()).tenant)
    const res = await this.req(this.host, 'GET', `/t/${t}/library`)
    if (!res.ok) return this.fail(res)
    const body = (await res.json()) as { items?: LibraryRow[] } | LibraryRow[]
    const rows = Array.isArray(body) ? body : body.items ?? []
    return rows
      .filter((r) => r.app_id === APP_ID)
      .map((r) => ({ id: r.path, name: r.title, savedAt: r.updated_at, bytes: 0, etag: '', client: r.client ?? null }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  /** A new project in the library; its id. */
  async create(title: string, clientId?: string): Promise<string> {
    const t = encodeURIComponent((await this.session()).tenant)
    const res = await this.req(this.host, 'POST', `/t/${t}/documents`, {
      body: JSON.stringify({ app_id: APP_ID, title, ...(clientId ? { client_id: clientId } : {}) }), headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return this.fail(res)
    return ((await res.json()) as { path: string }).path
  }

  /** A .clan's bytes as a new project (a copy, or a file opened): its id. The host stores them as they are. */
  async upload(bytes: Uint8Array): Promise<string> {
    const t = encodeURIComponent((await this.session()).tenant)
    const res = await this.req(this.host, 'POST', `/t/${t}/documents/upload`, { body: bytes as unknown as BodyInit, headers: { 'Content-Type': 'application/vnd.clan+zip' } })
    if (!res.ok) return this.fail(res)
    return ((await res.json()) as { path: string }).path
  }

  /** The newest save of a project, and its version. */
  async open(id: string): Promise<Opened> {
    const res = await this.req(this.host, 'GET', await this.doc(id, '/download'))
    if (!res.ok) return this.fail(res)
    return { bytes: new Uint8Array(await res.arrayBuffer()), etag: bare(res.headers.get('ETag') ?? ''), savedAt: res.headers.get('X-Saved-At') ?? new Date().toISOString() }
  }

  /** The newest version on the host without its bytes; null when the project is not there. */
  async version(id: string): Promise<{ etag: string; savedAt: string } | null> {
    const res = await this.req(this.host, 'HEAD', await this.doc(id, '/download'))
    if (res.status === 404) return null
    if (!res.ok) return this.fail(res)
    return { etag: bare(res.headers.get('ETag') ?? ''), savedAt: res.headers.get('X-Saved-At') ?? new Date().toISOString() }
  }

  /** Save the project. `ifMatch`: the version this copy started from (required by the host); SaveConflict when someone saved since. */
  async save(id: string, bytes: Uint8Array, opts: { reason: 'interval' | 'accept' | 'manual' | 'handoff' | 'export' | 'landing'; ifMatch?: string }): Promise<{ etag: string; savedAt: string }> {
    if (!opts.ifMatch) throw new TypeError('a save needs the version it is based on')
    const headers: Record<string, string> = { 'Content-Type': 'application/vnd.clan+zip', 'X-Clan-Reason': opts.reason, 'If-Match': wire(opts.ifMatch) }
    const res = await this.req(this.host, 'PUT', await this.doc(id, '/save'), { body: bytes as unknown as BodyInit, headers })
    if (res.status === 409) {
      let message = 'This project was saved from somewhere else since you opened it.'
      let latest: string | undefined
      try {
        const body = (await res.json()) as { error?: { message?: string }; latest?: string }
        message = body.error?.message ?? message
        latest = body.latest ? bare(body.latest) : undefined
      } catch { /* keep ours */ }
      throw new SaveConflict(message, latest)
    }
    if (!res.ok) return this.fail(res)
    const body = (await res.json()) as { version: string; saved_at: string }
    return { etag: bare(body.version), savedAt: body.saved_at }
  }

  /** A new name for a project that may not be open here: the library title and the document's own (the host's
   *  `/title`, the same operation as an open document's `/set-title`). UAT round 4: a rename only in this browser's
   *  list left the library and the Trash on the old name. */
  async rename(id: string, title: string): Promise<void> {
    const res = await this.req(this.host, 'POST', await this.doc(id, '/title'), {
      body: JSON.stringify({ title }), headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return this.fail(res)
  }

  /** To the Trash (restorable for 30 days). */
  async remove(id: string): Promise<{ restorableUntil: string }> {
    const res = await this.req(this.host, 'DELETE', await this.doc(id))
    if (!res.ok) return this.fail(res)
    return { restorableUntil: ((await res.json()) as { restorable_until: string }).restorable_until }
  }

  /** Back from the Trash to the library (the host's restore: 404 when it is not in the Trash). */
  async restore(id: string): Promise<void> {
    const res = await this.req(this.host, 'POST', await this.doc(id, '/restore'))
    if (!res.ok) return this.fail(res)
  }

  /** The bytes at one of our public URLs (in/, out/); null when they cannot be had. */
  async download(url: string): Promise<Uint8Array | null> {
    try {
      const res = await this.fetchFn(url)
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    } catch {
      return null
    }
  }

  /** Where the relay keeps a picture or clip of project `docId` it has as an upload (in/<sha256>); null when it has none. */
  async where(docId: string, sha256: string, mime: string, bytes: number): Promise<string | null> {
    if (!SENDABLE.includes(mime as InputMime)) return null
    const res = await this.req(this.host, 'POST', await this.doc(docId, '/production/uploads'), {
      body: JSON.stringify({ sha256, mime, bytes: Math.max(1, bytes) }), headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return null
    const out = (await res.json()) as UploadResponse
    return out.exists ? out.url : null
  }
}

interface LibraryRow { path: string; title: string; app_id: string | null; updated_at: string; client?: { id: string; name: string } | null }
