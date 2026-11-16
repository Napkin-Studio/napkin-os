// The buses (contracts/collab.md): PatchBus carries field patches
// (contracts/patch.schema.json), TextBus carries live text. LocalPatchBus and
// LocalTextBus run them in one browser over ClanDocumentStore; the sync service
// (live-sync) will implement the same interfaces over the network and pass the
// same contract tests (test/bus.contract.ts).
import type { Doc, MapName } from '../types'

export type EntityName = MapName | 'project' | 'assets'

export interface Patch {
  op: 'create' | 'set' | 'delete'
  entity: EntityName
  id: string
  /** set: a leaf inside the entity, '/' between parts (camera/size). */
  path?: string
  /** create: the whole entity (id, v and field_v are filled). set: the leaf's value; null removes it. */
  value?: unknown
  /** The entity's v the writer saw (0 for a create). */
  base_version: number
}

export interface PatchWhy {
  /** Starts with a collab.md verb. */
  action: string
  /** human:<personId> or a crew id. Default: the bus's person. */
  agent?: string
  rationale?: string
  reasoning?: Record<string, unknown>
  /** Addresses or decision ids the decision rests on. */
  cites?: string[]
  pinned?: boolean
  /** Bookkeeping: change the data, write no decision. */
  quiet?: boolean
}

export interface PatchBatch {
  patches: Patch[]
  why: PatchWhy
}

export type RefusalReason = 'owned_by_text' | 'not_leaf' | 'invalid' | 'not_found' | 'exists' | 'read_only'

export interface PatchConflict {
  index: number
  entity: EntityName
  id: string
  path?: string
  base_version: number
  field_v: number
  /** The value that won. */
  current?: unknown
}

export interface PatchResult {
  applied: boolean
  /** The new v of every entity touched, by '<entity>/<id>'. */
  v: Record<string, number>
  conflicts: PatchConflict[]
  refused: { index: number; reason: RefusalReason; message: string }[]
  /** The batch that undoes this one. */
  inverse?: PatchBatch
}

export interface ApplyOptions {
  /** Record the batch as an undo step (default: true unless the batch is quiet). */
  undo?: boolean
  /** Join the previous undo step (one user action that writes twice, e.g. text then fields). */
  joinStep?: boolean
  /** checkpoint() only: write the fields live text owns. */
  checkpoint?: boolean
  /** Skip the version check (checkpoints, and undo/redo after its own check). */
  force?: boolean
}

export interface PatchBus {
  /** The document as the bus last saw it. */
  doc(): Doc
  /** Apply a batch atomically: all of it, or none of it with the reasons. */
  apply(batch: PatchBatch, opts?: ApplyOptions): Promise<PatchResult>
  /** Called after every applied batch. */
  onApplied(cb: (r: PatchResult, batch: PatchBatch) => void): () => void
}
