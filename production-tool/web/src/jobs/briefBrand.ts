// A brief is its client's work (UAT round 4 S2-6, UX 4): the Quietboil brief's storyboard cast @ruby and @mia from
// other tests ("no people from other films", the person had answered) and took the Harbour palette and type, because
// the plan was sent every named picture in the project and a brief counted as brand work.
//
// - A brief's storyboard is planned with only the pictures linked into it (or into its script) or named in the
//   brief, the script or the person's words (castFor).
// - A brief with no Brand board linked reads none of the project's brand (jobs/context.ts brandWork); the Storyboard
//   node asks which brand, or none (brandQuestion), and the answer links that board or is kept as "no brand".

import type { Ask, Id, LinkEndpoint, NamedRef, ProductionDocument } from '../contracts/types'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { briefOf } from '../brief/model'
import { scopeOf } from '../model/scope'
import { newId } from '../lib/ulid'
import { brandLinked } from './context'

type Doc = ProductionDocument

/** The words a name can be found in, lower case: the brief's spine, the script, the person's words. */
function wordsOf(d: Doc, storyboardId: Id, words: string): string {
  const b = briefOf(d, storyboardId)
  return `${b ? JSON.stringify(b.brief.spine) : ''}\n${b?.brief.title ?? ''}\n${words}`.toLowerCase()
}

/** Whether `name` (a key, "ruby") is said in the words: @ruby, or the word itself. */
const said = (text: string, name: string) => new RegExp(`(^|[^a-z0-9_])@?${name.replace(/[^a-z0-9_]/g, '')}(?![a-z0-9])`).test(text)

/**
 * Which named pictures a storyboard's plan may cast: every one for a storyboard with no brief (as before), else only
 * those linked into its scope (a link, a board, its script's) or named in the brief, the script or the person's words.
 * Returns undefined when nothing is filtered.
 */
export function castFor(d: Doc, storyboardId: Id, words: string): ((r: NamedRef) => boolean) | undefined {
  if (!briefOf(d, storyboardId)) return undefined
  const linkedRefs = new Set<Id>()
  const linkedKeys = new Set<string>()
  for (const it of scopeOf(d, storyboardId)) {
    if (it.via === 'mention') continue
    if (it.kind === 'ref') linkedRefs.add(it.id)
    if (it.kind === 'key') { const k = d.keys?.[it.id]; if (k) linkedKeys.add(k.key) }
  }
  const text = wordsOf(d, storyboardId, words)
  return (r) => linkedRefs.has(r.id) || (!!r.key && (linkedKeys.has(r.key) || said(text, r.key)))
}

// ── the brand question on a brief's storyboard ──

export const BRAND_ASK = 'ask brand'
export const NO_BRAND = 'no_brand'

/** The Brand boards a brief's storyboard could use, when it should ask: it has a brief, no Brand board linked, and the
 *  question was not answered on it before. Undefined: nothing to ask. */
export function brandQuestion(d: Doc, storyboardId: Id | undefined): { boards: { id: Id; title: string }[] } | undefined {
  if (!storyboardId || !briefOf(d, storyboardId)) return undefined
  const node: LinkEndpoint = { kind: 'storyboard', id: storyboardId }
  if (brandLinked(d, node)) return undefined
  if (Object.values(d.asks ?? {}).some((a) => a.node.kind === 'storyboard' && a.node.id === storyboardId && a.question.id.startsWith('q_') && a.question.text === BRAND_QUESTION && a.state === 'answered')) return undefined
  const boards = Object.values(d.boards ?? {}).filter((b) => b.purpose === 'brand').map((b) => ({ id: b.id, title: b.title?.trim() || 'Brand board' })).slice(0, BRAND_OPTIONS_MAX)
  return boards.length ? { boards } : undefined
}

export const BRAND_QUESTION = 'This brief has no Brand board. Which brand goes on its pictures?'

/** At most this many Brand boards are offered (a question has at most 6 options; No brand is one). */
export const BRAND_OPTIONS_MAX = 5

/** The option id of the n-th Brand board offered (an option id is ^[a-z][a-z0-9_]{0,31}$, so never the board's id;
 *  UAT round 5 S2-B: board_01M… ids were refused by the store and the answer was undone). */
export const brandOption = (n: number) => `brand_${n + 1}`

/** The question as the store keeps it (common.schema.json question): each Brand board an option whose value is the
 *  board's id, and No brand; every option has a value, so no text box. */
export function brandQuestionOf(boards: { id: Id; title: string }[], id: Id): Ask['question'] {
  const options = [
    ...boards.slice(0, BRAND_OPTIONS_MAX).map((b, i) => ({ id: brandOption(i), label: b.title.slice(0, 80) || 'Brand board', value: b.id })),
    { id: NO_BRAND, label: 'No brand', value: 'none' },
  ]
  return { id, kind: 'nudge', text: BRAND_QUESTION, options, allow_text: false }
}

/** The person's answer, as theirs: a board is linked into the storyboard (role brand); "No brand" is kept as the
 *  answered question, so it is not asked again. One undo step. */
export async function answerBrand(store: DocumentStore, storyboardId: Id, boardId: Id | null, by: string, now = new Date().toISOString()): Promise<void> {
  const d = store.get() as Doc
  const q = brandQuestion(d, storyboardId)
  if (!q) return
  const qid = newId('q')
  const question = brandQuestionOf(q.boards, qid)
  const picked = boardId ? question.options.find((o) => o.value === boardId) : undefined
  if (boardId && !picked) throw new Error('That Brand board is not one of the choices.')
  const ask: Ask = {
    id: qid, v: 1, field_v: {},
    question,
    node: { kind: 'storyboard', id: storyboardId },
    crew: 'dex',
    state: 'answered',
    answers: [{ option_id: picked?.id ?? NO_BRAND, by, at: now }],
  }
  await updateDoc(store, (draft) => {
    draft.asks[ask.id] = ask
    if (boardId) {
      const id = newId('link')
      draft.links[id] = { id, v: 1, field_v: {}, from: { kind: 'board', id: boardId }, to: { kind: 'storyboard', id: storyboardId }, role: 'brand' } as Doc['links'][string]
    }
  }, boardId ? 'link board to storyboard' : 'answer', boardId ? `the brief's pictures use ${q.boards.find((b) => b.id === boardId)?.title ?? 'this brand'}` : 'the brief uses no brand')
}
