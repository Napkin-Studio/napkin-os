// The person's projects on the relay (features/personal-workspaces.clan): each name is its own
// workspace, so whatever it saved from any browser is listed here and can be opened here.
//   GET  /projects                 the saved projects, newest first
//   GET  /clan/{id}                the newest .clan bytes, with their ETag
//   POST /clan  (X-Project-Id)     a save; with If-Match, 409 when someone saved since
//   GET|PUT /clan/{id}/canvas      the canvas that goes with it
//   POST /uploads                  "do you have this picture?" (in/<sha256>), and the place to put it
// Only with the real relay: the in-browser mock keeps nothing on a server.

import type { ClanSaved, InputMime, ProjectCanvas, ProjectList, SavedProject, UploadResponse } from '../contracts/types'
import { RelayError } from '../relay'
import { accessOf, type Access } from '../relay/access'

/** Someone saved the project (from another browser or tab) since this one last saved or opened it. */
export class SaveConflict extends Error {}

/** What POST /uploads takes; a picture of another type can only travel in an Export. */
export const SENDABLE: readonly InputMime[] = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4']

export interface Opened {
  bytes: Uint8Array
  etag: string
  savedAt: string
}

export class ProjectServer {
  private readonly base: string
  private readonly signedIn_: () => boolean
  private readonly fetchFn: typeof fetch
  /** Told when an answer says this person cannot use the tool (relay/access.ts), as HttpRelay does. */
  onUnauthorised?: (why: Access) => void

  /** No token: who is asking comes from the relay's identity seam (features/drop-hackathon-extras.clan). */
  constructor(opts: { base: string; signedIn: () => boolean; fetchFn?: typeof fetch; onUnauthorised?: (why: Access) => void }) {
    this.onUnauthorised = opts.onUnauthorised
    this.base = opts.base.replace(/\/+$/, '')
    this.signedIn_ = opts.signedIn
    this.fetchFn = opts.fetchFn ?? ((...a) => fetch(...a))
  }

  get signedIn(): boolean {
    return this.signedIn_()
  }

  private async req(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
    if (!this.signedIn) throw new RelayError({ code: 'unauthorised', message: 'Sign in through Napkin Studio.', retryable: false }, 401)
    let res: Response
    try {
      res = await this.fetchFn(this.base + path, { method, body: init.body, headers: init.headers })
    } catch {
      throw new RelayError({ code: 'provider_unavailable', message: 'Could not reach the server. Check your connection.', retryable: true })
    }
    return res
  }

  private async fail(res: Response): Promise<never> {
    let body: unknown = null
    try {
      body = await res.json()
    } catch { /* not JSON */ }
    const access = accessOf(res.status, body)
    if (access) this.onUnauthorised?.(access)
    let err = (body as { error?: RelayError['error'] } | null)?.error ?? null
    if (!err && access === 'signed_out') err = { code: 'unauthorised', message: 'Sign in to Napkin Studio to use Production.', retryable: false }
    throw new RelayError(err ?? { code: 'internal', message: `The server answered ${res.status}.`, retryable: res.status >= 500 }, res.status)
  }

  /** The person's saved projects, newest first. */
  async list(): Promise<SavedProject[]> {
    const res = await this.req('GET', '/projects')
    if (!res.ok) return this.fail(res)
    return ((await res.json()) as ProjectList).projects
  }

  /** The newest save of a project, and its ETag. */
  async open(id: string): Promise<Opened> {
    const res = await this.req('GET', `/clan/${encodeURIComponent(id)}`)
    if (!res.ok) return this.fail(res)
    const etag = (res.headers.get('ETag') ?? '').replace(/^W\//, '').replace(/"/g, '')
    return { bytes: new Uint8Array(await res.arrayBuffer()), etag, savedAt: res.headers.get('X-Saved-At') ?? new Date().toISOString() }
  }

  /** Save the project. `ifMatch`: the ETag this copy started from; SaveConflict when someone saved since. */
  async save(id: string, bytes: Uint8Array, opts: { reason: 'interval' | 'accept' | 'manual'; ifMatch?: string; name?: string }): Promise<SavedProject> {
    const headers: Record<string, string> = { 'Content-Type': 'application/vnd.clan+zip', 'X-Clan-Reason': opts.reason, 'X-Project-Id': id }
    if (opts.ifMatch) headers['If-Match'] = `"${opts.ifMatch}"`
    if (opts.name) headers['X-Project-Name'] = encodeURIComponent(opts.name.slice(0, 80))
    const res = await this.req('POST', '/clan', { body: bytes as unknown as BodyInit, headers })
    if (res.status === 409) {
      let message = 'This project was saved from somewhere else since you opened it.'
      try {
        message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message
      } catch { /* keep ours */ }
      throw new SaveConflict(message)
    }
    if (!res.ok) return this.fail(res)
    return ((await res.json()) as ClanSaved).project
  }

  /** The canvas saved with the project; null when there is none. */
  async canvas(id: string): Promise<ProjectCanvas | null> {
    const res = await this.req('GET', `/clan/${encodeURIComponent(id)}/canvas`)
    if (res.status === 404) return null
    if (!res.ok) return this.fail(res)
    return (await res.json()) as ProjectCanvas
  }

  async putCanvas(id: string, elements: unknown[]): Promise<void> {
    const res = await this.req('PUT', `/clan/${encodeURIComponent(id)}/canvas`, {
      body: JSON.stringify({ elements } satisfies ProjectCanvas), headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return this.fail(res)
  }

  /** The bytes at one of our public URLs (in/, out/, ads/); null when they cannot be had. */
  async download(url: string): Promise<Uint8Array | null> {
    try {
      const res = await this.fetchFn(url)
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    } catch {
      return null
    }
  }

  /** Where the relay keeps a picture or clip it has as an upload (in/<sha256>); null when it has none. */
  async where(sha256: string, mime: string, bytes: number): Promise<string | null> {
    if (!SENDABLE.includes(mime as InputMime)) return null
    const res = await this.req('POST', '/uploads', {
      body: JSON.stringify({ sha256, mime, bytes: Math.max(1, bytes) }), headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return null
    const out = (await res.json()) as UploadResponse
    return out.exists ? out.url : null
  }
}
