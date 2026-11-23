// What an action's node leaves out (owner 2026-11-23, features/uat-flow-fixes.clan): the named pictures and the Brief
// the project has that no link, board or upstream node brings into the node's scope. Nothing here links anything.
import type { Id, NamedRef, ProductionDocument } from '../contracts/types'
import { briefsList, briefOf } from '../brief/model'
import { scopeOf } from './scope'
import { refsList } from './selectors'

export interface Unlinked {
  /** One picture per @key, the first of its views: what "Link it" links. A key with any view in scope is not listed. */
  refs: NamedRef[]
  /** The project's Brief (the oldest) when none reaches the node, link or upstream. */
  brief?: { id: Id }
}

/**
 * The rule: a named picture counts when the project has it (a reference with an @key) and the node's scope holds neither
 * it, nor another view of its key, nor the key, through a link, a board or an upstream node (a bare mention in the
 * text brings nothing to a job, so it does not count as linked). The Brief counts when the project has one and
 * none is in the node's scope.
 */
export function unlinkedFor(d: ProductionDocument, nodeId: Id): Unlinked {
  const scope = scopeOf(d, nodeId).filter((i) => i.via !== 'mention')
  const linked = new Set<string>()
  for (const i of scope) {
    if (i.kind === 'key' && i.name) linked.add(i.name)
    if (i.kind === 'ref' && d.refs[i.id]) linked.add(d.refs[i.id].key)
  }
  const seen = new Set<string>()
  const refs: NamedRef[] = []
  for (const r of refsList(d)) {
    if (linked.has(r.key) || seen.has(r.key)) continue
    seen.add(r.key)
    refs.push(r)
  }
  const first = briefsList(d)[0]
  return { refs, ...(first && !briefOf(d, nodeId) ? { brief: { id: first.id } } : {}) }
}

/** "Run without it": the nodes (and what they lacked) whose notice the person hid, until the page is reloaded. */
export const dismissed = new Set<string>()
export const resetLinkNotices = () => dismissed.clear()
const NODE: Record<string, string> = { script: 'Script', storyboard: 'Storyboard', video: 'Film' }
const ACTION: Record<string, string> = { script: 'Plan shots', storyboard: 'Drawing', video: 'Making the film' }

/** "@a is not linked to the Script. Plan shots won’t use it." */
export function noticeWords(kind: 'script' | 'storyboard' | 'video', names: string[]): string {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${list} ${names.length === 1 ? 'is' : 'are'} not linked to the ${NODE[kind]}. ${ACTION[kind]} won’t use ${names.length === 1 ? 'it' : 'them'}.`
}
