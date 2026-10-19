// The relay over HTTP: the infra lane's local server (http://localhost:8787)
// or the deployed /api. Routes and bodies per relay-api.schema.json. No token: who is
// asking comes from the relay's identity seam (features/drop-hackathon-extras.clan).

import type {
  AssetRef, Config, ContractError, InputMime, Job, JobRequest, Key, LibraryEntry, LibraryIndex, LibraryPublish, LogEntry, Me, Output,
  UploadResponse,
} from '../contracts/types'
import type { ShellEvent } from '../dogfood/recorder'
import { sha256Of } from '../lib/hash'
import { RelayError, type Relay, type UploadResult } from './types'

export class HttpRelay implements Relay {
  readonly kind = 'http' as const
  onUnauthorised?: () => void
  private readonly base: string

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '')
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (_e) {
      throw new RelayError({ code: 'provider_unavailable', message: 'Could not reach the server. Check your connection.', retryable: true })
    }
    if (res.status === 204) return undefined as T
    let json: unknown = null
    try {
      json = await res.json()
    } catch { /* empty or not JSON */ }
    if (!res.ok) {
      if (res.status === 401) this.onUnauthorised?.()
      const err = (json as { error?: ContractError } | null)?.error
      throw new RelayError(err ?? { code: 'internal', message: `The server answered ${res.status}.`, retryable: res.status >= 500 }, res.status)
    }
    return json as T
  }

  /** Signed out (401) is an answer, not an error: null. */
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
    const res = await this.call<UploadResponse>('POST', '/uploads', { sha256, mime, bytes: blob.size })
    if (!res.exists && res.putUrl) {
      let put: Response
      try {
        put = await fetch(res.putUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': mime } })
      } catch (_e) {
        throw new RelayError({ code: 'provider_unavailable', message: 'The upload did not go through. Try again.', retryable: true })
      }
      if (!put.ok) throw new RelayError({ code: 'internal', message: `The upload failed (${put.status}).`, retryable: true }, put.status)
    }
    return { sha256, url: res.url, mime, exists: res.exists, bytes: blob.size }
  }

  createJob(req: JobRequest) {
    return this.call<Job>('POST', '/jobs', req)
  }

  getJob(jobId: string) {
    return this.call<Job>('GET', `/jobs/${encodeURIComponent(jobId)}`)
  }

  cancelJob(jobId: string) {
    return this.call<Job>('DELETE', `/jobs/${encodeURIComponent(jobId)}`)
  }

  async log(entry: LogEntry) {
    await this.call<void>('POST', '/log', entry)
  }

  async config(): Promise<Config | null> {
    try {
      return await this.call<Config>('GET', '/config')
    } catch {
      return null
    }
  }

  library() {
    return this.call<LibraryIndex>('GET', '/library')
  }

  libraryEntry(key: Key, ver?: number) {
    return this.call<LibraryEntry>('GET', `/library/${encodeURIComponent(key)}${ver ? `/${ver}` : ''}`)
  }

  publish(key: Key, req: LibraryPublish) {
    return this.call<LibraryEntry>('POST', `/library/${encodeURIComponent(key)}`, req)
  }

  async dogfoodConsent() {
    await this.call<void>('POST', '/dogfood/consent')
  }

  /** Sent with keepalive so a batch still goes as the page closes. */
  dogfoodEvents(events: ShellEvent[], _leaving: boolean) {
    if (!events.length) return
    fetch(this.base + '/dogfood/events', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    }).catch(() => { /* recording never gets in the way */ })
  }

  async fetchOutput(output: Output | AssetRef): Promise<Blob> {
    const res = await fetch(output.url)
    if (!res.ok) throw new RelayError({ code: 'provider_unavailable', message: 'Could not download the result.', retryable: true }, res.status)
    return await res.blob()
  }
}
