// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useSyncExternalStore } from 'react'
import { shared } from '../../orbs/engine'

/** Whether the desk draws its circles in 3D now: WebGL is up and the person has not kept them flat. */
export function use3D(): boolean {
  return useSyncExternalStore(f => shared().onChange(f), () => shared().canDraw() && shared().ok(), () => false)
}

/** Whether this browser can draw them in 3D at all (no WebGL: there is nothing to switch). */
export function useCanGL(): boolean {
  return useSyncExternalStore(f => shared().onChange(f), () => shared().canDraw(), () => false)
}
