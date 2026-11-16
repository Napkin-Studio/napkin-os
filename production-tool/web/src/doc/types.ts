// The document store the panels use (contract 3). The CLAN store
// (model/store.ts: napkin-wasm behind clan-store's buses) is the real one; the
// snapshot store (doc/store.ts) stands in only when the wasm cannot load.
//
// Panels change a draft of the document (updateDoc, systemUpdate in
// doc/store.ts); the store turns each change into field patches and live text
// (model/diff.ts) and writes them through PatchBus and TextBus.

import type { ProductionDocument } from '../contracts/types'

export type Doc = ProductionDocument

/** Why a change was made: what the decision chain records (contracts/collab.md §8). */
export interface WriteWhy {
  /** Starts with a collab.md verb: set, create, delete, move, name, pick, start, plan, render, … */
  action: string
  rationale?: string
  /** The claim: human:<personId> (the default) or a crew id for an agent's landing. */
  agent?: string
  /** What the decision rests on: <doc>#jobs[<id>] for a landing, a version for a restore. */
  cites?: string[]
  reasoning?: Record<string, unknown>
  /** Never compressed. */
  pinned?: boolean
  /** Bookkeeping: the data changes, no decision is written. */
  quiet?: boolean
  /** An undo step of the person's (default: not quiet and not an agent's). */
  undo?: boolean
  /** Consecutive changes with the same key fold into one decision (typing). */
  coalesce?: string
  /** Mirror the .clan right after this is written (locks). */
  mirror?: boolean
}

export interface UndoResult { done: boolean; label?: string; notice?: string }

export interface DocumentStore {
  get(): Doc
  /** A change as a draft: written through the buses. Resolves the document as it is then. */
  change(fn: (draft: Doc) => void, why: WriteWhy): Promise<Doc>
  exportClan(): Promise<Uint8Array>
  onChange(cb: (d: Doc) => void): () => void
  /** Write everything pending. */
  flush(): Promise<void>
  /** The person's undo (LocalUndo); absent without the CLAN store. */
  undo?(): Promise<UndoResult>
  redo?(): Promise<UndoResult>
  /** What undo and redo would take back now ("set duration"), or null. */
  undoLabels?(): { undo: string | null; redo: string | null }
  /** A decision with no data change, as the person (the CLAN store only). */
  record?(action: string, rationale?: string, extra?: { cites?: string[]; targets?: string[]; agent?: string }): Promise<void>
  /** The id addresses start with (<doc-id>#…); the CLAN store only. */
  documentId?(): string
}
