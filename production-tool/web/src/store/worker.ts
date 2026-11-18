// The store Worker's entry (features/engine-store.clan): the one place in the
// browser where napkin-wasm runs and the .clan is written. client.ts spawns it.

import { indexedDbPersistence } from '../../../clan-store/src'
import { zstdCodec } from '../../../canvas-engine/src/checkpoint/zstd'
import { idbLiveLog, memoryLiveLog } from './liveLog'
import type { Endpoint } from './protocol'
import { StoreServer } from './server'

new StoreServer(self as unknown as Endpoint, {
  persistence: (name) => (name ? indexedDbPersistence(name) : null),
  liveLog: (name) => (name ? idbLiveLog(name) : memoryLiveLog()),
  codec: zstdCodec,
})
