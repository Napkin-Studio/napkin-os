// The canvas checkpoint (features/engine-store.clan): its header, a newer
// version refused, the round trip through zstd, and compaction.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { CHECKPOINT_NAME, checkpointOf, CheckpointTooNew, compactState, decodeCheckpoint, encodeCheckpoint } from '../src/checkpoint/checkpoint'
import { zstdCodec } from '../src/checkpoint/zstd'
import { element } from '../src/model/records'
import { SceneStore } from '../src/model/store'

describe('the canvas checkpoint', () => {
  it('is never named .json', () => {
    expect(CHECKPOINT_NAME).toBe('canvas.ybin.zst')
  })

  it('starts NCY and its format version, and round-trips a scene through zstd', async () => {
    const codec = await zstdCodec()
    const doc = new Y.Doc()
    const s = new SceneStore(doc)
    s.seed([element({ id: 'a', kind: 'shape', z: 'a0', x: 1, y: 2, w: 3, h: 4, props: { geo: 'rect' } })])
    const bytes = checkpointOf(doc, codec)
    expect([...bytes.subarray(0, 4)]).toEqual([0x4e, 0x43, 0x59, 1])
    const back = new Y.Doc()
    Y.applyUpdate(back, decodeCheckpoint(bytes, codec))
    expect(new SceneStore(back).get('a')).toEqual(s.get('a'))
  })

  it('refuses a newer format and bytes that are not a checkpoint', async () => {
    const codec = await zstdCodec()
    const bytes = encodeCheckpoint(new Uint8Array([0, 0]), codec)
    bytes[3] = 2
    expect(() => decodeCheckpoint(bytes, codec)).toThrow(CheckpointTooNew)
    expect(() => decodeCheckpoint(new Uint8Array([1, 2, 3, 4, 5]), codec)).toThrow(/Not a canvas checkpoint/)
  })

  it('compaction drops what was deleted', () => {
    const doc = new Y.Doc()
    const s = new SceneStore(doc)
    s.seed([element({ id: 'a', kind: 'shape', z: 'a0', props: { geo: 'rect' } })])
    for (let i = 0; i < 200; i++) s.change((tx) => tx.put([{ ...tx.get('a')!, x: i }]))
    const compact = compactState(doc)
    expect(compact.length).toBeLessThanOrEqual(Y.encodeStateAsUpdate(doc).length)
    const back = new Y.Doc()
    Y.applyUpdate(back, compact)
    expect(new SceneStore(back).get('a')!.x).toBe(199)
  })
})
