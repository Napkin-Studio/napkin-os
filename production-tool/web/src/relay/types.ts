// The relay API (relay-api.schema.json) as one interface. Two implementations:
// HttpRelay (VITE_RELAY_URL) and MockRelay (in the browser, no backend).

import type { ShellEvent } from '../dogfood/recorder'
import type {
  AssetRef, Config, ContractError, InputMime, Job, JobRequest, Key, LibraryEntry, LibraryIndex, LibraryPublish, LogEntry, Output,
  Me,
} from '../contracts/types'

export interface UploadResult extends AssetRef {
  exists: boolean
  bytes: number
}

export interface Relay {
  readonly kind: 'http' | 'mock'
  /** GET /me: who is signed in. No token: the relay's identity seam knows (features/drop-hackathon-extras.clan).
   *  null when it answers 401 (no one is). */
  me(): Promise<Me | null>
  /** Called when any route answers 401. The app forgets who was signed in and says to sign in through Napkin Studio. */
  onUnauthorised?: () => void
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
  /** POST /dogfood/consent: this person read the beta notice. Only the real relay records. */
  dogfoodConsent?(): Promise<void>
  /** POST /dogfood/events: a batch of the beta's events. Never awaited; failures are dropped. */
  dogfoodEvents?(events: ShellEvent[], leaving: boolean): void
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
