import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../doc/store'
import { aboutItem, entryKind, historyItems, jobCost, jobOf, kindOf, plainWords, projectEntries, readable, who, type ChainLike } from './historyItems'
import { HistoryList } from './HistoryList'
import { jobRationale, type DirectorCard, type JobEntry } from '../../../clan-store/src/attribution'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const DOC = 'doc1'
const J1 = 'job_01K6XA7Q3M9V2D4R8T0B000001'
const S1 = 'shot_01K6XA7Q3M9V2D4R8T0B000001'
const F1 = 'frame_01K6XA7Q3M9V2D4R8T0B000001'
const F2 = 'frame_01K6XA7Q3M9V2D4R8T0B000002'
const R1 = 'ref_01K6XA7Q3M9V2D4R8T0B000001'
const K1 = 'key_01K6XA7Q3M9V2D4R8T0B000001'
const T = (m: number) => `2026-10-13T10:${String(m).padStart(2, '0')}:00Z`

function doc() {
  const d = emptyDocument({ id: 'p_maya001', handle: 'maya', tenant_id: '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f' })
  const sb = Object.keys(d.storyboards)[0]
  d.keys[K1] = { id: K1, v: 1, field_v: {}, key: 'hero', role: 'character' }
  d.refs[R1] = { id: R1, v: 1, field_v: {}, key: 'hero', variant: 'front', role: 'character', asset: SHA('b') }
  d.shots[S1] = { id: S1, v: 3, field_v: {}, storyboard_id: sb, rank: 'a0', kind: 'shot', duration_s: 3, camera: { size: 'close' }, status: 'planned', pick: { current: F2 } }
  d.frames[F1] = { id: F1, v: 1, field_v: {}, shot_id: S1, version: 1, kind: 'generated', asset: SHA('c'), job_id: J1, crew: 'wren' }
  d.frames[F2] = { id: F2, v: 1, field_v: {}, shot_id: S1, version: 2, parent_id: F1, kind: 'edited', asset: SHA('d'), crew: 'rhea' }
  return d
}

// Newest first, as the chain gives it.
const entries: ChainLike[] = [
  { id: 'd_6', agent: 'human:p_maya001', action: 'restore frames v1 in shot 1', timestamp: T(47), targets: [`${DOC}#shots[${S1}]`, `${DOC}#shots[${S1}].pick.current`], cites: [`${DOC}#frames[${F1}]`] },
  { id: 'd_5', agent: 'jude', action: `check frames[${F2}]: pass`, timestamp: T(46), targets: [`${DOC}#checks[check_01K6XA7Q3M9V2D4R8T0B000001]`], cites: [`${DOC}#frames[${F2}]`] },
  { id: 'd_4', agent: 'rhea', action: 'retouch frames[v2] for shot 1', timestamp: T(45), targets: [`${DOC}#frames[${F2}]`, `${DOC}#shots[${S1}]`], cites: [`${DOC}#jobs[${J1}]`] },
  { id: 'd_3', agent: 'human:p_sai0001', action: 'publish hero to the agency shelf', timestamp: T(44), pinned: true, targets: [`${DOC}#keys[${K1}]`] },
  { id: 'd_2', agent: 'wren', action: 'render frames[v1] for shot 1', rationale: 'cost $0.08 confirmed', timestamp: T(41), targets: [`${DOC}#frames[${F1}]`, `${DOC}#shots[${S1}]`], cites: [`${DOC}#jobs[${J1}]`] },
  { id: 'd_1', agent: 'human:p_maya001', action: 'name @hero_front', timestamp: T(39), targets: [`${DOC}#refs[${R1}]`] },
]

