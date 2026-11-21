// Texts linked into a node are its input words (features/canvas-text.clan; owner 2026-10-16: "yes,
// text should link to nodes too"). A job the node sends carries them in JobInput.text after the
// person's own words, as the words written in a sketch area are (canvas/selection.ts instruction), so
// Dex, Skye and Fin read them the same way; the job's inputs keep a 'text' row for each.
// A shot reads the texts linked into its storyboard and into the videos that storyboard renders.

import type { Id, JobInput, JobInputRow, LinkEndpoint, Op, ProductionDocument } from '../contracts/types'
import { instruction } from '../canvas/selection'
import { linkedWords, scopeOf } from '../model/scope'

type Doc = ProductionDocument

/** The ops that read a node's words: making from it, planning it, writing it. */
export const READS_WORDS: readonly Op[] = ['generate', 'shot_list', 'frame', 'clip', 'write']

/** The nodes whose linked texts a job on `node` reads: the node, and for a shot its storyboard and the videos it renders to. */
export function readers(d: Doc, node: LinkEndpoint): Id[] {
  if (node.kind !== 'shot') return [node.id]
  const sb = d.shots[node.id]?.storyboard_id
  if (!sb) return [node.id]
  const videos = Object.values(d.links ?? {}).filter((l) => l.role === 'renders' && l.from.id === sb).map((l) => l.to.id)
  const own = d.storyboards[sb]?.video_id
  return [node.id, sb, ...videos, ...(own ? [own] : [])]
}

/** The ops on a shot that read only the texts linked into that shot (UAT round 3 R3-12, round 4 S2-1: the note that
 *  feeds the script reached every frame through the storyboard, and Dex drew all four beats as a 2x2 collage in frame
 *  3). A frame has its own beat (input.shot, and shot 1's beat as input.script); the note stays for planning. */
export const OWN_WORDS_ONLY: readonly Op[] = ['frame']

/** The linked texts a job on `node` reads, each once, in link order. `op`: a frame on a shot reads the shot's own. */
export function linkedTexts(d: Doc, node: LinkEndpoint, op?: Op): { id: Id; linkId?: Id; words: string }[] {
  const out = new Map<Id, { id: Id; linkId?: Id; words: string }>()
  const from = op && node.kind === 'shot' && OWN_WORDS_ONLY.includes(op) ? [node.id] : readers(d, node)
  for (const n of from) for (const t of linkedWords(scopeOf(d, n))) if (!out.has(t.id)) out.set(t.id, t)
  return [...out.values()]
}

/** The input with the node's linked texts' words added after the person's (words it already has are not said twice), and their rows. */
export function withLinkedText(d: Doc, op: Op, node: LinkEndpoint, input: JobInput): { input: JobInput; rows: JobInputRow[] } {
  if (!READS_WORDS.includes(op)) return { input, rows: [] }
  const texts = linkedTexts(d, node, op)
  if (!texts.length) return { input, rows: [] }
  const have = input.text ?? ''
  const add = texts.filter((t) => !have.includes(t.words))
  const rows: JobInputRow[] = texts.map((t) => ({ kind: 'text', ref: t.id, ...(t.linkId ? { link_id: t.linkId } : {}), used_as: 'note', included: true, text: t.words.slice(0, 200) }))
  return { input: add.length ? { ...input, text: instruction(have, add.map((t) => ({ text: t.words }))) } : input, rows }
}
