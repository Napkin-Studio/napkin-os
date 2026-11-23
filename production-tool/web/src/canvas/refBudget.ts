// How many pictures one Generate may send, counted BEFORE anything is uploaded (UAT round 1 IMG-6/7/8,
// features/pt-canvas-r1.clan). The limits are the picked model's (its alternate's refs over its op's over the
// sheet's, as relay providers/types.effective_sheet reads them): refs.max in all, refs.maxCharacter people
// (Runway subject "human") and refs.maxObject things (subject "object"; Runway images: 14, 5 and 9). Before this
// the web checked people only after the uploads (24 s of them in the UAT) and never checked things, so Dex had
// to ask which to leave out, in a card that could not be read on the canvas.

import { SHEETS } from '../contracts/load'
import type { CapabilitySheet, Config, ModelChoice, Op, RefRole } from '../contracts/types'
import { modelChoicesFor, type Sheets } from '../capabilities'

export interface RefLimits {
  /** Pictures in all (at most 14 on the canvas, as before). */
  max: number
  /** Of which people: sent as characters. */
  characters: number
  /** Of which things: every other role. Absent: only `max` bounds them. */
  objects?: number
}

/** The picture budget of `op` on the picked model (or the first routed one). */
export function refLimits(op: Op, choice: ModelChoice | undefined, config: Config, sheets: Sheets = SHEETS): RefLimits {
  const pick = choice ?? modelChoicesFor(op, config, sheets)[0]
  const sheet = pick ? sheets[pick.provider] : undefined
  const spec = sheet?.ops[op]
  if (!sheet || !spec) return { max: 0, characters: 0 }
  const alt = pick && pick.model !== spec.model ? spec.alternates?.find((a) => a.model === pick.model) : undefined
  // The op's own refs where the sheet sets them (relay SHEET_OVERRIDES), else the sheet's.
  const refs = alt?.refs ?? (spec as { refs?: CapabilitySheet['refs'] }).refs ?? sheet.refs
  const max = Math.min(14, refs.max)
  return {
    max,
    characters: Math.min(max, refs.maxCharacter ?? refs.max),
    ...(refs.maxObject !== undefined ? { objects: Math.min(max, refs.maxObject) } : {}),
  }
}

/** A picture as the provider takes it: a person (role character) or a thing (any other role). */
export type RefKind = 'person' | 'thing'

export function kindOfRole(role: RefRole | string | undefined): RefKind {
  return role === 'character' ? 'person' : 'thing'
}

export interface RefCount {
  people: number
  things: number
  total: number
  /** What is over, in the person's words, with what to do; absent when it fits. */
  problem?: string
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** The pictures counted against the limits, and what is over (the first that is). */
export function countRefs(kinds: readonly RefKind[], limits: RefLimits): RefCount {
  const people = kinds.filter((k) => k === 'person').length
  const things = kinds.length - people
  const total = kinds.length
  let problem: string | undefined
  if (total > limits.max) {
    problem = `This model takes at most ${n(limits.max, 'picture')} at once; ${total} are ticked. Untick ${total - limits.max}.`
  } else if (people > limits.characters) {
    problem = `This model takes at most ${n(limits.characters, 'person', 'people')} (characters); ${people} are ticked as people. Untick ${people - limits.characters}, or mark some as things.`
  } else if (limits.objects !== undefined && things > limits.objects) {
    problem = `This model takes at most ${n(limits.objects, 'thing')} (objects, drawings, layouts); ${things} are ticked as things. Untick ${things - limits.objects}.`
  }
  return { people, things, total, ...(problem ? { problem } : {}) }
}

/** "3 people, 8 things · up to 5 people, 9 things, 14 in all": the tray's count line. */
export function countLine(c: RefCount, limits: RefLimits): string {
  const have = `${n(c.people, 'person', 'people')}, ${n(c.things, 'thing')}`
  const can = [`up to ${n(limits.characters, 'person', 'people')}`, ...(limits.objects !== undefined ? [n(limits.objects, 'thing')] : []), `${limits.max} in all`].join(', ')
  return `${have} · ${can}`
}
