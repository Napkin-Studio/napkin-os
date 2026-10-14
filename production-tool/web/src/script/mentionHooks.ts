// The mention hooks of an editor in a script (features/script-editor.clan): the popover's
// rows, a mention's name now, whether it is in scope, and the link a pick makes.

import { newUlidId } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import type { ModelStore } from '../model/store'
import { isLinked, linkForMention, mentionSource, type MentionItem } from '../text/mention/source'
import type { MentionHooks } from './mentions'

type Doc = ProductionDocument

/** A mention's name now, and whether it is in scope: linked to the script (`scope`), or simply existing. */
export function resolveMention(d: Doc, id: string, scope?: { kind: 'script'; id: string }): { name: string; known: boolean } | null {
  const r = d.refs[id]
  if (r) return { name: `${r.key}_${r.variant}`, known: scope ? isLinked(d, r.id, scope) : true }
  const k = d.keys[id]
  if (k) {
    const refs = Object.values(d.refs).filter((x) => x.key === k.key)
    return { name: k.key, known: scope ? refs.some((x) => isLinked(d, x.id, scope)) : refs.length > 0 }
  }
  return null
}

/**
 * Hooks for a script's editors. Picking a reference not linked to the script links it (one undo
 * step, a ref→script link with the ref's role) and calls `linked`, which says so with Undo.
 * Without a script (a Storyboard card), every reference that exists is in scope and nothing links.
 */
export function scriptMentionHooks(store: ModelStore, scriptId: string | undefined, linked?: (item: MentionItem) => void): MentionHooks {
  const scope = scriptId ? { kind: 'script' as const, id: scriptId } : undefined
  const node = scope ?? { kind: 'script' as const, id: '' }
  return {
    source: () => mentionSource(store.get(), node).map((i) => (scope ? i : { ...i, linked: true })),
    resolve: (id) => resolveMention(store.get(), id, scope),
    names: () => mentionSource(store.get(), node).filter((i) => !scope || i.linked).map((i) => i.name),
    picked: (item) => {
      if (!scope || item.linked) return
      const d = store.get()
      const link = linkForMention(d, item, scope, () => newUlidId('link'))
      if (!link) return
      void store.change((x) => { x.links[link.id] = link }, { action: `link refs[${link.from.id}] to scripts[${scope.id}]` }).then(() => linked?.(item))
    },
  }
}
