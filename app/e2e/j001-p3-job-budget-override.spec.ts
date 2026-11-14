// Phase 3 acceptance, record `job-budget-override` (features/j001-phase3-suite.clan): test 78 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `job-budget-override` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(job-budget-override) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, chainOf, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(78), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.accountService)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    // The job's money budget is set by a person who may (account service), small enough that two mock runs pass 80 percent.
    expect((await page.request.patch(`${job.api}/jobs/${job.job}`, { data: { budget_eur: 10 } })).status()).toBe(200) // ADJUST(job-budget-override)
    await signIn(page, PEOPLE.producer)
    const first = await runOp(page, doc, { op: 'generate', tier: 'standard', inputs: [photo.id] })
    expect(first.status).toBe(200)
    // 80 percent: one need for the Money group, with no figure after the job number.
    const need = (await (await page.request.get('/api/needs')).json() as { items: { kind: string; text: string }[] }).items.find(n => n.kind === 'budget') // ADJUST(job-budget-override)
    expect(need?.text).toBe('J001 has used most of its budget')
    expect(need?.text.replace(job.job, '')).not.toMatch(/\d/)
    // A run past the budget is refused.
    const over = await runOp(page, doc, { op: 'generate', tier: 'hero', inputs: [photo.id] })
    expect(over.job.reason).toBe('over_budget')
    expect(over.job.message).toBe('This job has reached its budget. Nothing was sent.')
    // A named person (account service) lets that one run through, with a reason, and the chain shows it.
    await signIn(page, PEOPLE.accountService)
    const decided = await page.request.post(`/s/${doc.token}/decision`, { data: { kind: 'spend_override', run: over.job.id, reason: 'The client asked for one more.' } }) // ADJUST(job-budget-override)
    expect(decided.status()).toBe(200)
    await signIn(page, PEOPLE.producer)
    expect((await runOp(page, doc, { op: 'generate', tier: 'hero', inputs: [photo.id] })).status).toBe(200)
    expect((await runOp(page, doc, { op: 'generate', tier: 'hero', inputs: [photo.id] })).job.reason).toBe('over_budget') // the next run is refused again
    expect((await chainOf(page, doc.token)).some(d => d.kind === 'spend_override' && d.actor?.includes(PEOPLE.accountService.username))).toBe(true)
    await ctx.close()
  })
}
