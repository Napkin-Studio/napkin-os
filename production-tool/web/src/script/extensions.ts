// The extensions every script editor mounts (features/script-editor.clan): exactly
// clan-store's node set (TEXT_EXTENSIONS, so a fragment typed here round-trips through
// checkpoint and hydrate; dedupe.test.ts checks the schema), plus behaviour only:
//
// - FragmentSync: the Collaboration binding to one entity's fragment, with NO undo of
//   its own (no yUndoPlugin, no keymap): typing becomes LocalUndo steps (typing.ts).
// - LengthLimit: what checkpoint keeps, counted as checkpoint counts it (a mention as
//   @key_variant, through flatText): typing that grows a field past its limit is
//   refused; a paste past it keeps what fits and says so.
// - ShapeGuard: a local change that leaves blocks the fragment kind may not hold is refused.
// - ScriptKeys: Tab and Enter cycle the screenplay elements, arrows and Tab cross into
//   the next fragment through the caret chain, ⌥M (event.code) adds a moment, and
//   Escape then Tab leaves the editor.
// - Placeholder.
//
// No StarterKit, UniqueID, DragHandle or BubbleMenu: none of them may add a node or mark.

import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extensions'
import type { Node as PMNode, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ySyncPlugin } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import type { ProductionDocument } from '../contracts/types'
import { mentionExtensions, type MentionHooks } from './mentions'
import { flatText, FRAGMENT_BLOCKS, LIMITS, shapeProblem, TEXT_EXTENSIONS, type FragmentKind, type PMNode as JsonNode, type Prose, type RefNames } from '../../../clan-store/src'

// ── FragmentSync ────────────────────────────────────────────────────────────

/** Collaboration bound to one fragment, without its undo plugin and keymap (collab.md §10). */
export const FragmentSync = Collaboration.extend({
  addCommands() {
    return {}
  },
  addKeyboardShortcuts() {
    return {}
  },
  addProseMirrorPlugins() {
    const fragment = this.options.fragment as Y.XmlFragment | null
    if (!fragment) return []
    return [ySyncPlugin(fragment, { ...this.options.ySyncOptions, onFirstRender: this.options.onFirstRender })]
  },
})

// ── lengths ─────────────────────────────────────────────────────────────────

export type Field = 'action' | 'direction' | 'text'

/** The limit of each flat field a fragment kind writes (LIMITS mirrors document.schema.json). */
export function limitsOf(kind: FragmentKind): Partial<Record<Field, number>> {
  if (kind === 'shot') return { action: LIMITS.shot.action, direction: LIMITS.shot.direction }
  if (kind === 'scene') return { text: LIMITS.scene.text }
  return { text: LIMITS[kind].text }
}

/** The field a block writes into. */
export function fieldOf(kind: FragmentKind, blockType: string): Field {
  if (kind === 'shot') return blockType === 'direction' ? 'direction' : 'action'
  return 'text'
}

/** The flat length of each field, as checkpoint writes it (a scene's character upper-cased, a parenthetical in brackets). */
export function fieldLengths(kind: FragmentKind, doc: Prose | PMNode, refs: RefNames): Partial<Record<Field, number>> {
  const blocks: JsonNode[] = 'toJSON' in doc ? ((doc as PMNode).toJSON() as Prose).content ?? [] : (doc as Prose).content ?? []
  const out: Partial<Record<Field, number>> = {}
  const add = (f: Field, n: number) => { out[f] = out[f] === undefined ? n : out[f]! + 1 + n }
  for (const b of blocks) {
    const n = flatText(b.content, refs).length + (b.type === 'parenthetical' ? 2 : 0)
    add(fieldOf(kind, b.type), n)
  }
  return out
}

// ── hooks the editor's owner gives ──────────────────────────────────────────

export interface KeyHooks {
  /** Leave through the top or bottom edge (arrows, Tab at the end): true when the caret moved on. */
  out?(dir: 'up' | 'down', editor: Editor): boolean
  /** Enter on a line that names a scene (INT., EXT., I/E, EST., '.'), in unplanned scene text. */
  sceneHeading?(heading: string, blockIndex: number, editor: Editor): boolean
  /** ⌥M: a moment at the caret's shot. */
  moment?(editor: Editor): boolean
  /** Character in a planned shot: a line beat. */
  lineBeat?(editor: Editor): boolean
  /** Escape: close the innermost popover first. True when one closed. */
  escape?(): boolean
  /** Enter, before the element rules: true when the page took it (an empty script's one line drafts). */
  enter?(editor: Editor): boolean
  /** A paste of several lines into unplanned scene text (a script): true when the page took it. */
  pasteScript?(text: string, editor: Editor): boolean
}

