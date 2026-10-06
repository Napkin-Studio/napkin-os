// The relay over HTTP: the infra lane's local server (http://localhost:8787)
// or the deployed /api. Routes and bodies per relay-api.schema.json.

import type { Config, ContractError, InputMime, Job, JobRequest, LogEntry, Output, SessionRequest, SessionResponse, UploadResponse } from '../contracts/types'
import { sha256Of } from '../lib/hash'
import { RelayError, type Relay, type UploadResult } from './types'

export class HttpRelay implements Relay {
  readonly kind = 'http' as const
  private token: string | null = null
  private readonly base: string

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '')
  }

  useToken(token: string | null) {
    this.token = token
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers.Authorization = `Bearer ${this.token}`
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
      const err = (json as { error?: ContractError } | null)?.error
      throw new RelayError(err ?? { code: 'internal', message: `The server answered ${res.status}.`, retryable: res.status >= 500 }, res.status)
    }
    return json as T
  }

  session(req: SessionRequest) {
    return this.call<SessionResponse>('POST', '/session', req)
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

  async fetchOutput(output: Output): Promise<Blob> {
    const res = await fetch(output.url)
    if (!res.ok) throw new RelayError({ code: 'provider_unavailable', message: 'Could not download the result.', retryable: true }, res.status)
    return await res.blob()
  }
}
