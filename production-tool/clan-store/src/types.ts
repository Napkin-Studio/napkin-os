// The interface every Production Tool document store implements: this one
// (a real .clan through napkin-wasm) and the ui lane's JSON store. Keep it
// minimal; both stores run the same round-trip cases against it.

/** shared/data.yaml of a Production Tool document
 * (production-tool/contracts/document.schema.json, contract v2). Typed only
 * at the top level: the schema, validated on every write, is the authority. */
export interface Doc {
  contract_version: '2'
  app: 'production-tool'
  participant: Participant
  stage: { current: 'character' | 'storyboard' | 'video'; next_action?: string }
  assets: DocAsset[]
  keys: Record<string, unknown>[]
  refs: Record<string, unknown>[]
  script?: { current?: string; revisions: Record<string, unknown>[] }
  shots?: Record<string, unknown>[]
  frames?: Record<string, unknown>[]
  takes?: Record<string, unknown>[]
  jobs: Record<string, unknown>[]
  reviews?: Record<string, unknown>[]
  stale?: Record<string, unknown>[]
  exports?: Record<string, unknown>[]
}

export interface Participant {
  id: string
  handle: string
}

/** One entry of `assets` (document.schema.json#/$defs/asset). */
export interface DocAsset {
  sha256: string
  kind: 'image' | 'video'
  mime: string
  origin: 'uploaded' | 'drawn' | 'generated' | 'mock'
  locations: string[]
  bytes?: number
  w?: number
  h?: number
  duration_s?: number
  job_id?: string
  thumb?: string
}

/** Why a write was made: recorded in the decision chain. */
export interface Why {
  action: string
  rationale?: string
  /** Who made it. Default: the participant's handle. The director and the
   * provider steps name themselves (see attribution.ts). */
  agent?: string
  /** Never compressed: for verdicts and locks. */
  pinned?: boolean
  /** Bookkeeping (a job's state, an asset list): change the data, write no
   * decision-chain entry. */
  quiet?: boolean
}

/** A person's verdict on a view, frame, take or shot. */
export interface Verdict {
  kind: 'accept' | 'reject' | 'select'
  target: { kind: string; id: string }
  note?: string
}

export interface DocumentStore {
  /** Restore the last document from IndexedDB; null when there is none. */
  load(): Promise<Doc | null>
  /** Start a new document for this participant. */
  create(init: { participant: Participant }): Promise<Doc>
  /** The current shared data. Throws before load() or create(). */
  get(): Doc
  /** RFC 7396 merge patch, validated against the contract before it lands. */
  patch(mergePatch: object, why: Why): Promise<Doc>
  /** A verdict, appended to the decision chain. */
  verdict(v: Verdict): Promise<void>
  /** The document's bytes: a .clan for this store. */
  exportClan(): Promise<Uint8Array>
  /** Called after every change; returns the unsubscribe. */
  onChange(cb: (d: Doc) => void): () => void
}
