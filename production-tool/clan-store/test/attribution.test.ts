import { describe, expect, it } from 'vitest'
import { agentKind, cardsFromRationale, crewFor, jobRationale, landingWhy, opVerb, recordJobOutcome, sawPart, type JobEntry } from '../src/index'
import { MAYA, id, jobValue, sha, store } from './fixtures'

function realJob(): JobEntry {
  const j = { id: id('job', 0), ...jobValue(0) } as unknown as JobEntry
  j.op = 'generate'
  j.provider = 'runway'
  j.model = 'gen4_image'
  j.updated_at = '2026-10-13T10:40:41Z'
  j.created_at = '2026-10-13T10:40:00Z'
  j.director = {
    model: 'claude-sonnet-5-5',
    promptVersion: 'director.v6',
    rationale: 'The sketch sets the pose; the photo gives the coat.',
    latencyMs: 2300,
    output: {
      op: 'generate',
      providerJob: { provider: 'runway', model: 'gen4_image', prompt: '@hero in a yellow raincoat, front view', refs: [{ sha256: sha(7), name: 'hero', role: 'character' }, { sha256: sha(8), name: 'coat', role: 'object' }] },
      question: null,
    },
  }
  j.cost = { estimate: 0.08, confirmed: 0.07, currency: 'USD', unknown: false }
  return j
}

describe('attribution: people and the crew', () => {
  it('names people and crew', () => {
    expect(agentKind('human:p_maya001')).toBe('person')
    expect(agentKind('dex')).toBe('crew')
    expect(agentKind('maya')).toBe('other')
  })

  it('gives each op its verb and its crew member', () => {
    expect([opVerb('shot_list'), crewFor('shot_list')]).toEqual(['plan', 'dex'])
    expect([opVerb('clip'), crewFor('clip')]).toEqual(['render', 'wren'])
    expect([opVerb('clip_patch'), crewFor('clip_patch')]).toEqual(['edit', 'edie'])
    expect([opVerb('cutout'), crewFor('cutout')]).toEqual(['retouch', 'rhea'])
    expect([opVerb('check'), crewFor('check')]).toEqual(['check', 'jude'])
    expect([opVerb('read'), crewFor('read')]).toEqual(['read', 'ellis'])
    expect([opVerb('write'), crewFor('write')]).toEqual(['write', 'skye'])
  })

  it('says what the director decided and what the provider made, in one line', () => {
    const r = jobRationale(realJob())
    expect(r).toContain('The sketch sets the pose')
    expect(r).toContain('hero as character')
    expect(r).toContain('prompt: "@hero in a yellow raincoat')
    expect(r).toContain('director claude-sonnet-5-5 · director.v6 · 2.3 s')
    expect(r).toContain('gen4_image on runway')
    expect(r).toContain('cost $0.07 confirmed')
    expect(r).toContain('41 s')
  })

  it('a landing is the crew member\'s, citing the job', () => {
    const w = landingWhy('doc1', realJob(), `frames[${id('frame', 1)}]`)
    expect(w.agent).toBe('wren')
    expect(w.action).toBe(`render frames[${id('frame', 1)}]`)
    expect(w.cites).toEqual([`doc1#jobs[${id('job', 0)}]`])
  })

  it('cards ride at the end of a rationale and read back', () => {
    const cards = [{ tag: 'hero', sha256: sha(7), kind: 'character' as const, card: 'A woman, 30s.\nYellow coat / hood up.' }]
    const r = jobRationale(realJob(), cards)
    expect(r.endsWith(sawPart(cards))).toBe(true)
    const back = cardsFromRationale(r)
    expect(back.cards).toEqual([{ tag: 'hero', kind: 'character', lines: ['A woman, 30s.', 'Yellow coat, hood up.'] }])
  })

  it('a failed job is recorded once, as its crew member, with the job as its target', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const failed = { ...realJob(), state: 'failed', error: { code: 'provider_failed', message: 'Runway is busy.', retryable: true } }
    expect(await recordJobOutcome(s, failed)).toBe(true)
    expect(await recordJobOutcome(s, failed)).toBe(false)
    expect(await recordJobOutcome(s, { ...realJob(), state: 'completed' })).toBe(false)
    const [e] = await s.chain()
    expect(e.agent).toBe('wren')
    expect(e.action).toBe(`render failed generate ${id('job', 0)}`)
    expect(e.rationale).toContain('provider_failed: Runway is busy.')
    expect(e.targets).toEqual([`${s.documentId()}#jobs[${id('job', 0)}]`])
  })
})
