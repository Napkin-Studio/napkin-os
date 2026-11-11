// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agent engine in the shell: the same files the template apps inline
// (app/templates/shared/agent-sphere/), loaded once into the shell's document.
// finish.js, agent-view.js, extra.js and roles.js only define tables and
// functions, so they load with this module (the lookup and the words work in
// tests and without WebGL). scene.js makes the page's ONE WebGL canvas, so it
// loads the first time a sphere mounts.

import '../../../templates/shared/agent-sphere/finish.js'
import '../../../templates/shared/agent-sphere/agent-view.js'
import '../../../templates/shared/agent-sphere/extra.js'
import '../../../templates/shared/agent-sphere/roles.js'

/** A role key: knowledge, strategy, research, brief, review, deck, orchestrator. */
export type Role = string
/** The mock's grammar for an agent's state. */
export type SphereState = 'idle' | 'working' | 'handoff' | 'needs' | 'done'

export interface SphereOpts {
  agent: string
  state?: SphereState
  /** 0..1, or [done, total]. */
  progress?: number | readonly [number, number]
  /** For a handoff: the agent taking over. */
  next?: string
  size?: number
}

export interface SphereHandle {
  set(o: Partial<SphereOpts>): void
  destroy(): void
  live: boolean
}

interface RolesApi {
  ROLES: Record<string, { name: string; job: string }>
  of(x: unknown): Role
  forStage(app: string | null | undefined, stage: string | null | undefined): Role
  ofDecision(d: { agent?: string; actor?: string; action?: string; kind?: string; polarity?: string }): Role | null
  name(r: string): string
  the(r: string): string
  The(r: string): string
  job(r: string): string
  mat(r: string): string
  caption(r: string): string
  still(r: string, size: number): string
  mount(el: HTMLElement, o: SphereOpts): SphereHandle
  configure(o: { accent?: string; inkAccent?: string; bg?: string; dark?: boolean }): void
}

const g = globalThis as unknown as { NapkinRoles: RolesApi; NapkinScene?: unknown }

/** The one lookup, the words and the spheres (roles.js). */
export const roles: RolesApi = g.NapkinRoles

let scene: Promise<void> | null = null
/** The page's one scene, made on first use. Resolves even when the page has no WebGL. */
export function loadScene(): Promise<void> {
  if (!scene) scene = typeof document === 'undefined' ? Promise.resolve()
    : import('../../../templates/shared/agent-sphere/scene.js').then(() => undefined, () => undefined)
  return scene
}

// The scene's one canvas is fixed over the page, so it must sit above the
// layer each sphere lives in (the bar is z 30-50, the Decisions drawer 85, a
// modal 130), or that layer hides it. Each mounted sphere says its layer; the
// canvas takes the highest, plus one.
const layers = new Map<HTMLElement, number>()
function layerOf(el: HTMLElement): number {
  let z = 0
  for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
    const n = parseInt(getComputedStyle(a).zIndex, 10)
    if (!Number.isNaN(n)) z = Math.max(z, n)
  }
  return z
}
function lift() {
  const c = (globalThis as unknown as { NapkinScene?: { canvas?: HTMLCanvasElement } }).NapkinScene?.canvas
  if (c) c.style.zIndex = String(Math.max(3, ...layers.values()) + 1)
}
/** A sphere mounted in `el` (or gone, `on` false): the canvas follows the layers in use. */
export function layer(el: HTMLElement, on: boolean) {
  if (on) layers.set(el, layerOf(el)); else layers.delete(el)
  lift()
}
