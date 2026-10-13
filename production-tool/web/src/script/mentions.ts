// @ mentions in the script editors (ui-behaviour 3.6, item 9; features/script-editor.clan),
// over the shared rules in text/mention/source.ts:
//
// - '@ma' opens a caret-anchored popover (CaretFloat): Characters, Locations, Products,
//   References, then the rest A–Z, each row with its picture. It finds @shirt_linen by its
//   label too. Enter or Tab inserts a mention {id, label}; picking a reference not linked to
//   this script links it (the page says so, with Undo).
// - A mention shows its reference's name now (a rename follows it). One whose reference is
//   gone or not linked to this script, and an @word typed that names nothing, get the warn
//   wavy underline, with 'Did you mean @maya_laughing?' when one is within 2 edits.
// No node or mark is added: the Mention node is clan-store's, with a view.

import { Extension, type AnyExtension, type Editor, type Range } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion'
import { Mention } from '../../../clan-store/src/text/extensions'
import { blobUrl, cachedBlobUrl } from '../lib/blobs'
import { closestName, GROUP_ORDER, matchMentions, type MentionItem } from '../text/mention/source'
import { CaretFloat } from '../ui/CaretFloat'

export interface MentionHooks {
  /** What can be named here, in order. */
  source(): MentionItem[]
  /** A mention's name now, and whether it is in scope (its reference exists and is linked here). */
  resolve(id: string): { name: string; known: boolean } | null
  /** The names in scope, for 'Did you mean'. */
  names(): string[]
  /** A reference was picked: link it to the script when it is not yet. */
  picked?(item: MentionItem): void
}

const MENTION = /(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g
export const refreshMentions = new PluginKey('napkinMentionRefresh')

/** Ask an editor to redraw its mentions (the document's refs or links changed). */
export function redrawMentions(editor: Editor) {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(refreshMentions, true))
}

function hint(name: string, names: string[]): string {
  const near = closestName(name, names)
  return near ? `No reference is called @${name}. Did you mean @${near}?` : `No reference is called @${name} in this script.`
}

function decorations(doc: PMNode, hooks: MentionHooks | undefined): DecorationSet {
  if (!hooks) return DecorationSet.empty
  const out: Decoration[] = []
  const names = hooks.names()
  doc.descendants((node, pos) => {
    if (node.type.name === 'mention') {
      const r = hooks.resolve(String(node.attrs.id ?? ''))
      const label = String(node.attrs.label ?? '')
      out.push(Decoration.node(pos, pos + node.nodeSize, {
        class: r?.known ? 'mention' : 'mention unknown',
        'data-name': r?.name ?? label,
        ...(r?.known ? {} : { title: hint(r?.name ?? label, names) }),
      }))
      return false
    }
    if (node.isText && node.text) {
      for (const m of node.text.matchAll(MENTION)) {
        if (names.includes(m[1])) continue
        out.push(Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, { class: 'mention-typed unknown', title: hint(m[1], names) }))
      }
    }
    return true
  })
  return DecorationSet.create(doc, out)
}

/** The popover's rows, grouped, the active one marked. */
function paint(float: CaretFloat, items: MentionItem[], active: number, pick: (i: number) => void) {
  const el = float.el
  el.replaceChildren()
  if (!items.length) {
    const none = document.createElement('div')
    none.className = 'cf-empty'
    none.textContent = 'No reference by that name. Keep typing, or name a picture on the canvas.'
    el.appendChild(none)
    return
  }
  let group = ''
  items.forEach((it, i) => {
    if (it.group !== group) {
      group = it.group
      const h = document.createElement('div')
      h.className = 'cf-group'
      h.textContent = group
      el.appendChild(h)
    }
    const row = document.createElement('div')
    row.className = `cf-row ${i === active ? 'on' : ''}`
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(i === active))
    row.id = `cf-${i}`
    const img = document.createElement('img')
    img.alt = ''
    img.className = 'cf-thumb'
    if (it.asset) {
      const cached = cachedBlobUrl(it.asset)
      if (cached) img.src = cached
      else void blobUrl(it.asset).then((u) => { if (u) img.src = u })
    }
    const name = document.createElement('span')
    name.className = 'cf-name'
    name.textContent = `@${it.name}`
    row.append(img, name)
    if (it.label) {
      const label = document.createElement('span')
      label.className = 'cf-label'
      label.textContent = it.label
      row.appendChild(label)
    }
    if (!it.linked) {
      const nl = document.createElement('span')
      nl.className = 'cf-note'
      nl.textContent = 'not in this script yet'
      row.appendChild(nl)
    }
    row.addEventListener('click', () => pick(i))
    el.appendChild(row)
  })
  el.setAttribute('aria-activedescendant', `cf-${active}`)
  el.querySelector('.cf-row.on')?.scrollIntoView?.({ block: 'nearest' })
}

