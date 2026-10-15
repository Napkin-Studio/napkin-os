// What the schema cannot say, checked on every write after ajv (contracts/collab.md §7):
// links against common linkRule (with their limits and loops), ref names and
// payloads, beats inside their shots, note windows, sizes in a set, asks with
// their jobs, one owner per span of text, ranks, and that every key is its
// entity's id. contracts/check.py checks the same subset of the examples.
import common from '../../contracts/common.schema.json'
import { isValidRank } from './rank'
import { windowProblem } from './time'
import { MAP_NAMES, type Doc, type Entity } from './types'

interface Endpoint { kind: string; id: string }
interface Rule {
  from: string[]
  to: string[]
  roles: string[]
  per_target: 'one' | 'many'
  per_source?: 'one'
  system?: boolean
  board_purpose?: string
}
export const LINK_RULE = common.$defs.linkRule.const as { generating: string[]; rules: Rule[] }
type RoleLine = { payload: 'image' | 'swatches' | 'font' | 'rule' | 'document' }
const ROLE_TABLE = common.$defs.refRoleTable.const as Record<string, RoleLine>

/** The largest a fragment's prose may be, serialised (collab.md §4). */
export const MAX_PROSE_BYTES = 64 * 1024

/** The map each document-entity endpoint kind lives in. group, note and ink are canvas things. */
export const ENDPOINT_MAP: Record<string, string | null> = {
  board: 'boards', script: 'scripts', storyboard: 'storyboards', video: 'videos', ref: 'refs', key: 'keys', frame: 'frames', render: 'renders',
  sketch: 'sketches', document: 'documents', format_set: 'format_sets', shot: 'shots', group: null, note: null, ink: null,
}

/** The first rule that allows a link from `from` to `to` as `role`, or why none does (in the canvas's words). */
export function linkRuleFor(from: string, to: string, role: string, boardPurpose?: string): { rule: Rule } | { refused: string } {
  for (const rule of LINK_RULE.rules) {
    if (!rule.from.includes(from) || !rule.to.includes(to) || !rule.roles.includes(role)) continue
    if (rule.board_purpose && boardPurpose !== rule.board_purpose) continue
    return { rule }
  }
  if (from === 'video' && to !== 'format_set') return { refused: 'A video is an output; it can only be the master of a cut-down set.' }
  if (['ref', 'document'].includes(to)) return { refused: `Nothing feeds a ${to}: it is an input only.` }
  if (!LINK_RULE.rules.some((r) => r.from.includes(from) && r.to.includes(to))) return { refused: `A ${from} cannot feed a ${to}.` }
  return { refused: `A ${from} does not feed a ${to} as ${role}.` }
}

/** canLink(): whether a link may be made (examples/links.json). */
export function canLink(from: string, to: string, role: string, boardPurpose?: string): boolean {
  return 'rule' in linkRuleFor(from, to, role, boardPurpose)
}

const key = (e: Endpoint) => `${e.kind}:${e.id}`

/** Whether adding from→to would close a loop among the links (ui-behaviour 3.4: "That would make a loop."). */
export function makesLoop(links: Iterable<{ from: Endpoint; to: Endpoint }>, from: Endpoint, to: Endpoint): boolean {
  const out = new Map<string, string[]>()
  for (const l of links) out.set(key(l.from), [...(out.get(key(l.from)) ?? []), key(l.to)])
  const seen = new Set<string>()
  const stack = [key(to)]
  while (stack.length) {
    const n = stack.pop()!
    if (n === key(from)) return true
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(out.get(n) ?? []))
  }
  return false
}

const entities = (doc: Doc, map: string): [string, Entity][] => Object.entries((doc as unknown as Record<string, Record<string, Entity>>)[map] ?? {})
const get = (doc: Doc, map: string, id: unknown): Entity | undefined =>
  typeof id === 'string' ? (doc as unknown as Record<string, Record<string, Entity>>)[map]?.[id] : undefined

