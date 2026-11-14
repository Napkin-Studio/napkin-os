// Phase 3 acceptance, record `production-line-merge` (features/j001-phase3-suite.clan): test 74 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `production-line-merge` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(production-line-merge) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, open } from './pilot'
import { PEOPLE } from './seed/j001'
import { productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(74), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    await page.goto('/production') // ADJUST(production-line-merge): the shell route
    await expect(page.getByTestId('production')).toBeVisible()
    const doc = await productionDoc(page, job)
    expect(doc.path).toContain(job.job)
    await expect(page.getByTestId('production-document')).toContainText(job.job) // ADJUST(production-line-merge)
    // An account with no agency gets 401.
    const anon = await open(browser, size, 'white', { roster: true })
    expect((await anon.page.request.get('/production/api/jobs')).status()).toBe(401)
    expect((await anon.page.goto('/production'))?.status()).toBe(401)
    await anon.ctx.close()
    await ctx.close()
  })
}
