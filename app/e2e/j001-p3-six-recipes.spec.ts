// Phase 3 acceptance, record `six-recipes` (features/j001-phase3-suite.clan): test 93 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `six-recipes` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(six-recipes) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(93), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.artDirector)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    await page.goto(`/production?job=${job.job}&open=image`) // ADJUST(phase3-doors)
    await page.getByTestId('add').click() // ADJUST(six-recipes): the Add door
    const names = ['Clean Packshot', 'Product Campaign Image', 'Product Ad', 'Product UGC', 'Product Turntable', 'Format Flip']
    for (const n of names) await expect(page.getByTestId('recipe').filter({ hasText: n })).toHaveCount(1)
    await expect(page.getByTestId('recipe')).toHaveCount(6)
    // Clean Packshot runs on the mock from the product photo: its steps in order, each an ordinary job with lineage to the one before.
    const run = await page.request.post('/production/api/recipes/clean-packshot/run', { data: { document: doc.id, inputs: [photo.id], provider: 'mock' } }) // ADJUST(recipe-runner)
    expect(run.status()).toBe(200)
    const steps = ((await run.json()) as { jobs: { op: string; parents: string[]; id: string }[] }).jobs
    expect(steps.map(s => s.op)).toEqual(['cutout', 'clean_ground', 'upscale']) // ADJUST(six-recipes): the recipe's own step names
    steps.slice(1).forEach((s, i) => expect(s.parents).toContain(steps[i].id))
    await ctx.close()
  })
}