/** The mention extensions: the view of clan-store's Mention node, the @ suggestion, and the underline. */
export function mentionExtensions(hooks: () => MentionHooks | undefined): AnyExtension[] {
  const MentionView = Mention.extend({
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span')
        dom.setAttribute('data-type', 'mention')
        dom.contentEditable = 'false'
        const draw = (n: PMNode) => {
          const r = hooks()?.resolve(String(n.attrs.id ?? ''))
          dom.textContent = `@${r?.name ?? n.attrs.label ?? ''}`
        }
        draw(node)
        return {
          dom,
          update: (n) => {
            if (n.type.name !== 'mention') return false
            draw(n)
            return true
          },
        }
      }
    },
  })
  const marksKey = new PluginKey<DecorationSet>('napkinMentionMarks')
  const underline: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key: marksKey,
    state: {
      init: (_, state) => decorations(state.doc, hooks()),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(refreshMentions) ? decorations(state.doc, hooks()) : old),
    },
    props: { decorations: (state): DecorationSet | undefined => marksKey.getState(state) },
  })
  const suggest = Extension.create({
    name: 'napkinMentionSuggest',
    addProseMirrorPlugins() {
      return [Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('napkinMentionSuggest'),
        items: ({ query }) => (hooks() ? matchMentions(hooks()!.source(), query).slice(0, 40) : []),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: MentionItem }) => {
          editor.chain().focus().insertContentAt(range, [{ type: 'mention', attrs: { id: props.id, label: props.name } }, { type: 'text', text: ' ' }]).run()
          hooks()?.picked?.(props)
        },
        render: () => {
          let float: CaretFloat | null = null
          let props: SuggestionProps<MentionItem, MentionItem> | null = null
          let active = 0
          const ordered = (items: MentionItem[]) => [...items].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
          const redraw = () => {
            if (!float || !props) return
            const items = ordered(props.items)
            active = Math.min(active, Math.max(0, items.length - 1))
            paint(float, items, active, (i) => props?.command(items[i]))
          }
          return {
            onStart: (p) => {
              props = p
              active = 0
              float = new CaretFloat({ className: 'mentionfloat', label: 'References', rect: () => p.clientRect?.() ?? null })
              redraw()
            },
            onUpdate: (p) => {
              props = p
              float?.anchor(() => p.clientRect?.() ?? null)
              redraw()
            },
            onKeyDown: ({ event }) => {
              if (!props) return false
              const items = ordered(props.items)
              if (event.key === 'ArrowDown') { active = (active + 1) % Math.max(1, items.length); redraw(); return true }
              if (event.key === 'ArrowUp') { active = (active - 1 + items.length) % Math.max(1, items.length); redraw(); return true }
              if ((event.key === 'Enter' || event.key === 'Tab') && items[active]) { props.command(items[active]); return true }
              // Escape: Suggestion closes it; the editor never sees it.
              return event.key === 'Escape'
            },
            onExit: () => {
              float?.destroy()
              float = null
              props = null
            },
          }
        },
      })]
    },
  })
  return [MentionView, Extension.create({ name: 'napkinMentionMarks', addProseMirrorPlugins: () => [underline] }), suggest]
}
