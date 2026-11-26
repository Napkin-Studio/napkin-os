// The relay over HTTP, through napkin-web and only through it (features/production-jobs-via-host.clan).
// The tool never sees the relay's address: each call is napkin-web's own route under the shell API,
//   /api/t/{tenant}/production/<route>            no document (me, config, library, log)
//   /api/t/{tenant}/d/{doc}/production/<route>    the open project's own (jobs, uploads)
//   /api/t/{tenant}/d/{doc}/production/inbox      outcomes that finished while the tab was closed
// and napkin-web calls the relay with its service credential and the person from the session. Routes and
// bodies per relay-api.schema.json. No token, no header of ours: the session cookie is the only credential.

import type {
  AnswerConflict, AssetRef, Config, ConfigFile, ContractError, InputMime, Job, JobAnswer, JobRequest, Key, LibraryEntry, LibraryIndex, LibraryPublish, LogEntry, Me, Output,
  UploadResponse,
} from '../contracts/types'
import { AGENCY_SHELF } from '../contracts/types'
import { withDefaults } from '../contracts/load'
import type { ShellEvent } from '../dogfood/recorder'
import { sha256Of } from '../lib/hash'
import { accessOf, type Access } from './access'
import { RelayError, type AnswerResult, type InboxEntry, type Relay, type UploadResult } from './types'

export interface HttpRelayOptions {
  /** Where napkin-web's API is (default the page's origin's /api). */
  host?: string
  /** The workspace: GET /session by default, asked once. */
  tenant?: () => Promise<string>
  /** The library document the open project is (its id in the route), or null on Home. */
  doc: () => string | null
}

export class HttpRelay implements Relay {
  readonly kind = 'http' as const
  onUnauthorised?: (why: Access) => void
  private readonly host: string
  private readonly docOf: () => string | null
  private readonly tenantOf: () => Promise<string>
  private tenant_: Promise<string> | null = null

