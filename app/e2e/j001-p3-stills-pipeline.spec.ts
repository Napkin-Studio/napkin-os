// Phase 3 acceptance, record `stills-pipeline` (features/j001-phase3-suite.clan): test 86 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `stills-pipeline` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(stills-pipeline) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, middlewareLog } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(86), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.artDirector)
    const doc = await productionDoc(page, job)
    const scamp = await addAsset(page, doc, MEDIA.scamp.name, 'scamp')
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    const layout = await addAsset(page, doc, MEDIA.layout.name, 'layout')
    // scamp to image to photograph to still: three jobs with lineage.
    const image = await runOp(page, doc, { op: 'scamp_to_image', tier: 'standard', inputs: [scamp.id, photo.id] })
    const photograph = await runOp(page, doc, { op: 'photograph', tier: 'hero', inputs: [image.job.outputs![0].id] })
    const still = await runOp(page, doc, { op: 'compose', tier: 'standard', inputs: [photograph.job.outputs![0].id, layout.id] })
    for (const r of [image, photograph, still]) expect(r.status).toBe(200)
    const p = await (await page.request.get(`/production/api/assets/${still.job.outputs![0].id}/provenance`)).json() as { parents: string[]; ai: string }
    expect(p.parents).toContain(photograph.job.outputs![0].id)
    expect(p.ai).not.toBe('none')
    // The still has its label, and the type is a layer, not picture.
    await page.goto(`/production?job=${job.job}&open=image`) // ADJUST(phase3-doors)
    await expect(page.getByTestId('ai-label').first()).toBeVisible()
    // Send to Judge records one request, and Send to Formats makes a set of 12 sizes.
    await page.getByRole('button', { name: 'Send to Judge' }).click() // ADJUST(stills-pipeline)
    expect((await middlewareLog(page)).filter(e => e.task === 'judge_work')).toHaveLength(1)
    await page.getByRole('button', { name: 'Send to Formats' }).click()
    await expect(page.getByTestId('format-set')).toHaveAttribute('data-sizes', '12')
    await ctx.close()
  })
}
