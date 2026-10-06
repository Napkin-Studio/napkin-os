// The relay API (relay-api.schema.json) as one interface. Two implementations:
// HttpRelay (VITE_RELAY_URL) and MockRelay (in the browser, no backend).

import type {
  AssetRef, Config, ContractError, InputMime, Job, JobRequest, LogEntry, Output, SessionRequest, SessionResponse,
} from '../contracts/types'

export interface UploadResult extends AssetRef {
  exists: boolean
  bytes: number
}

export interface Relay {
  readonly kind: 'http' | 'mock'
  /** POST /session */
  session(req: SessionRequest): Promise<SessionResponse>
  /** Restore a token from an earlier session (no request). */
  useToken(token: string | null): void
  /** Hash in the browser, POST /uploads, PUT the bytes when the relay doesn't have them. */
  upload(blob: Blob, mime: InputMime): Promise<UploadResult>
  /** POST /jobs (idempotent on jobId) */
  createJob(req: JobRequest): Promise<Job>
  /** GET /jobs/{jobId} */
  getJob(jobId: string): Promise<Job>
  /** DELETE /jobs/{jobId} */
  cancelJob(jobId: string): Promise<Job>
  /** POST /log */
  log(entry: LogEntry): Promise<void>
  /** GET /config, or null when the relay doesn't serve one. */
  config(): Promise<Config | null>
  /** The bytes of a job output (copied into our S3 by the relay; the mock keeps them locally). */
  fetchOutput(output: Output): Promise<Blob>
}

/** A non-2xx relay answer, carrying the contract error. */
export class RelayError extends Error {
  readonly error: ContractError
  readonly status: number
  constructor(error: ContractError, status = 0) {
    super(error.message)
    this.error = error
    this.status = status
  }
}

export function asContractError(e: unknown): ContractError {
  if (e instanceof RelayError) return e.error
  const message = e instanceof Error ? e.message : String(e)
  return { code: 'provider_unavailable', message: message || 'Could not reach the server.', retryable: true }
}
