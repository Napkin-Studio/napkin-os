// The document store interface, shared with the CLAN store lane
// (feat/production-tool-clan, production-tool/clan-store) so the napkin-wasm
// store can replace the JSON/IndexedDB one without the panels changing.

import type { ProductionDocument } from '../contracts/types'

export type Doc = ProductionDocument

export interface Verdict {
  kind: 'accept' | 'reject' | 'select'
  target: { kind: string; id: string }
  note?: string
}

export interface DocumentStore {
  load(): Promise<Doc | null>
  create(init: { participant: { id: string; handle: string } }): Promise<Doc>
  get(): Doc
  /** RFC 7396 JSON merge patch. */
  patch(mergePatch: object, why: { action: string; rationale?: string }): Promise<Doc>
  verdict(v: Verdict): Promise<void>
  exportClan(): Promise<Uint8Array>
  onChange(cb: (d: Doc) => void): () => void
  /** A decision with no data change, as the participant (the CLAN store only). */
  record?(action: string, rationale?: string): Promise<void>
}
