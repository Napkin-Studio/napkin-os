// Phase 3 acceptance, record `asset-provenance` (features/j001-phase3-suite.clan): test 82 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `asset-provenance` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(asset-provenance) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, bodyText, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(82), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    const still = await runOp(page, doc, { op: 'generate', tier: 'standard', inputs: [photo.id] })
    const film = await runOp(page, doc, { op: 'clip', tier: 'standard', inputs: [still.job.outputs![0].id], params: { seconds: 10 } })
    const spot = await runOp(page, doc, { op: 'voice', tier: 'sketch', params: { script: MEDIA.radio.name, slot_s: 30 } })
    const fields = ['provider', 'model', 'model_version', 'tier', 'seed', 'prompt_hash', 'inputs', 'parents', 'job', 'ledger_lines', 'made_by', 'ai', 'at']
    for (const made of [still, film, spot]) {
      const asset = made.job.outputs![0]
      const p = await (await page.request.get(`/production/api/assets/${asset.id}/provenance`)).json() as Record<string, unknown> // ADJUST(asset-provenance)
      for (const f of fields) expect(p, `${asset.kind} provenance has ${f}`).toHaveProperty(f)
      expect(['generated', 'assisted', 'none']).toContain(p.ai)
      expect((p.made_by as { agent: string }).agent).toBeTruthy()
    }
    // The prompt itself stays in the document and is in no response that leaves it.
    expect(await bodyText(page, `${job.api}/jobs/${job.job}`)).not.toContain('prompt":')
    await ctx.close()
  })
}
