// zstd for the checkpoint (features/engine-store.clan): @bokuweb/zstd-wasm (MIT,
// a wasm build of the BSD zstd library), loaded once. In a browser or Worker the
// wasm is fetched beside the module (the bundler rewrites its URL); in node it is
// read from the package.

import { compress, decompress, init } from '@bokuweb/zstd-wasm'
import type { Codec } from './checkpoint'

let ready: Promise<Codec> | null = null

export function zstdCodec(): Promise<Codec> {
  ready ??= init().then(() => ({
    compress: (bytes: Uint8Array, level: number) => compress(bytes, level),
    decompress: (bytes: Uint8Array) => decompress(bytes),
  })).catch((e: unknown) => {
    ready = null
    throw e
  })
  return ready
}
