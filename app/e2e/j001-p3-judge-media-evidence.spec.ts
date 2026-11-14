// Phase 3 acceptance, record `judge-media-evidence` (features/j001-phase3-suite.clan): test 99 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `judge-media-evidence` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(judge-media-evidence) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { type Decision, SIZES, chainOf, control } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, VERDICT_VARIANT, addAsset, bodyText, productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(99), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.creativeDirector)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name, 'still')
    // One part of the piece is confidential: Napkin's own systems never take it in.
    expect((await page.request.post(`/s/${doc.token}/confidential`, { data: { part: `asset:${photo.id}`, on: true } })).status()).toBe(200) // ADJUST(judge-media-evidence)
    await control(page, { variant: { judge_work: VERDICT_VARIANT } })
    expect((await page.request.post(`/s/${doc.token}/judge`, { data: { target: photo.sha256, work_kind: 'still' } })).status()).toBe(200)
    const [v] = (await chainOf(page, doc.token)).filter(d => d.kind === 'verdict') as (Decision & { judge?: { not_read?: string[] } })[]
    expect(v.judge?.not_read).toContain(`asset:${photo.id}`)
    // The evidence holds the asset's measured facts, and never the prompt, the seed, the provider, the model or the maker's name.
    const evidence = await bodyText(page, `/s/${doc.token}/judge/evidence?target=${photo.sha256}`) // ADJUST(judge-media-evidence)
    for (const word of ['prompt', 'seed', 'provider', 'model', PEOPLE.creativeDirector.name!]) expect(evidence.toLowerCase()).not.toContain(word.toLowerCase())
    await ctx.close()
  })
}
