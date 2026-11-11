// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useSyncExternalStore } from 'react'
import type { SaveQueue, SaveState } from './saveQueue'

/** The queue's state, redrawn when it changes. */
export function useSaveState(queue: SaveQueue): SaveState {
  useSyncExternalStore(queue.subscribe, queue.version, queue.version)
  return queue.state()
}
