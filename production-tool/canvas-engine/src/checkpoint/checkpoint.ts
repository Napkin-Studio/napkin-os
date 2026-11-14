// The canvas checkpoint (features/canvas-engine.clan, contracts: "The canvas
// checkpoint member"): human/assets/canvas.ybin.zst in the project's .clan.
//
//   bytes 0-2  'N' 'C' 'Y'
//   byte  3    the format version (1)
//   bytes 4-   zstd (level 3) of Y.encodeStateAsUpdate of a compacted doc
//
// The checkpoint is the Y binary, never a doc rebuilt from JSON (rebuilding
// duplicates content), and never carries undo history (there is none in the doc;
// compaction keeps gc on). A build meeting a newer version opens the canvas
// read-only. Never named .json: the host would add a text sidecar.

import * as Y from 'yjs'

export const CHECKPOINT_NAME = 'canvas.ybin.zst'
export const CHECKPOINT_VERSION = 1
export const ZSTD_LEVEL = 3
const MAGIC = [0x4e, 0x43, 0x59] // NCY

export interface Codec {
  compress(bytes: Uint8Array, level: number): Uint8Array
  decompress(bytes: Uint8Array): Uint8Array
}

export class CheckpointTooNew extends Error {
  readonly version: number
  constructor(version: number) {
    super(`This canvas was saved by a newer version (checkpoint format ${version}). Reload to get the latest version.`)
    this.version = version
  }
}

/** The doc's state with deleted content collected: what a checkpoint holds. */
export function compactState(doc: Y.Doc): Uint8Array {
  const fresh = new Y.Doc({ gc: true })
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc))
  const out = Y.encodeStateAsUpdate(fresh)
  fresh.destroy()
  return out
}

export function encodeCheckpoint(state: Uint8Array, codec: Codec): Uint8Array {
  const body = codec.compress(state, ZSTD_LEVEL)
  const out = new Uint8Array(4 + body.length)
  out.set(MAGIC, 0)
  out[3] = CHECKPOINT_VERSION
  out.set(body, 4)
  return out
}

/** The Y update a checkpoint holds. Throws CheckpointTooNew for a newer format, and on bytes that are not one. */
export function decodeCheckpoint(bytes: Uint8Array, codec: Codec): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2]) throw new Error('Not a canvas checkpoint.')
  if (bytes[3] > CHECKPOINT_VERSION) throw new CheckpointTooNew(bytes[3])
  return codec.decompress(bytes.subarray(4))
}

/** A checkpoint of the doc as it is now. */
export function checkpointOf(doc: Y.Doc, codec: Codec): Uint8Array {
  return encodeCheckpoint(compactState(doc), codec)
}
