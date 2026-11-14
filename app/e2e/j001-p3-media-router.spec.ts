// Phase 3 acceptance, record `media-router` (features/j001-phase3-suite.clan): test 80 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `media-router` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(media-router) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(80), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    // The three tier words hold no price.
    await page.goto(`/production?job=${job.job}&open=image`) // ADJUST(phase3-doors)
    const picker = page.getByTestId('tier-picker') // ADJUST(media-tiers)
    await expect(picker).toContainText('Sketch: quick and rough')
    await expect(picker).toContainText('Standard: for showing')
    await expect(picker).toContainText('Hero: for finishing')
    await expect(picker).not.toContainText(/\d|euro|credit|price|cost/i)
    // The job's history shows the tier, the providers tried and the one used.
    const run = await runOp(page, doc, { op: 'generate', tier: 'sketch', inputs: [photo.id] })
    expect(run.job.router?.tier).toBe('sketch')
    expect(run.job.router?.tried.length).toBeGreaterThan(0)
    expect(run.job.router?.used).toBe('mock')
    await page.getByTestId('history-open').click() // ADJUST(media-router): the Booth's history
    await expect(page.getByTestId('booth')).toContainText(/Sketch/)
    await expect(page.getByTestId('booth')).toContainText(/mock/i)
    await ctx.close()
  })
}