export interface EditorOptions {
  kind: FragmentKind
  /** The entity's fragment (TextBus.fragment); none for a schema-only editor (tests). */
  fragment?: Y.XmlFragment
  /** The document's refs, for counting mentions as checkpoint does. */
  refs?: () => RefNames
  keys?: KeyHooks
  /** Words the person must see ('Kept the first 4,000 characters'). */
  notice?: (message: string) => void
  placeholder?: string | ((blockType: string, index: number) => string)
  /** The compact Storyboard-card editor: no element cycling, Enter makes a new action line. */
  compact?: boolean
  /** The editor these extensions run in (set once it exists; for paste hooks). */
  editor?: () => Editor
  /** @ mentions: the popover, names now, the underline (mentions.ts). */
  mentions?: () => MentionHooks | undefined
}

const NO_REFS = (): RefNames => ({})

// ── LengthLimit and ShapeGuard ──────────────────────────────────────────────

const local = (tr: Transaction) => tr.docChanged && !isChangeOrigin(tr) && !tr.getMeta('napkinTrusted')

function limitPlugin(opts: EditorOptions): Plugin {
  const refs = opts.refs ?? NO_REFS
  const limits = limitsOf(opts.kind)
  return new Plugin({
    key: new PluginKey('napkinLength'),
    filterTransaction(tr, state) {
      if (!local(tr)) return true
      const after = fieldLengths(opts.kind, tr.doc, refs())
      const before = fieldLengths(opts.kind, state.doc, refs())
      for (const [f, limit] of Object.entries(limits) as [Field, number][]) {
        const n = after[f] ?? 0
        if (n > limit && n > (before[f] ?? 0)) return false
      }
      return true
    },
    props: {
      handlePaste(view, _event, slice) {
        if (opts.kind === 'scene' && opts.keys?.pasteScript && opts.editor) {
          const text = sliceText(slice)
          if (text.includes('\n') && opts.keys.pasteScript(text, opts.editor())) return true
        }
        return pasteWithin(view, slice, opts)
      },
    },
  })
}

/** Plain words of a slice, a mention as @label. */
function sliceText(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, '\n', (leaf) => (leaf.type.name === 'mention' ? `@${leaf.attrs.label ?? ''}` : leaf.type.name === 'hardBreak' ? '\n' : ''))
}

/** A paste that would pass the field's limit keeps what fits, as plain words, and says so. */
export function pasteWithin(view: EditorView, slice: Slice, opts: EditorOptions): boolean {
  const refs = (opts.refs ?? NO_REFS)()
  const { state } = view
  const block = state.selection.$from.parent
  const field = fieldOf(opts.kind, block.type.name)
  const limit = limitsOf(opts.kind)[field]
  if (limit === undefined) return false
  const now = fieldLengths(opts.kind, state.doc, refs)[field] ?? 0
  const chosen = state.doc.textBetween(state.selection.from, state.selection.to, '\n').length
  const text = sliceText(slice)
  const room = limit - (now - chosen)
  if (text.length <= room && (slice.content.childCount <= 1 || opts.kind === 'scene')) return false
  const kept = text.slice(0, Math.max(0, room))
  const tr = state.tr
  if (field === 'direction' || opts.kind !== 'scene') {
    // One block's words: lines become line breaks inside it.
    const parts = kept.split('\n')
    tr.deleteSelection()
    parts.forEach((p, i) => {
      if (i > 0) tr.replaceSelectionWith(state.schema.nodes.hardBreak.create(), false)
      if (p) tr.insertText(p)
    })
  } else tr.insertText(kept, state.selection.from, state.selection.to)
  tr.setMeta('napkinTrusted', true)
  view.dispatch(tr)
  if (text.length > room) opts.notice?.(`Kept the first ${limit.toLocaleString('en')} characters`)
  return true
}

function shapePlugin(kind: FragmentKind): Plugin {
  return new Plugin({
    key: new PluginKey('napkinShape'),
    filterTransaction(tr, state) {
      if (!tr.docChanged || isChangeOrigin(tr)) return true
      const after = shapeProblem(kind, tr.doc.toJSON() as Prose)
      if (!after) return true
      // Never block a change that leaves an already-wrong fragment no worse.
      return shapeProblem(kind, state.doc.toJSON() as Prose) !== null
    },
  })
}

// ── ScriptKeys ──────────────────────────────────────────────────────────────

/** The screenplay elements' Tab cycle (Trelby): Action → Character → Dialogue → Action. */
export const TAB_NEXT: Record<string, string> = { action: 'character', character: 'dialogue', dialogue: 'action', parenthetical: 'dialogue' }
export const TAB_PREV: Record<string, string> = { action: 'dialogue', character: 'action', dialogue: 'character', parenthetical: 'character' }
/** What Enter at the end of a block makes next: Character → Dialogue → Action. */
export const ENTER_NEXT: Record<string, string> = { action: 'action', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'action' }

