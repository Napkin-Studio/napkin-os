// Phase 3 acceptance, record `spend-ledger` (features/j001-phase3-suite.clan): test 77 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `spend-ledger` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(spend-ledger) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, chainOf } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, bodyText, ledgerOf, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(77), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    const run = await runOp(page, doc, { op: 'generate', tier: 'standard', inputs: [photo.id] })
    expect(run.status).toBe(200)
    const lines = (await ledgerOf(page, job)).filter(l => l.run === run.job.id)
    expect(lines).toHaveLength(1)
    expect(lines[0].tier).toBe('standard') // the mock sheet's tier, with made-up prices
    expect(lines[0].provider).toBe('mock')
    expect(lines[0].state).toBe('settled')
    // One run_cost decision when the run closes, on the document, with the line's id and no content.
    const chain = await chainOf(page, doc.token)
    const cost = chain.filter(d => d.kind === 'run_cost')
    expect(cost).toHaveLength(1)
    expect(JSON.stringify(cost[0])).toContain(lines[0].id)
    // The figure shows in the Decisions drawer and nowhere else.
    await page.goto(doc.path)
    await page.getByTestId('decisions-open').click() // ADJUST(spend-ledger)
    await expect(page.getByTestId('decisions-drawer')).toContainText(/run cost/i)
    for (const url of [`${job.api}/jobs/${job.job}`, `${job.api}/dashboard`, `${job.api}/needs`]) {
      expect(await bodyText(page, url)).not.toContain(String(lines[0].charged.amount.toFixed(2)))
    }
    await ctx.close()
  })
}
