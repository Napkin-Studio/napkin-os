// A brief's spine (features/brief-node.clan, owner 2026-11-17): the few parts of a Brief Maker brief
// every agent reads — insight, proposition, audience, tone, what they should feel, mandatories,
// don'ts, format. BRIEF_SPINE is the one declaration of where each part comes from in the brief's
// data and how long it may be (common.schema.json#/$defs/briefSpine says the same lengths). A part
// the brief does not have is left out, never guessed; an unknown field is skipped.
//
// Brief Maker has no don'ts field: the don'ts are the brief's mandatories worded as a prohibition
// ("Don't…", "Do not…", "Never…", "Avoid…", "No …"), and they are not repeated as mandatories.

import type { BriefSpine, BriefSpinePart } from '../contracts/types'
import { BRIEF_SPINE_PARTS } from '../contracts/types'

export const BRIEF_APP_ID = 'ie.napkin.brief-maker' as const

interface PartRule {
  /** The brief's data paths it is made from, in order (dotted). */
  from: readonly string[]
  /** Characters per text, cut at a word. */
  max: number
  /** For a list: how many lines at most. */
  items?: number
  label: string
}

/** The declaration: spine part ← Brief Maker data path(s), with its length. */
export const BRIEF_SPINE: Readonly<Record<BriefSpinePart, PartRule>> = {
  insight: { from: ['insight'], max: 400, label: 'Insight' },
  proposition: { from: ['single_minded_proposition'], max: 200, label: 'Proposition' },
  audience: { from: ['audience'], max: 400, label: 'Audience' },
  tone: { from: ['tone_and_world'], max: 300, label: 'Tone' },
  feel: { from: ['desired_response.feel'], max: 200, label: 'What they should feel' },
  mandatories: { from: ['mandatories'], max: 120, items: 6, label: 'Mandatories' },
  donts: { from: ['mandatories'], max: 120, items: 6, label: 'Don’ts' },
  format: { from: ['media_roles'], max: 160, label: 'Format' },
}

const PROHIBITION = /^(?:don['’]?t|do not|never|avoid|no)\b/i

/** Is this line a prohibition (a don't)? */
export const isDont = (line: string): boolean => PROHIBITION.test(line.trim())

/** Cut at a word to `max` characters, with an ellipsis when cut. */
export function cutAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const room = t.slice(0, max)
  const at = room.lastIndexOf(' ')
  return `${(at > max * 0.6 ? room.slice(0, at) : room.slice(0, max - 1)).replace(/[\s,;:.]+$/, '')}…`
}

/** A value at a dotted path, or undefined. */
function at(data: unknown, path: string): unknown {
  let v: unknown = data
  for (const k of path.split('.')) {
    if (!v || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

/** A field's words: a string, or a filled-in field ({value}), each line of a list. */
function lines(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : []
  if (Array.isArray(v)) return v.flatMap(lines)
  if (v && typeof v === 'object' && 'value' in v) return lines((v as { value: unknown }).value)
  if (v && typeof v === 'object' && 'text' in v) return lines((v as { text: unknown }).text)
  return []
}

const textOf = (data: unknown, rule: PartRule): string | undefined => {
  const all = rule.from.flatMap((p) => lines(at(data, p)))
  if (!all.length) return undefined
  return cutAtWord(all.join('; '), rule.max)
}

const listOf = (data: unknown, rule: PartRule, keep: (line: string) => boolean): string[] | undefined => {
  const all = rule.from.flatMap((p) => lines(at(data, p))).filter(keep)
  if (!all.length) return undefined
  return all.slice(0, rule.items ?? 6).map((l) => cutAtWord(l, rule.max))
}

/** Is a spine part made from a brief part a person marked Confidential? A marked parent covers its children. */
function confidentialPart(rule: PartRule, marked: readonly string[]): boolean {
  return rule.from.some((p) => marked.some((m) => p === m || p.startsWith(`${m}.`) || m.startsWith(`${p}.`)))
}

/** The spine of a Brief Maker brief's data, and which spine parts carry Confidential brief parts. */
export function projectSpine(data: unknown): { spine: BriefSpine; confidential: BriefSpinePart[] } {
  const spine: BriefSpine = {}
  for (const part of BRIEF_SPINE_PARTS) {
    const rule = BRIEF_SPINE[part]
    if (part === 'mandatories') {
      const v = listOf(data, rule, (l) => !isDont(l))
      if (v) spine.mandatories = v
    } else if (part === 'donts') {
      const v = listOf(data, rule, isDont)
      if (v) spine.donts = v
    } else {
      const v = textOf(data, rule)
      if (v) spine[part] = v
    }
  }
  const marked = lines(at(data, 'confidential_fields'))
  const confidential = BRIEF_SPINE_PARTS.filter((p) => spine[p] !== undefined && confidentialPart(BRIEF_SPINE[p], marked))
  return { spine, confidential }
}

/** One line of the spine as the Booth lists it: its label and its words (a list's lines for mandatories and don'ts). */
export interface SpineLine {
  part: BriefSpinePart
  label: string
  text?: string
  items?: string[]
  confidential: boolean
}

/** The spine's parts in order, for the Booth's full view; parts the brief does not have are left out. */
export function spineLines(spine: BriefSpine, confidential: readonly BriefSpinePart[] = []): SpineLine[] {
  return BRIEF_SPINE_PARTS.flatMap((part) => {
    const v = spine[part]
    if (v === undefined || (Array.isArray(v) && !v.length)) return []
    const base = { part, label: BRIEF_SPINE[part].label, confidential: confidential.includes(part) }
    return [Array.isArray(v) ? { ...base, items: v } : { ...base, text: v }]
  })
}

/** What a spine holds, in a few words: "proposition, audience, tone, feel, 2 mandatories, 1 don't". */
export function spineSummary(spine: BriefSpine): string {
  const out: string[] = []
  for (const part of BRIEF_SPINE_PARTS) {
    const v = spine[part]
    if (v === undefined) continue
    if (part === 'mandatories' && Array.isArray(v)) out.push(`${v.length} ${v.length === 1 ? 'mandatory' : 'mandatories'}`)
    else if (part === 'donts' && Array.isArray(v)) out.push(`${v.length} don’t${v.length === 1 ? '' : 's'}`)
    else out.push(part)
  }
  return out.join(', ')
}

/** Is the spine empty (a brief with none of its parts filled in)? */
export const spineEmpty = (spine: BriefSpine): boolean => BRIEF_SPINE_PARTS.every((p) => spine[p] === undefined)
