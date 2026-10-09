// The relay API (relay-api.schema.json) as one interface. Two implementations:
// HttpRelay (VITE_RELAY_URL) and MockRelay (in the browser, no backend).

import type {
  AssetRef, Config, ContractError, InputMime, Job, JobRequest, Key, LibraryEntry, LibraryIndex, LibraryPublish, LogEntry, Output,
  SessionRequest, SessionResponse,
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
  /** Called when the server refuses the session (401). The app clears it and shows sign-in. */
  onUnauthorised?: () => void
  /** The participant's own keys, sent on POST /jobs only (X-Own-Keys). The mock ignores them. */
  ownKeys?: () => string | null
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
  /** The bytes of a job output or an uploaded image (our S3 behind the relay; the mock keeps them locally). */
  fetchOutput(output: Output | AssetRef): Promise<Blob>
  /** GET /library: the workspace's solid keys, latest version each. */
  library(): Promise<LibraryIndex>
  /** GET /library/{key}[/{ver}] */
  libraryEntry(key: Key, ver?: number): Promise<LibraryEntry>
  /** POST /library/{key}: publish the next version (409 conflict when baseVer is not the latest). */
  publish(key: Key, req: LibraryPublish): Promise<LibraryEntry>
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
