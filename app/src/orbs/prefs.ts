// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Flat circles": a person's choice to keep the circles flat even where WebGL
// works (a slow machine, a taste). Kept in this browser only; never needed for
// anything to work, so a blocked store just means the default (3D where possible).

import { shared } from './engine'

const KEY = 'napkin.circles.flat'

// The desk draws its clients as the approved mock's flat colour discs unless the
// person turns 3D on (account menu, Flat circles off): flat is the default, and
// '0' under the key is the person's choice of 3D.
export function flatPref(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setFlatPref(flat: boolean): void {
  try { localStorage.setItem(KEY, flat ? '1' : '0') } catch { /* not kept */ }
  shared().setFlat(flat)
}

/** Apply the saved choice to the engine; call once when the landing starts. */
export function applyFlatPref(): boolean {
  const flat = flatPref()
  shared().setFlat(flat)
  return flat
}
