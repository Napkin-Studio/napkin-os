// checkpoint() and hydrate() (contracts/collab.md §4): live text in a Y.Doc
// fragment <-> the flat fields the .clan keeps. checkpoint(hydrate(x)) is x for
// every fragment kind (test/text.test.ts).
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { FRAGMENT_BLOCKS, textSchema, type FragmentKind } from './extensions'

/** ProseMirror JSON of a fragment. */
export interface Prose { type: 'doc'; content?: PMNode[] }
export interface PMNode { type: string; content?: PMNode[]; text?: string; attrs?: Record<string, unknown>; marks?: unknown[] }

export const FRAGMENT_MAP: Record<FragmentKind, 'shots' | 'scenes' | 'beats' | 'reviews'> = {
  shot: 'shots', scene: 'scenes', beat: 'beats', review: 'reviews',
}
export const KIND_OF_MAP: Record<string, FragmentKind> = { shots: 'shot', scenes: 'scene', beats: 'beat', reviews: 'review' }

/** The Y.Doc name of an entity's fragment: shots/<id>. */
export function fragmentName(kind: FragmentKind, id: string): string {
  return `${FRAGMENT_MAP[kind]}/${id}`
}

/** The flat limits (document.schema.json). */
export const LIMITS = {
  shot: { action: 600, direction: 4000, refs: 14 },
  scene: { text: 20000 },
  beat: { text: 500 },
  review: { text: 1000 },
} as const
export const MAX_PROSE_BYTES = 64 * 1024

export const EMPTY_PROSE: Prose = { type: 'doc', content: [] }

/** The fragment as ProseMirror JSON (an empty fragment is an empty doc). */
export function proseOf(frag: Y.XmlFragment): Prose {
  const json = yXmlFragmentToProsemirrorJSON(frag) as Prose
  return { type: 'doc', content: json.content ?? [] }
}

/** Fill a fragment from prose, replacing what it held, in the caller's transaction. */
export function hydrate(frag: Y.XmlFragment, prose: Prose | undefined) {
  if (frag.length) frag.delete(0, frag.length)
  const content = prose?.content ?? []
  if (!content.length) return
  prosemirrorJSONToYXmlFragment(textSchema(), { type: 'doc', content }, frag)
}

/** What a ref is called now, for flat text: key_variant. */
export type RefNames = Record<string, { key: string; variant: string } | undefined>

function inlineText(nodes: PMNode[] | undefined, refs: RefNames, mentions: string[], unknown: string[]): string {
  let out = ''
  for (const n of nodes ?? []) {
    if (n.type === 'text') out += n.text ?? ''
    else if (n.type === 'hardBreak') out += '\n'
    else if (n.type === 'mention') {
      const id = String(n.attrs?.id ?? '')
      const ref = refs[id]
      if (ref) {
        out += `@${ref.key}_${ref.variant}`
        if (!mentions.includes(id)) mentions.push(id)
      } else {
        const label = String(n.attrs?.label ?? 'unknown')
        out += `@${label}`
        unknown.push(label)
      }
    }
  }
  return out
}

/** Why the fragment's blocks do not fit its kind, or null. */
export function shapeProblem(kind: FragmentKind, prose: Prose): string | null {
  const allowed: readonly string[] = FRAGMENT_BLOCKS[kind]
  const blocks = prose.content ?? []
  for (const b of blocks) if (!allowed.includes(b.type)) return `a ${kind} holds ${allowed.join(', ')}, not ${b.type}`
  if (kind === 'shot') {
    const d = blocks.findIndex((b) => b.type === 'direction')
    if (d >= 0 && (d !== blocks.length - 1)) return 'a shot\'s direction is one block, after its action'
  }
  if (kind === 'beat' && blocks.length > 1) return 'a beat holds one block'
  return null
}

export interface CheckpointResult {
  /** The fields to write, by leaf path; null clears a leaf. */
  fields: Record<string, unknown>
  /** Names that match no ref (they stay in the text, underlined). */
  unknown: string[]
  /** Fields that overflowed and kept their last valid value. */
  overflow: { field: string; length: number; limit: number }[]
}

/**
 * The flat fields of an entity from its fragment's prose. `previous` is the
 * entity as the document holds it: an overflowing field keeps its value there.
 * Throws when the prose is not a shape the kind may hold, or is over 64 KB.
 */
export function checkpoint(kind: FragmentKind, prose: Prose, opts: { refs: RefNames; previous?: Record<string, unknown>; lastWriter?: string }): CheckpointResult {
  const shape = shapeProblem(kind, prose)
  if (shape) throw new Error(shape)
  if (JSON.stringify(prose).length > MAX_PROSE_BYTES) throw new Error('This text is over 64 KB; it cannot be kept. Shorten it.')
  const mentions: string[] = []
  const unknown: string[] = []
  const overflow: CheckpointResult['overflow'] = []
  const fields: Record<string, unknown> = { prose }
  const prev = opts.previous ?? {}
  const keep = (field: string, value: string, limit: number) => {
    if (value.length <= limit) fields[field] = value
    else {
      overflow.push({ field, length: value.length, limit })
      if (typeof prev[field] === 'string') fields[field] = prev[field]
    }
  }
  const blocks = prose.content ?? []
  const text = (b: PMNode) => inlineText(b.content, opts.refs, mentions, unknown)
  if (kind === 'shot') {
    keep('action', blocks.filter((b) => b.type === 'action').map(text).join('\n'), LIMITS.shot.action)
    keep('direction', blocks.filter((b) => b.type === 'direction').map(text).join('\n'), LIMITS.shot.direction)
    if (mentions.length <= LIMITS.shot.refs) fields.refs = mentions
    else {
      overflow.push({ field: 'refs', length: mentions.length, limit: LIMITS.shot.refs })
      if (Array.isArray(prev.refs)) fields.refs = prev.refs
    }
    const first = overflow[0]
    fields.text_problem = first
      ? { ...first, message: first.field === 'refs'
          ? `This shot names ${first.length} references; a job can send ${first.limit}. Take some out.`
          : `The ${first.field} is ${first.length.toLocaleString('en')} characters; it keeps up to ${first.limit.toLocaleString('en')}. Shorten it to start a job.` }
      : null
  } else if (kind === 'scene') {
    const lines = blocks.map((b) => {
      const t = text(b)
      if (b.type === 'character') return t.toUpperCase()
      if (b.type === 'parenthetical') return `(${t})`
      return t
    })
    keep('text', lines.join('\n'), LIMITS.scene.text)
  } else {
    keep('text', blocks.map(text).join('\n'), LIMITS[kind].text)
  }
  if (opts.lastWriter) fields.last_writer = opts.lastWriter
  return { fields, unknown, overflow }
}

/** A stable hash of prose (a suggestion's base_hash): sha256 of its canonical JSON. */
export async function proseHash(prose: Prose): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(prose))
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

/** Prose from plain lines (a paste, a plan): one block per line, of `type`. */
export function proseFromLines(type: string, lines: string[]): Prose {
  return { type: 'doc', content: lines.map((l) => (l ? { type, content: [{ type: 'text', text: l }] } : { type })) }
}
