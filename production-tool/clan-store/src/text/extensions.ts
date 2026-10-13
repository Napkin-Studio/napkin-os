// The one extension set for shared live text (contracts/collab.md, "Node set").
//
// checkpoint() and hydrate() build their ProseMirror schema from exactly these
// extensions, and the editors (script, storyboard, video notes) mount the same
// list, so a fragment written in an editor and a fragment rebuilt from a .clan
// are the same shape. Change this list and the parity test (text.test.ts)
// says whether old prose still round-trips.
import { getSchema, Node, type AnyExtension } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'

const block = (name: string, content: string, extra: Partial<Parameters<typeof Node.create>[0]> = {}) =>
  Node.create({
    name,
    group: 'block',
    content,
    defining: true,
    parseHTML: () => [{ tag: `p[data-type="${name}"]` }],
    renderHTML: () => ['p', { 'data-type': name }, 0],
    ...extra,
  })

/** The top node of every fragment. Which blocks a fragment may hold depends on
 * its kind (shot, scene, beat, review); checkpoint() checks that, the schema
 * does not, so one schema serves all four. */
export const DocNode = Node.create({ name: 'doc', topNode: true, content: 'block+' })
export const TextNode = Node.create({ name: 'text', group: 'inline' })

/** Screenplay action, a shot's action, a beat's words, a note's words. */
export const Action = block('action', 'inline*')
/** A speaker's name above dialogue (unplanned scene text only; a planned line
 * keeps its speaker as the beat's `speaker` field). */
export const Character = block('character', 'text*', { marks: '' })
/** (beat) under a character. A planned line keeps it as `parenthetical`. */
export const Parenthetical = block('parenthetical', 'text*', { marks: '' })
/** Spoken words. */
export const Dialogue = block('dialogue', 'inline*')
/** A shot's performance direction (at most one block, after the action). */
export const Direction = block('direction', 'inline*')

/** `@name` stored as the ref's id, so a rename changes every mention. `label`
 * is the name when it was inserted: shown only when the ref is gone. */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({
    id: { default: null },
    label: { default: null },
  }),
  parseHTML: () => [{ tag: 'span[data-type="mention"]' }],
  renderHTML: ({ node }) => ['span', { 'data-type': 'mention', 'data-id': node.attrs.id }, `@${node.attrs.label ?? ''}`],
  renderText: ({ node }) => `@${node.attrs.label ?? ''}`,
})

export const HardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: () => ['br'],
  renderText: () => '\n',
})

export const TEXT_EXTENSIONS: AnyExtension[] = [DocNode, TextNode, Action, Character, Parenthetical, Dialogue, Direction, Mention, HardBreak]

let cached: Schema | null = null
/** The ProseMirror schema of TEXT_EXTENSIONS, built once. */
export function textSchema(): Schema {
  return (cached ??= getSchema(TEXT_EXTENSIONS))
}

/** The block types each fragment kind may hold, in the order they may appear. */
export const FRAGMENT_BLOCKS = {
  /** shots/<id>: action blocks, then at most one direction block. */
  shot: ['action', 'direction'],
  /** scenes/<id>: unplanned screenplay text no shot owns yet. */
  scene: ['action', 'character', 'parenthetical', 'dialogue'],
  /** beats/<id>: one block. A line is dialogue; every other kind is action. */
  beat: ['action', 'dialogue'],
  /** reviews/<id>: the note's words. */
  review: ['action'],
} as const

export type FragmentKind = keyof typeof FRAGMENT_BLOCKS
