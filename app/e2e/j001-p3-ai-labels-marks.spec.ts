// Phase 3 acceptance, record `ai-labels-marks` (features/j001-phase3-suite.clan): test 83 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `ai-labels-marks` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(ai-labels-marks) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(83), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    const still = await runOp(page, doc, { op: 'generate', tier: 'standard', inputs: [photo.id] })
    const spot = await runOp(page, doc, { op: 'voice', tier: 'sketch', params: { script: MEDIA.radio.name, slot_s: 30 } })
    for (const made of [still, spot]) {
      const asset = made.job.outputs![0]
      const out = await page.request.post(`/production/api/assets/${asset.id}/export`, { data: { label: 'persistent' } }) // ADJUST(ai-labels-marks)
      expect(out.status()).toBe(200)
      const body = await out.body()
      // The mark is read back from the file itself: IPTC Digital Source Type for the image, an ID3 comment frame for the audio.
      expect(body.toString('latin1')).toMatch(asset.kind === 'image' ? /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/ : /AI-generated/)
    }
    // The label is on the page, beside the piece.
    await page.goto(`/production?job=${job.job}&open=image`) // ADJUST(phase3-doors)
    await expect(page.getByTestId('ai-label').first()).toBeVisible()
    // An export with the label step skipped is refused.
    const skipped = await page.request.post(`/production/api/assets/${still.job.outputs![0].id}/export`, { data: { label: 'none' } })
    expect(skipped.status()).toBe(422)
    await ctx.close()
  })
}
