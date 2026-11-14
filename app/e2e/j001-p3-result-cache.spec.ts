// Phase 3 acceptance, record `result-cache` (features/j001-phase3-suite.clan): test 81 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `result-cache` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(result-cache) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, ledgerOf, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(81), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    const ask = { op: 'generate', tier: 'sketch', inputs: [photo.id], params: { seed: 7 } } as const
    const first = await runOp(page, doc, ask)
    const sentAfterFirst = (await (await page.request.get('/production/api/test/transport-log')).json() as unknown[]).length // ADJUST(spend-guard-unified)
    const second = await runOp(page, doc, ask)
    // The provider was called once: the second run is a finished job marked reused, with the same output.
    expect((await (await page.request.get('/production/api/test/transport-log')).json() as unknown[]).length).toBe(sentAfterFirst)
    expect(second.job.reused).toBe(true)
    expect(second.job.outputs?.[0].sha256).toBe(first.job.outputs?.[0].sha256)
    // One ledger line for the second run: released, charged 0, reason cache_hit. Nothing reserved.
    const line = (await ledgerOf(page, job)).find(l => l.run === second.job.id)
    expect(line?.state).toBe('released')
    expect(line?.charged.amount).toBe(0)
    expect(line?.reason).toBe('cache_hit')
    await ctx.close()
  })
}