describe('History (contract 3)', () => {
  it('knows people and the crew, and says who in the panel\'s words', () => {
    expect(entries.map((e) => kindOf(e.agent))).toEqual(['person', 'crew', 'crew', 'person', 'crew', 'person'])
    expect(who('human:p_maya001', 'p_maya001')).toEqual({ label: 'You' })
    expect(who('rhea', 'p_maya001')).toEqual({ label: 'Rhea', detail: 'retouches' })
  })

  it('gives each decision its Kind from its verb and targets', () => {
    expect(entries.map(entryKind)).toEqual(['pick', 'check', 'decision', 'decision', 'decision', 'decision'])
  })

  it('narrows to an item by what decisions target and cite, not by words', () => {
    const items = historyItems(doc(), DOC)
    expect(items.map((i) => i.label)).toEqual(['@hero_front', 'Shot 1 frame'])
    const [ref, frame] = items
    expect(entries.filter((e) => aboutItem(e, ref)).map((e) => e.id)).toEqual(['d_3', 'd_1'])
    expect(entries.filter((e) => aboutItem(e, frame)).map((e) => e.id)).toEqual(['d_6', 'd_5', 'd_4', 'd_2'])
  })

  it('renders the list: who, Kind, pinned, the fields it changed, the cards the director saw', () => {
    const cards: DirectorCard[] = [{ tag: 'hero', sha256: SHA('b'), kind: 'character', card: 'A boy, 10.\nYellow raincoat.' }]
    const job = { id: J1, op: 'frame', state: 'completed', crew: 'wren', created_at: T(40), updated_at: T(41), director: { model: 'claude', promptVersion: 'director.v6', rationale: 'Front view leads.', output: {} } } as JobEntry
    const withCards = { ...entries[4], rationale: jobRationale(job, cards) }
    const html = renderToStaticMarkup(createElement(HistoryList, { entries: [entries[0], entries[3], withCards], me: 'p_maya001' }))
    expect(html).toContain('You')
    expect(html).toContain('p_sai0001')
    expect(html).toContain('Fin')
    expect(html).toContain('films')
    expect(html).toContain('pinned')
    expect(html).toContain('pick')
    expect(html).toContain('shots[shot_…000001].pick.current')
    expect(html).toContain('What the director saw')
    expect(html).toContain('@hero')
    const kindOnly = renderToStaticMarkup(createElement(HistoryList, { entries, kind: 'check' }))
    expect(kindOnly.match(/history-entry/g)).toHaveLength(1)
  })

  it('says entities and fields in words, not paths, and hides the template\'s decisions', () => {
    const d = doc()
    expect(plainWords(`write shots[${S1}]`, d)).toBe('wrote shot 1')
    expect(plainWords(`${DOC}#shots[${S1}].pick.current`, d)).toBe('shot 1: the version in use')
    expect(plainWords(`render frames[${F2}]`, d)).toBe('render frame v2 of shot 1')
    expect(plainWords(`write scenes[scene_01K6XA7Q3M9V2D4R8T0B000001]`, d)).toBe('wrote the script')
    const withTemplate: ChainLike[] = [...entries, { agent: 'human:p_maya001', action: 'start the project', timestamp: T(1) }, { agent: 'clan-store', action: 'Production Tool summary view', timestamp: T(0) }]
    expect(projectEntries(withTemplate).map((e) => e.action).at(-1)).toBe('start the project')
    const html = renderToStaticMarkup(createElement(HistoryList, { entries: [entries[0]], doc: d }))
    expect(html).toContain('shot 1: the version in use')
  })

  it('shortens hashes and ids for reading', () => {
    expect(readable(`out ${SHA('a')} for ${J1}`)).toBe('out sha256:aaaaaaaa… for job_…000001')
  })

  it('shows each job cost, the one place the tool shows money (owner, 2026-10-13)', () => {
    expect(jobCost({ confirmed: 0.2, currency: 'USD', unknown: false })).toBe('$0.20')
    expect(jobCost({ confirmed: 0.07, currency: 'USD', unknown: false })).toBe('$0.070')
    expect(jobCost({ estimate: 1.2, reserved: 1.2, currency: 'USD', unknown: false })).toBe('about $1.20')
    expect(jobCost({ confirmed: 0, currency: 'USD', unknown: false })).toBeUndefined()  // the mock: free, says nothing
    expect(jobCost({ estimate: 1, currency: 'USD', unknown: true })).toBeUndefined()   // an unpublished price is no price
    expect(jobOf(entries[2])).toBe(J1)
    expect(jobOf(entries[1])).toBeUndefined()
    const d = doc()
    d.jobs[J1] = { id: J1, v: 1, field_v: {}, op: 'frame', state: 'failed', node: { kind: 'storyboard', id: Object.keys(d.storyboards)[0] },
      started_by: 'p_maya001', tenant_id: '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f', nonce: 'n_000000000001', crew: 'wren',
      parent_ids: [], input_hashes: [], created_at: T(40), cost: { estimate: 0.2, reserved: 0.2, confirmed: 0.2, currency: 'USD', unknown: false } } as never
    // A failed attempt the provider billed shows its cost like any other, with no words about it.
    const html = renderToStaticMarkup(createElement(HistoryList, { entries: [entries[2]], doc: d }))
    expect(html).toContain('history-cost')
    expect(html).toContain('$0.20')
    expect(html).not.toMatch(/charged|refund/i)
  })
})