/** Every problem in the document the schema cannot see, one line each; empty when there are none. */
export function integrity(doc: Doc): string[] {
  const p: string[] = []
  const say = (s: string) => p.push(s)

  // Keys are ids; no key holds '.', '[', ']' or '#'; ranks are valid; prose fits.
  for (const map of MAP_NAMES) {
    for (const [k, e] of entities(doc, map)) {
      if (/[.[\]#]/.test(k)) say(`${map}: the key ${JSON.stringify(k)} holds '.', '[', ']' or '#'`)
      if (e.id !== k) say(`${map}[${k}]: its id is ${JSON.stringify(e.id)}, not its key`)
      if (typeof e.rank === 'string' && !isValidRank(e.rank)) say(`${map}[${k}].rank ${JSON.stringify(e.rank)} is not an order key`)
      if (e.prose && JSON.stringify(e.prose).length > MAX_PROSE_BYTES) say(`${map}[${k}].prose is over 64 KB`)
    }
  }
  for (const [k, a] of Object.entries(doc.assets ?? {})) if (a.sha256 !== k) say(`assets[${k}]: its sha256 is not its key`)
  for (const [, v] of entities(doc, 'videos')) {
    for (const [ik, item] of Object.entries((v.edl ?? {}) as Record<string, { rank: string }>)) {
      if (!isValidRank(item.rank)) say(`videos[${v.id}].edl[${ik}].rank ${JSON.stringify(item.rank)} is not an order key`)
    }
  }

  // Links: allowed, endpoints present, within their limits, no loops.
  const boards = Object.fromEntries(entities(doc, 'boards').map(([id, b]) => [id, b.purpose as string]))
  const links = entities(doc, 'links').map(([, l]) => l as unknown as Entity & { from: Endpoint; to: Endpoint; role: string })
  const perTarget = new Map<string, number>()
  const perPair = new Map<string, number>()
  for (const l of links) {
    const found = linkRuleFor(l.from.kind, l.to.kind, l.role, boards[l.from.id])
    if ('refused' in found) {
      say(`links[${l.id}]: ${found.refused}`)
      continue
    }
    for (const end of [l.from, l.to]) {
      const map = ENDPOINT_MAP[end.kind]
      if (map && !get(doc, map, end.id)) say(`links[${l.id}]: its ${end.kind} ${end.id} is not in the document`)
    }
    const pair = `${key(l.from)}>${key(l.to)}>${l.role}`
    perPair.set(pair, (perPair.get(pair) ?? 0) + 1)
    if (found.rule.per_target === 'one') {
      const t = `${key(l.to)}>${l.role}`
      perTarget.set(t, (perTarget.get(t) ?? 0) + 1)
    }
  }
  for (const [t, n] of perTarget) if (n > 1) say(`${n} ${t.split('>')[1]} links into ${t.split('>')[0]}; it takes one`)
  for (const [pair, n] of perPair) if (n > 1) say(`${n} links of one role on one port: ${pair}`)
  const graph: { from: Endpoint; to: Endpoint }[] = []
  for (const l of links) {
    if (makesLoop(graph, l.from, l.to)) say(`links[${l.id}] makes a loop`)
    graph.push(l)
  }

  // Refs: names unique; what each role holds.
  const names = new Map<string, string>()
  for (const [id, r] of entities(doc, 'refs')) {
    const name = `${r.key}_${r.variant}`
    if (names.has(name)) say(`refs[${id}]: the name @${name} is also refs[${names.get(name)}]`)
    names.set(name, id)
    const payload = ROLE_TABLE[r.role as string]?.payload
    const needs: Record<string, string> = { image: 'asset', swatches: 'swatches', font: 'font', rule: 'rule', document: 'document_id' }
    if (payload && r[needs[payload]] === undefined) say(`refs[${id}]: a ${r.role} ref holds ${needs[payload]}`)
    if (r.document_id !== undefined && !get(doc, 'documents', r.document_id)) say(`refs[${id}]: its document is not in the document`)
  }

  // Beats inside their shots; a tied line's moment is a moment in the same shot.
  for (const [id, b] of entities(doc, 'beats')) {
    const shot = get(doc, 'shots', b.shot_id)
    if (!shot) {
      say(`beats[${id}]: its shot ${String(b.shot_id)} is not in the document`)
      continue
    }
    if ((b.at_s as number) > (shot.duration_s as number)) say(`beats[${id}] at ${b.at_s} s is past the end of its ${shot.duration_s} s shot`)
    if (b.moment_id !== undefined) {
      const m = get(doc, 'beats', b.moment_id)
      if (!m || m.kind !== 'moment' || m.shot_id !== b.shot_id) say(`beats[${id}]: moment_id is not a moment in the same shot`)
    }
  }

  // Shots in their storyboards; frames, takes and picks that exist.
  for (const [id, s] of entities(doc, 'shots')) {
    if (!get(doc, 'storyboards', s.storyboard_id)) say(`shots[${id}]: its storyboard is not in the document`)
    if (s.scene_id !== undefined && !get(doc, 'scenes', s.scene_id)) say(`shots[${id}]: its scene is not in the document`)
    const pick = s.pick as { current: string; alternates?: string[] } | undefined
    if (pick) for (const f of [pick.current, ...(pick.alternates ?? [])]) if (!get(doc, 'frames', f)) say(`shots[${id}].pick names frame ${f}, which is not in the document`)
  }

  // Note windows: 2 s or more, inside the shot.
  for (const [id, r] of entities(doc, 'reviews')) {
    if (!r.window) continue
    const shot = get(doc, 'shots', r.shot_id)
    const why = windowProblem(r.window as { from_s: number; to_s: number }, shot ? (shot.duration_s as number) : Infinity)
    if (why) say(`reviews[${id}]: ${why}`)
  }

  // Sizes belong to a set.
  for (const [id, s] of entities(doc, 'sizes')) if (!get(doc, 'format_sets', s.set_id)) say(`sizes[${id}]: its format set ${String(s.set_id)} is not in the document (an orphan size)`)

  // Asks: keyed by their question, with their job.
  for (const [id, a] of entities(doc, 'asks')) {
    const q = a.question as { id?: string } | undefined
    if (q?.id !== id) say(`asks[${id}]: its question's id is not its key`)
    if (a.job_id !== undefined && !get(doc, 'jobs', a.job_id)) say(`asks[${id}]: its job ${String(a.job_id)} is not in the document`)
  }

  // One owner per span of text: a planned shot's action is no longer in its scene.
  for (const [id, s] of entities(doc, 'shots')) {
    const action = typeof s.action === 'string' ? s.action.trim() : ''
    const scene = get(doc, 'scenes', s.scene_id)
    if (action.length >= 12 && typeof scene?.text === 'string' && scene.text.includes(action)) {
      say(`shots[${id}]: its action is still in scenes[${scene.id}]: text has one owner`)
    }
  }
  return p
}
