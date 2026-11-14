// Phase 3 acceptance, record `outdoor-in-situ` (features/j001-phase3-suite.clan): test 91 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `outdoor-in-situ` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(outdoor-in-situ) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, middlewareLog } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, SITES, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(91), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.artDirector)
    const doc = await productionDoc(page, job)
    const poster = await addAsset(page, doc, MEDIA.bottle.name, 'poster') // the poster stands in as the product picture of the fixture
    const site = SITES.find(s => s.site === '48 sheet')!
    const site48 = await addAsset(page, doc, site.name, 'site')
    const placed = await runOp(page, doc, { op: 'in_situ', tier: 'sketch', inputs: [poster.id, site48.id], params: { site: 'site-48-sheet' } })
    expect(placed.status).toBe(200)
    // The warped poster's corners land within 1 pixel of the site's known corners.
    const out = await (await page.request.get(`/production/api/assets/${placed.job.outputs![0].id}/placement`)).json() as { corners: [number, number][] } // ADJUST(outdoor-in-situ)
    site.corners!.forEach(([x, y], i) => {
      expect(Math.abs(out.corners[i][0] - x)).toBeLessThanOrEqual(1)
      expect(Math.abs(out.corners[i][1] - y)).toBeLessThanOrEqual(1)
    })
    // The word Mock-up is on the output, as a type layer, and no model was asked.
    await page.goto(`/production?job=${job.job}&open=outdoor`) // ADJUST(phase3-doors)
    await expect(page.getByTestId('mock-up-label').first()).toHaveText('Mock-up')
    expect((await middlewareLog(page)).filter(e => e.task !== 'start_campaign')).toHaveLength(0)
    await ctx.close()
  })
}
