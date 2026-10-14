// The browser's store (features/engine-store.clan): a StoreClient over a
// dedicated module Worker per project, restarted if the browser kills it.

import type { Person } from '../../../clan-store/src'
import { StoreClient, type StoreWorker } from './client'

export function spawnStoreWorker(): StoreWorker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'napkin-store' })
  return Object.assign(w, {
    onDeath(cb: () => void) {
      w.addEventListener('error', (e) => {
        console.warn('the store Worker stopped', e)
        cb()
      })
    },
  })
}

/** The project's .clan store in its own Worker, over IndexedDB database `idbName`. */
export function browserClanStore(idbName: string, person?: Person | null): StoreClient {
  return new StoreClient({ spawn: spawnStoreWorker, idbName, person })
}