/** A scene heading at the start of a line: INT., EXT., INT./EXT., I/E, EST., or a forced '.' heading. */
export const HEADING = /^(?:(?:INT\.\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[. ]\s*\S.*|\.[A-Za-z0-9].*)$/i

/** The heading a line names, without a forcing '.', or null. */
export function headingOf(line: string): string | null {
  const t = line.trim()
  if (!HEADING.test(t) || t.startsWith('..')) return null
  return t.startsWith('.') ? t.slice(1).trim() : t.toUpperCase()
}

const blockIndexAt = (state: EditorState) => state.selection.$from.index(0)

/** A line break inside the block (a direction, a beat, a note: one block each). */
function insertBreak(editor: Editor): boolean {
  const { state, view } = editor
  view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create(), false).scrollIntoView())
  return true
}

/** Set the type of the block the caret is in. */
function setBlockType(editor: Editor, type: string): boolean {
  const { state, view } = editor
  const { $from } = state.selection
  const node = state.schema.nodes[type]
  if (!node) return false
  const tr = state.tr.setBlockType($from.before(1), $from.after(1), node)
  view.dispatch(tr)
  return true
}

function keysExtension(opts: EditorOptions) {
  const kind = opts.kind
  const allowed: readonly string[] = FRAGMENT_BLOCKS[kind]
  let escaped = false
  return Extension.create({
    name: 'napkinScriptKeys',
    addKeyboardShortcuts() {
      const editor = this.editor
      const atEnd = () => editor.state.selection.empty && editor.state.selection.$from.parentOffset === editor.state.selection.$from.parent.content.size
      const lastBlock = () => blockIndexAt(editor.state) === editor.state.doc.childCount - 1
      const firstBlock = () => blockIndexAt(editor.state) === 0
      const blockType = () => editor.state.selection.$from.parent.type.name
      const tab = (shift: boolean) => {
        if (escaped) return false // Escape, then Tab: leave the editor (focus order).
        if (kind === 'scene' && !opts.compact) {
          const next = (shift ? TAB_PREV : TAB_NEXT)[blockType()]
          if (next && allowed.includes(next)) return setBlockType(editor, next)
          return true
        }
        if (kind === 'shot') {
          const t = blockType()
          if (!shift && t === 'action') {
            if (opts.compact) return opts.keys?.out?.('down', editor) ?? false
            const d = editor.state.doc.lastChild
            if (d?.type.name === 'direction') {
              editor.commands.setTextSelection(editor.state.doc.content.size - 1)
              return true
            }
            // A Direction block, after the action.
            const tr = editor.state.tr.insert(editor.state.doc.content.size, editor.state.schema.nodes.direction.create())
            tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1))
            editor.view.dispatch(tr)
            return true
          }
          if (shift && t === 'direction') {
            const at = editor.state.doc.child(0)
            editor.commands.setTextSelection(at.content.size + 1)
            return true
          }
        }
        return opts.keys?.out?.(shift ? 'up' : 'down', editor) ?? false
      }
      return {
        Tab: () => tab(false),
        'Shift-Tab': () => tab(true),
        Escape: () => {
          if (opts.keys?.escape?.()) return true
          escaped = true
          return false
        },
        Enter: () => {
          if (opts.keys?.enter?.(editor)) return true
          const t = blockType()
          if (kind === 'scene' && !opts.compact && t === 'action' && opts.keys?.sceneHeading) {
            const h = headingOf(editor.state.selection.$from.parent.textContent)
            if (h && opts.keys.sceneHeading(h, blockIndexAt(editor.state), editor)) return true
          }
          if (kind === 'shot' && t === 'direction') return insertBreak(editor)
          if (kind === 'beat' || kind === 'review') return insertBreak(editor)
          if (kind === 'scene' && !opts.compact && atEnd()) {
            const next = ENTER_NEXT[t] ?? 'action'
            const { state, view } = editor
            const tr = state.tr.deleteSelection()
            tr.split(tr.selection.from, 1, [{ type: state.schema.nodes[next] }])
            view.dispatch(tr.scrollIntoView())
            return true
          }
          return false
        },
        'Shift-Enter': () => insertBreak(editor),
        ArrowUp: () => (firstBlock() && editor.view.endOfTextblock('up') ? opts.keys?.out?.('up', editor) ?? false : false),
        ArrowDown: () => (lastBlock() && editor.view.endOfTextblock('down') ? opts.keys?.out?.('down', editor) ?? false : false),
        Backspace: () => {
          // An empty Direction goes, and the caret goes back to the action.
          const { $from, empty } = editor.state.selection
          if (kind === 'shot' && empty && $from.parent.type.name === 'direction' && $from.parent.content.size === 0 && editor.state.doc.childCount > 1) {
            const from = $from.before(1)
            const tr = editor.state.tr.delete(from, $from.after(1))
            tr.setSelection(TextSelection.near(tr.doc.resolve(from - 1), -1))
            editor.view.dispatch(tr)
            return true
          }
          return false
        },
      }
    },
    addProseMirrorPlugins() {
      const editor = this.editor
      return [new Plugin({
        key: new PluginKey('napkinEscape'),
        props: {
          handleKeyDown(_view, event) {
            if (event.key !== 'Escape' && event.key !== 'Tab' && event.key !== 'Shift') escaped = false
            // ⌥M / Alt+M, read from event.code: on a Mac the key itself is 'µ'.
            if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyM') {
              event.preventDefault()
              opts.keys?.moment?.(editor)
              return true
            }
            return false
          },
          handleDOMEvents: {
            blur: () => {
              escaped = false
              return false
            },
          },
        },
      })]
    },
  })
}

