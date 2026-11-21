// Every ask the web builds is one the store keeps (UAT round 5, S2-B, features/pt-canvas-r5.clan): the brief
// storyboard's "Use a brand?" used board ids as option ids (^[a-z][a-z0-9_]{0,31}$ refused them) and options with no
// value beside allow_text false, so the store refused the answer and undid it. Each builder's ask, as it is written
// to the document, is checked against document.schema.json's ask here. The prompt starts' videoBlock and
// storyboardNudge (ui/prompt/promptFlow.ts) and the Character stage's "which drives it" are shown, never stored.
import { describe, expect, it } from 'vitest'
import type { Ask, ProductionDocument, Question, Shot } from '../contracts/types'
import { newId } from '../lib/ulid'
import { makeAjv, SCHEMA } from '../test/schemas'
import { answerBrand, BRAND_OPTIONS_MAX, brandQuestionOf } from '../jobs/briefBrand'
import { mockFrameEdit, recastQuestion } from '../jobs/frameWords'
import { leftOutAsk } from '../jobs/plan'
import { scriptVideoQuestion } from '../jobs/scriptVideo'
import { nameAsk } from '../script/nameAsks'
import { sketchAsk } from './asks'

const valid = makeAjv().compile({ $ref: SCHEMA('document') + '#/$defs/ask' })
const check = (ask: Ask) => {
  const ok = valid(ask)
  expect(ok, JSON.stringify(valid.errors?.slice(0, 3))).toBe(true)
}
/** A relay question (Job.question) as the runner copies it onto an ask. */
const asAsk = (q: Omit<Question, 'id'>, node: Ask['node'], crew: Ask['crew'] = 'dex'): Ask => {
  const id = newId('q')
  return { id, v: 1, field_v: {}, question: { ...q, id } as Question, node, job_id: newId('job'), crew, state: 'open', answers: [] }
}

const SB = newId('storyboard')
const BOARD = 'board_01M7Y31MKPCGH8MWGG2JKTRRA1'
const BRIEF = newId('brief')

describe('every ask the web writes validates against the contract', () => {
  it('the brand ask on a brief storyboard, answered with a board and with No brand (S2-B, the live repro)', async () => {
    for (const pick of [BOARD, null]) {
      let cur = {
        storyboards: { [SB]: { id: SB, v: 1, field_v: {}, target_s: 15 } },
        briefs: { [BRIEF]: { id: BRIEF, v: 1, field_v: {}, title: 'Let Them Sleep', source: { how: 'link', document_id: 'doc-quietboil', taken: 1, data_sha256: 'sha256:' + 'b'.repeat(64) }, spine: { proposition: 'The kettle that lets the house sleep.' } } },
        boards: { [BOARD]: { id: BOARD, v: 1, field_v: {}, title: 'Harbour', purpose: 'brand', rank: 'a' } },
        links: { link_1: { id: 'link_1', v: 1, field_v: {}, from: { kind: 'brief', id: BRIEF }, to: { kind: 'storyboard', id: SB }, role: 'brief' } },
        asks: {}, refs: {}, keys: {}, shots: {}, scripts: {}, videos: {}, texts: {}, jobs: {},
      } as unknown as ProductionDocument
      const store = { get: () => cur, change: async (fn: (x: ProductionDocument) => void) => { const n = structuredClone(cur); fn(n); cur = n; return cur } }
      await answerBrand(store as never, SB, pick, 'human:p_cc1e06c939')
      const asks = Object.values(cur.asks)
      expect(asks).toHaveLength(1)
      check(asks[0])
      // The answer names the option, and the option carries the board.
      const chosen = asks[0].question.options.find((o) => o.id === asks[0].answers[0].option_id)
      expect(chosen?.value).toBe(pick ?? 'none')
    }
  })

  it('the brand ask with the most boards it offers stays within 6 options', () => {
    const boards = Array.from({ length: 9 }, (_, i) => ({ id: `board_01M7Y31MKPCGH8MWGG2JKTRR${String(i).padStart(2, '0')}`, title: `Brand ${i}` }))
    const q = brandQuestionOf(boards, newId('q'))
    expect(q.options).toHaveLength(BRAND_OPTIONS_MAX + 1)
    check({ id: q.id, v: 1, field_v: {}, question: q, node: { kind: 'storyboard', id: SB }, crew: 'dex', state: 'open', answers: [] })
  })

  it("Fin's sketch ask, Skye's name ask, Dex's left-out shot and the video's plan-first nudge", () => {
    check(sketchAsk(newId('sketch')))
    const scriptId = newId('script')
    const shotId = newId('shot')
    const d = { scripts: { [scriptId]: { id: scriptId, v: 1, field_v: {}, title: 'Script' } }, scenes: {}, shots: {}, storyboards: {}, links: {}, refs: {}, keys: {}, asks: {} } as unknown as ProductionDocument
    check(nameAsk(d, scriptId, shotId, 'baker', 'The baker hands Leo a loaf.', 'doc-1'))
    const shot = { id: shotId, v: 1, field_v: {}, storyboard_id: SB, kind: 'shot', duration_s: 4, camera: { size: 'wide' }, rank: 'a' } as unknown as Shot
    check(leftOutAsk({ ...d, shots: { [shotId]: shot }, storyboards: { [SB]: { id: SB } } } as unknown as ProductionDocument, SB, shot))
    const q = scriptVideoQuestion({ n: 6, exact: false })
    check({ id: q.id, v: 1, field_v: {}, question: q, node: { kind: 'video', id: newId('video') }, crew: 'dex', state: 'answered', answers: [{ option_id: q.options[0].id, by: 'human:p1', at: '2026-11-21T05:00:00.000Z' }] })
  })

  it("the mock relay's frame-edit asks (recast, ambiguity) as the runner keeps them", () => {
    const node = { kind: 'shot' as const, id: newId('shot') }
    check(asAsk(recastQuestion('Edit anyway'), node))
    const amb = mockFrameEdit({ text: 'make it bigger', shot: { id: node.id, kind: 'shot', duration_s: 3, camera: { size: 'medium' } } } as never).question
    expect(amb).toBeTruthy()
    check(asAsk(amb!, node))
  })
})
