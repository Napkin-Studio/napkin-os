// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** The materials a client may be made of: the disc, and the ink on it. */
export const MATERIALS = {
  pearl: { base: '#EEECE7', edge: '#D9D6CE', ink: '#16191D' },
  ceramic: { base: '#E4DCCF', edge: '#CFC5B4', ink: '#2A2622' },
  stone: { base: '#B9BCC3', edge: '#A2A5AD', ink: '#16191D' },
  graphite: { base: '#242936', edge: '#3A4050', ink: '#EEF0F4' },
  onyx: { base: '#12141A', edge: '#2A2E38', ink: '#F1F2F5' },
  paper: { base: '#F7F7F5', edge: '#DEDDD8', ink: '#16191D' },
} as const

export type Material = keyof typeof MATERIALS

export const materialOf = (m: string): (typeof MATERIALS)[Material] =>
  (MATERIALS as Record<string, (typeof MATERIALS)[Material]>)[m] ?? MATERIALS.pearl