/** The top-level block at `pos`, for a placeholder. Tiptap's Placeholder passes positions in the
 *  document it is decorating, which can be ahead of editor.state while a transaction applies (a
 *  synced fragment loading several blocks): a position past the old document threw and blanked the
 *  page. The first block is position 0 in any document; past the end, the index is unknown (-1). */
function blockIndex(editor: Editor, pos: number): number {
  if (pos === 0) return 0
  return pos <= editor.state.doc.content.size ? editor.state.doc.resolve(pos).index(0) : -1
}

/** The extension list for one fragment editor. */
export function editorExtensions(opts: EditorOptions): AnyExtension[] {
  const keys = keysExtension(opts)
  const placeholder = opts.placeholder
  const mentions = opts.mentions ? mentionExtensions(opts.mentions) : []
  const nodes = mentions.length ? TEXT_EXTENSIONS.map((e) => (e.name === 'mention' ? mentions[0] : e)) : TEXT_EXTENSIONS
  // The @ popover comes after the keys: Tiptap runs later extensions' plugins first, so Enter, Tab and
  // the arrows reach an open popover before the screenplay's element cycle takes them.
  const out: AnyExtension[] = [
    ...nodes,
    keys,
    ...mentions.slice(1),
    Extension.create({
      name: 'napkinGuards',
      addProseMirrorPlugins() {
        const editor = this.editor
        return [shapePlugin(opts.kind), limitPlugin({ ...opts, editor: () => editor })]
      },
    }),
  ]
  if (opts.fragment) out.push(FragmentSync.configure({ fragment: opts.fragment }))
  if (placeholder) {
    out.push(Placeholder.configure({
      showOnlyCurrent: false,
      placeholder: ({ node, pos, editor }) => (typeof placeholder === 'string' ? placeholder : placeholder(node.type.name, blockIndex(editor, pos))),
    }))
  }
  return out
}

/** The refs as checkpoint names them: key_variant for a ref, the key alone for a whole character. */
export function refNames(d: ProductionDocument): RefNames {
  return {
    ...Object.fromEntries(Object.values(d.keys ?? {}).map((k) => [k.id, { key: k.key }])),
    ...Object.fromEntries(Object.values(d.refs ?? {}).map((r) => [r.id, { key: r.key, variant: r.variant }])),
  }
}

/** '318 / 4,000', and whether it is at the limit. */
export function counterText(length: number, limit: number): { text: string; warn: boolean } {
  return { text: `${length.toLocaleString('en')} / ${limit.toLocaleString('en')}`, warn: length >= limit }
}

/** The owner's hooks for an editor made once: they change with every render, so the editor calls through this. */
export class HookRelay {
  private hooks: KeyHooks | undefined
  private onNotice: ((m: string) => void) | undefined
  private onFocus: (() => void) | undefined
  private mentionHooks: MentionHooks | undefined

  set(hooks: KeyHooks | undefined, onNotice?: (m: string) => void, onFocus?: () => void, mentions?: MentionHooks) {
    this.hooks = hooks
    this.onNotice = onNotice
    this.onFocus = onFocus
    this.mentionHooks = mentions
  }

  mentions(): MentionHooks | undefined {
    return this.mentionHooks
  }

  notice(m: string) {
    this.onNotice?.(m)
  }

  focus() {
    this.onFocus?.()
  }

  keys(): KeyHooks {
    return {
      out: (dir, e) => this.hooks?.out?.(dir, e) ?? false,
      sceneHeading: (h, i, e) => this.hooks?.sceneHeading?.(h, i, e) ?? false,
      moment: (e) => this.hooks?.moment?.(e) ?? false,
      lineBeat: (e) => this.hooks?.lineBeat?.(e) ?? false,
      escape: () => this.hooks?.escape?.() ?? false,
      enter: (e) => this.hooks?.enter?.(e) ?? false,
      pasteScript: (t, e) => this.hooks?.pasteScript?.(t, e) ?? false,
    }
  }
}
