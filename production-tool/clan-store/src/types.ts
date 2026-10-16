// The interface every Production Tool document store implements. Keep it
// minimal: the web app reads the document through its own types
// (web/src/contracts/types.ts, the schema's mirror); here the document is
// typed only as far as the store, the buses and the integrity check need.

/** One entity of a contract-3 map: its id (= its key), version, and leaf versions. */
export interface Entity {
  id: string
  v: number
  field_v: Record<string, number>
  [field: string]: unknown
}

export const MAP_NAMES = ['boards', 'sketches', 'scripts', 'scenes', 'storyboards', 'shots', 'beats', 'frames', 'videos', 'takes', 'renders', 'reviews',
  'links', 'keys', 'refs', 'documents', 'texts', 'format_sets', 'sizes', 'checks', 'asks', 'suggestions', 'spin_ins', 'jobs', 'stale', 'exports'] as const
export type MapName = (typeof MAP_NAMES)[number]

export interface Project {
  id: string
  tenant_id: string
  client_id?: string
  title: string
  created_by: string
  created_at: string
}

/** shared/data.yaml of a contract-3 Production Tool document
 * (production-tool/contracts/document.schema.json). The schema, validated on
 * every write, is the authority. */
export type Doc = {
  contract_version: '3'
  app: 'production-tool'
  project: Project
  upstream?: Record<string, Record<string, unknown>>
  assets: Record<string, DocAsset>
} & Record<MapName, Record<string, Entity>>

/** One entry of `assets` (document.schema.json#/$defs/asset). */
export interface DocAsset {
  sha256: string
  kind: 'image' | 'video' | 'audio' | 'document' | 'font' | 'vector'
  mime: string
  origin: 'uploaded' | 'drawn' | 'generated' | 'mock' | 'edited' | 'extracted'
  locations: string[]
  bytes?: number
  w?: number
  h?: number
  duration_s?: number
  pages?: number
  job_id?: string
  thumb?: string
}

/** Who is writing: a person signed in to Napkin Studio, in their agency. */
export interface Person {
  /** The participantId (GET /me); recorded as human:<id>. */
  id: string
  handle: string
  tenant_id: string
}

/** Why a write was made: recorded in the decision chain. */
export interface Why {
  /** Starts with a collab.md verb (plan, render, pick, restore, set, …). */
  action: string
  rationale?: string
  /** The claim: human:<personId> for a person, the crew id for an agent. Default: the person. */
  agent?: string
  /** Never compressed. */
  pinned?: boolean
  /** Bookkeeping (a job's state, a checkpoint): the data changes, no decision is written. */
  quiet?: boolean
  /** Addresses this decision is about (napkin-host records them on the decision). */
  targets?: string[]
  /** What it rests on: addresses or decision ids. */
  cites?: string[]
  /** clan-sdk Reasoning, for an agent's decision. */
  reasoning?: Record<string, unknown>
}

export interface DocumentStore {
  /** Restore the last document from IndexedDB; null when there is none. */
  load(): Promise<Doc | null>
  /** Start a new project for this person. */
  create(init: { person: Person; title?: string }): Promise<Doc>
  /** The current shared data. Throws before load() or create(). */
  get(): Doc
  /** RFC 7396 merge patch, validated against the contract before it lands.
   * The buses (src/bus) are the way the app writes; this is what they call. */
  patch(mergePatch: object, why: Why): Promise<Doc>
  /** The document's bytes: a .clan for this store. */
  exportClan(): Promise<Uint8Array>
  /** Called after every change; returns the unsubscribe. */
  onChange(cb: (d: Doc) => void): () => void
}
