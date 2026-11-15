// History shows no cost (the owner's rule; security review of production-platform-rules, finding 3): a crew landing's
// rationale is clan-store jobRationale, and History prints it. The cost stays recorded on the job (jobs[].cost).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HistoryList } from './HistoryList'
import { jobRationale, type JobEntry } from '../../../clan-store/src/attribution'

const MONEY = /\$|€|\b\d+\.\d\d\b|\bcost\b|\bprice\b|\bcredits?\b|\busd\b|\beuro?s?\b|\bdollars?\b|\bcharged?\b|\bfree\b/i

const job = {
  id: 'job_01K6XA7Q3M9V2D4R8T0B000001', op: 'frame', state: 'completed', crew: 'wren', provider: 'runway', model: 'gemini_image3_pro',
  created_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:41Z',
  cost: { estimate: 0.25, reserved: 0.25, confirmed: 0.25, currency: 'USD', unknown: false },
} as JobEntry

const render = (rationale: string) => renderToStaticMarkup(createElement(HistoryList, { entries: [
  { id: 'd_2', agent: 'wren', action: 'render frames[v1] for shot 1', rationale, timestamp: '2026-11-15T10:00:41Z' },
] }))

describe('History shows no cost', () => {
  it('a crew landing, whose rationale is clan-store jobRationale, shows no figure and no money word', () => {
    expect(render(jobRationale(job))).not.toMatch(MONEY)
  })
  it('an estimate that was never confirmed shows none either', () => {
    const { confirmed: _, ...cost } = job.cost!
    expect(render(jobRationale({ ...job, cost } as JobEntry))).not.toMatch(MONEY)
  })
  it('a landing written before this rule, with the cost in its words, is shown without it', () => {
    const old = 'Wren drew it. · gemini_image3_pro on runway · cost $0.25 confirmed · 41.0 s'
    const html = render(old)
    expect(html).not.toMatch(MONEY)
    expect(html).toContain('gemini_image3_pro on runway')
    expect(render('Dex planned it. · cost about $1.20 estimated, not confirmed · 2.0 s')).not.toMatch(MONEY)
  })
})
