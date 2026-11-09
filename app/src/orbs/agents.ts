// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agent a circle shows, in the form the shader wants. The landing's circles
// are not the clan's agents: a client, a tool and the studio are PSEUDO-agents,
// a blank sphere in one of the matte-to-gloss materials (no arcs, no emblem
// circles) with the initials laid over it in the DOM. The clan's agents
// (emblem geometry) are not here and are not changed by this feature; the
// sphere/ring code takes any `Agent` with geometry when one is added.

import { MATS, TYPES, type Kind } from './tables'

export interface Agent {
  key: string
  n: number
  base: Float32Array
  ink: Float32Array
  /** gloss, metal, glass */
  mat: Float32Array
  type: string
  t: Kind
  sp: number
  na: number
  nc: number
  arcF: Float32Array
  cirF: Float32Array
}

export const rgb = (h: string): number[] => {
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k)

/** A stable small number per key, so each client's sphere breathes at its own pace. */
const seed = (key: string): number => {
  let h = 7
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 9973
  return h
}

const CACHE = new Map<string, Agent>()

/**
 * The pseudo-agent for a material name, or null for a material the tables do not
 * have: an unknown agent stays the flat neutral circle.
 */
export function pseudoAgent(material: unknown): Agent | null {
  if (!own(MATS, material)) return null
  const hit = CACHE.get(material)
  if (hit) return hit
  const m = MATS[material]
  const n = seed(material)
  const a: Agent = {
    key: material,
    n,
    base: Float32Array.from(rgb(m.base)),
    ink: Float32Array.from(rgb(m.ink)),
    mat: Float32Array.from([m.gloss, m.metal, m.glass]),
    type: 'hold',
    t: TYPES.hold,
    sp: 0.8 + ((n * 37) % 11) / 20,
    na: 0,
    nc: 0,
    arcF: new Float32Array(28),
    cirF: new Float32Array(12),
  }
  CACHE.set(material, a)
  return a
}
