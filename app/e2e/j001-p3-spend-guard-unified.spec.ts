// Phase 3 acceptance, record `spend-guard-unified` (features/j001-phase3-suite.clan): test 76 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `spend-guard-unified` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(spend-guard-unified) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, middlewareLog } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(76), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    const asked = await middlewareLog(page)
    // A paid op on a real provider, with the cap at 0 and the keys unset: refused, one plain line, nothing sent.
    const run = await runOp(page, doc, { op: 'generate', provider: 'runway', tier: 'hero', inputs: [photo.id] })
    expect(run.job.reason).toBe('spend_stop')
    expect(run.job.message).toBe('Paid runs are off here. Nothing was sent.')
    const sent = await (await page.request.get('/production/api/test/transport-log')).json() as unknown[] // ADJUST(spend-guard-unified): the mock transport's record
    expect(sent).toHaveLength(0)
    // A model call (Ask Nap) is refused the same way and the stand-in is not asked.
    const ask = await page.request.post(`${job.api}/ask`, { data: { question: 'Summarise the brief.' } }) // ADJUST(spend-guard-unified)
    expect(ask.status()).toBe(402)
    expect((await middlewareLog(page)).length).toBe(asked.length)
    // On the page the person reads the same line.
    await page.goto(`/production?job=${job.job}&open=image`) // ADJUST(phase3-doors)
    await page.getByTestId('run-hero').click() // ADJUST(spend-guard-unified)
    await expect(page.getByTestId('refusal')).toHaveText('Paid runs are off here. Nothing was sent.')
    await ctx.close()
  })
}