  constructor(opts: HttpRelayOptions) {
    this.host = (opts.host ?? '/api').replace(/\/+$/, '')
    this.docOf = opts.doc
    this.tenantOf = opts.tenant ?? (async () => {
      const res = await fetch(`${this.host}/session`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const tenant = res.ok ? ((await res.json()) as { tenant?: unknown }).tenant : null
      if (typeof tenant !== 'string') throw new RelayError({ code: 'unauthorised', message: 'Sign in to Napkin Studio to use Production.', retryable: false }, res.status || 401)
      return tenant
    })
  }

  /** The route prefix for a call: with the open project when it belongs to one. */
  private async root(bound: boolean): Promise<string> {
    this.tenant_ ??= this.tenantOf()
    this.tenant_.catch(() => { this.tenant_ = null })
    const t = encodeURIComponent(await this.tenant_)
    const doc = this.docOf()
    if (!bound) return `${this.host}/t/${t}/production`
    if (!doc) throw new RelayError({ code: 'invalid_input', message: 'Open a project first: this belongs to one.', retryable: false })
    return `${this.host}/t/${t}/d/${encodeURIComponent(doc)}/production`
  }

  private async call<T>(method: string, path: string, body?: unknown, bound = false): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch((await this.root(bound)) + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (e) {
      if (e instanceof RelayError) throw e
      throw new RelayError({ code: 'provider_unavailable', message: 'Could not reach the server. Check your connection.', retryable: true })
    }
    if (res.status === 204) return undefined as T
    let json: unknown = null
    try {
      json = await res.json()
    } catch { /* empty or not JSON */ }
    if (!res.ok) {
      const access = accessOf(res.status, json, path === '/me')
      if (access) this.onUnauthorised?.(access)
      const err = (json as { error?: ContractError } | null)?.error
      if (!err && access === 'signed_out') {
        throw new RelayError({ code: 'unauthorised', message: 'Sign in to Napkin Studio to use Production.', retryable: false }, res.status)
      }
      throw new RelayError(err ?? { code: 'internal', message: `The server answered ${res.status}.`, retryable: res.status >= 500 }, res.status, json)
    }
    return json as T
  }

  /** Signed out or not confirmed (401) is an answer, not an error: null (onUnauthorised says which).
   *  A 403 flag_off (the agency is not on) throws, after onUnauthorised('not_enabled'). */
  async me(): Promise<Me | null> {
    try {
      return await this.call<Me>('GET', '/me')
    } catch (e) {
      if (e instanceof RelayError && e.status === 401) return null
      throw e
    }
  }

  async upload(blob: Blob, mime: InputMime): Promise<UploadResult> {
    const sha256 = await sha256Of(blob)
    const res = await this.call<UploadResponse>('POST', '/uploads', { sha256, mime, bytes: blob.size }, true)
    if (!res.exists && res.putUrl) {
      let put: Response
      try {
        // With the headers the relay names: x-amz-checksum-sha256 binds the PUT to the bytes' hash, so S3
        // refuses other bytes (features/tenant-limits.clan).
        put = await fetch(res.putUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': mime, ...res.putHeaders } })
      } catch (_e) {
        throw new RelayError({ code: 'provider_unavailable', message: 'The upload did not go through. Try again.', retryable: true })
      }
      if (!put.ok) throw new RelayError({ code: 'internal', message: `The upload failed (${put.status}).`, retryable: true }, put.status)
    }
    return { sha256, url: res.url, mime, exists: res.exists, bytes: blob.size }
  }

  createJob(req: JobRequest) {
    return this.call<Job>('POST', '/jobs', req, true)
  }

  getJob(jobId: string) {
    return this.call<Job>('GET', `/jobs/${encodeURIComponent(jobId)}`, undefined, true)
  }

  cancelJob(jobId: string) {
    return this.call<Job>('DELETE', `/jobs/${encodeURIComponent(jobId)}`, undefined, true)
  }

  async answerJob(jobId: string, answer: JobAnswer): Promise<AnswerResult> {
    try {
      return { job: await this.call<Job>('POST', `/jobs/${encodeURIComponent(jobId)}/answer`, answer, true) }
    } catch (e) {
      const body = e instanceof RelayError && e.status === 409 ? (e.body as Partial<AnswerConflict> | null) : null
      if (body?.answeredBy && body.answer && body.error) return { conflict: body as AnswerConflict }
      throw e
    }
  }

  async log(entry: LogEntry) {
    await this.call<void>('POST', '/log', entry)
  }

  async config(): Promise<Config | null> {
    try {
      return withDefaults(await this.call<ConfigFile>('GET', '/config'))
    } catch {
      return null
    }
  }

  library(shelf = AGENCY_SHELF) {
    return this.call<LibraryIndex>('GET', `/library/${encodeURIComponent(shelf)}`)
  }

  libraryEntry(key: Key, ver?: number, shelf = AGENCY_SHELF) {
    return this.call<LibraryEntry>('GET', `/library/${encodeURIComponent(shelf)}/${encodeURIComponent(key)}${ver ? `/${ver}` : ''}`)
  }

  publish(key: Key, req: LibraryPublish, shelf = AGENCY_SHELF) {
    return this.call<LibraryEntry>('POST', `/library/${encodeURIComponent(shelf)}/${encodeURIComponent(key)}`, req)
  }

  /** The dogfood record is napkin-web's (one recorder, features/production-jobs-via-host.clan): its notice, its consent. */
  async dogfoodConsent() {
    const res = await fetch(`${this.host}/dogfood/consent`, { method: 'POST', credentials: 'same-origin' })
    if (!res.ok) throw new RelayError({ code: 'internal', message: `The server answered ${res.status}.`, retryable: res.status >= 500 }, res.status)
  }

  /** Sent with keepalive so a batch still goes as the page closes. Shaped as napkin-web's recorder takes them:
   *  the project is `doc`, the tool is `app`, the screen and the rest ride in `data`. */
  dogfoodEvents(events: ShellEvent[], _leaving: boolean) {
    if (!events.length) return
    const batch = events.map((e) => ({
      kind: e.kind, name: e.name, doc: e.project, app: 'production', at: e.at,
      data: { ...(e.stage ? { stage: e.stage } : {}), ...(e.tab ? { tab: e.tab } : {}), ...(e.seq !== undefined ? { seq: e.seq } : {}), ...(e.data ?? {}) },
    }))
    fetch(`${this.host}/dogfood/events`, {
      method: 'POST', keepalive: true, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    }).catch(() => { /* recording never gets in the way */ })
  }

  /** The outcomes that finished while no tab had this project open (and the host has not been told were landed). */
  async inbox(): Promise<InboxEntry[]> {
    return (await this.call<{ entries: InboxEntry[] }>('GET', '/inbox', undefined, true)).entries
  }

  /** The tool has landed this job (from the inbox, or directly): the host never offers it again. Twice is fine. */
  async ackJob(jobId: string): Promise<void> {
    await this.call<unknown>('POST', `/inbox/${encodeURIComponent(jobId)}/ack`, undefined, true)
  }

  /** The host's word that a job of `doc` finished and waits in its inbox. Returns how to stop listening. */
  onSettled(doc: string, listener: () => void): () => void {
    let es: EventSource | null = null
    let stopped = false
    void this.tenantOf().then((tenant) => {
      if (stopped || typeof EventSource === 'undefined') return
      es = new EventSource(`${this.host}/t/${encodeURIComponent(tenant)}/events`, { withCredentials: true })
      es.addEventListener('napkin-job-settled', (ev) => {
        try {
          if ((JSON.parse((ev as MessageEvent<string>).data) as { doc?: string }).doc === doc) listener()
        } catch { /* not ours */ }
      })
    }).catch(() => { /* no stream: the next open lands it */ })
    return () => { stopped = true; es?.close() }
  }

  async fetchOutput(output: Output | AssetRef): Promise<Blob> {
    const res = await fetch(output.url)
    if (!res.ok) throw new RelayError({ code: 'provider_unavailable', message: 'Could not download the result.', retryable: true }, res.status)
    return await res.blob()
  }
}
