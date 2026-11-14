// Unknown @names become Skye's asks, not chat (ui-behaviour 3.10, 3.17; open question 12): the
// editor's own rule raises them, with no model call, signed 'Skye · scripts'.
//
// - A shot's unknown name (one no reference or character has) is asked about once the caret has
//   left the shot, or after 3 s idle: "Who is the jogger?", quoting the line, with A character,
//   An extra, Cut them. At most one open ask per name per script; it closes quietly when the name
//   resolves or leaves the script.
// - Until live-sync, an ask no job raised is seen only in this browser (it is still a document
//   entity, so live-sync only carries it).
// - Answering is local (answerLocalAsk): the answer, its state and its effect in ONE undoable
//   batch. A character makes the name a character key; An extra lets it be; Cut them starts a
//   `write` job (cut_name) on the shot.

import { flatText, newUlidId, unknownNames, type Prose } from '../../../clan-store/src'
import type { Ask, Id, ProductionDocument, Question } from '../contracts/types'
import type { ModelStore } from '../model/store'
import { composeScript } from './compose'
import { refNames } from './extensions'

type Doc = ProductionDocument

const TYPED = /(?<![\w@])@([a-z][a-z0-9]{1,23}(?:_[a-z0-9][a-z0-9-]{0,31})?)/g
export const NAME_ROUTES = { character: 'name_character', extra: 'name_extra', cut: 'cut_name' } as const

/** The names in the document: every ref (key_variant) and every key. */
function known(d: Doc): Set<string> {
  return new Set([...Object.values(d.refs).map((r) => `${r.key}_${r.variant}`), ...Object.values(d.keys).map((k) => k.key)])
}

/** The names a shot's words use that nothing in the document has, with the line each is on. */
export function unknownInShot(d: Doc, prose: Prose | undefined): { name: string; line: string }[] {
  if (!prose) return []
  const names = known(d)
  const refs = refNames(d)
  const out: { name: string; line: string }[] = []
  const add = (name: string, line: string) => {
    if (!names.has(name) && !out.some((x) => x.name === name)) out.push({ name, line })
  }
  for (const b of prose.content ?? []) {
    const line = flatText(b.content, refs)
    for (const n of unknownNames({ type: 'doc', content: [b] }, refs)) add(n, line)
    for (const m of line.matchAll(TYPED)) add(m[1], line)
  }
  return out
}

/** The name an ask of this kind is about. */
export function askedName(a: Pick<Ask, 'question'>): string | null {
  return /There's no ref called @([a-z0-9_-]+),/.exec(a.question.text)?.[1] ?? null
}

/** Name asks on a script: by name, the open one and whether one was answered. */
export function nameAsks(d: Doc, scriptId: Id): Ask[] {
  return Object.values(d.asks).filter((a) => a.node.kind === 'script' && a.node.id === scriptId && !a.job_id && askedName(a))
}

/** Skye's question about an unknown name in a shot. */
export function nameAsk(d: Doc, scriptId: Id, shotId: Id, name: string, line: string, docId?: string): Ask {
  const id = newUlidId('q')
  const n = composeScript(d, scriptId)?.shots.findIndex((s) => s.id === shotId) ?? -1
  const quote = line.length > 80 ? `${line.slice(0, 79)}…` : line
  const shot = { kind: 'shot' as const, id: shotId }
  const question: Question = {
    id, kind: 'block',
    text: `Who is the ${name.replace(/_/g, ' ')}? There's no ref called @${name}, so I can't tell Dex how to show them.`.slice(0, 200),
    why: `${n >= 0 ? `Shot ${n + 1}` : 'A shot'} · '${quote}'`.slice(0, 300),
    options: [
      { id: 'character', label: 'A character', value: { route: NAME_ROUTES.character, node: shot } },
      { id: 'extra', label: 'An extra', value: { route: NAME_ROUTES.extra, node: shot } },
      { id: 'cut', label: 'Cut them', value: { route: NAME_ROUTES.cut, node: shot } },
    ],
    allow_text: false,
    ...(docId ? { address: `${docId}#shots[${shotId}].action` } : {}),
  }
  return { id, v: 1, field_v: {}, question, node: { kind: 'script', id: scriptId }, crew: 'skye', state: 'open', answers: [] }
}

/**
 * The asks a shot's words call for now, and the open ones to close: one per unknown name not
 * already asked about in this script (open or answered), and the open ones whose name resolved
 * or left every shot of the script.
 */
export function askPlan(d: Doc, scriptId: Id, shotId: Id, docId?: string): { raise: Ask[]; close: Id[] } {
  const asks = nameAsks(d, scriptId)
  const asked = new Set(asks.map((a) => askedName(a)))
  const shot = d.shots[shotId]
  const raise = unknownInShot(d, shot?.prose as Prose | undefined).filter((u) => !asked.has(u.name)).map((u) => nameAsk(d, scriptId, shotId, u.name, u.line, docId))
  const names = known(d)
  const inScript = new Set((composeScript(d, scriptId)?.shots ?? []).flatMap((s) => unknownInShot(d, s.prose as Prose | undefined).map((u) => u.name)))
  const close = asks.filter((a) => a.state === 'open' && (names.has(askedName(a)!) || !inScript.has(askedName(a)!))).map((a) => a.id)
  return { raise, close }
}

/** Raise and close name asks for a shot the caret left: asks are never undo steps. */
export async function settleNameAsks(store: ModelStore, scriptId: Id, shotId: Id) {
  const d = store.get()
  const { raise, close } = askPlan(d, scriptId, shotId, store.documentId())
  if (!raise.length && !close.length) return
  if (raise.length) {
    await store.change((x) => { for (const a of raise) x.asks[a.id] = a }, { action: `ask about ${raise.map((a) => `@${askedName(a)}`).join(', ')}`, agent: 'skye', undo: false })
  }
  if (close.length) {
    await store.change((x) => { for (const id of close) if (x.asks[id]) x.asks[id].state = 'withdrawn' }, { action: 'set asks withdrawn', quiet: true, undo: false })
  }
}

/**
 * A person's answer to a name ask, here (no job): the answer, the ask's state and the effect, in ONE
 * undoable step. Cut them also starts Skye's cut_name job on the shot (`cut`), which is the job's own.
 */
export async function answerLocalAsk(store: ModelStore, askId: Id, optionId: 'character' | 'extra' | 'cut', by: string, cut?: (shotId: Id, name: string) => Promise<unknown>) {
  const d = store.get()
  const a = d.asks[askId]
  if (!a || a.state !== 'open') return
  const name = askedName(a)
  const shotId = (a.question.options.find((o) => o.id === optionId)?.value as { node?: { id: string } } | undefined)?.node?.id
  await store.change((x) => {
    const ask = x.asks[askId]
    ask.answers = [...ask.answers, { option_id: optionId, by, at: new Date().toISOString() }].slice(-16)
    ask.state = 'answered'
    if (optionId === 'character' && name && !Object.values(x.keys).some((k) => k.key === name.split('_')[0])) {
      const key = newUlidId('key')
      x.keys[key] = { id: key, v: 1, field_v: {}, key: name.split('_')[0].replace(/[^a-z0-9]/g, '').slice(0, 24), role: 'character' }
    }
  }, { action: `answer ${a.question.text}`.slice(0, 300) })
  await store.flush()
  if (optionId === 'cut' && name && shotId && cut) await cut(shotId, name)
}
