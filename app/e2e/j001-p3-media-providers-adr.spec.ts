// Phase 3 acceptance, record `media-providers-adr` (features/j001-phase3-suite.clan): test 85 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `media-providers-adr` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(media-providers-adr) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(85), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name, 'client_material') // ADJUST(media-providers-adr): the material class
    const run = { op: 'generate', provider: 'mock', tier: 'standard', inputs: [photo.id] } as const
    // Unset by default: a job that carries client material is refused for a provider the agency has not cleared.
    const refused = await runOp(page, doc, run)
    expect(refused.job.reason).toBe('provider_not_cleared')
    expect(refused.job.message).toBe('This provider is not cleared for client material.')
    // Marking a provider allowed is a person's decision, in the chain, and a creative role cannot make it.
    await signIn(page, PEOPLE.copywriter)
    expect((await page.request.post(`${job.api}/providers/mock/clearance`, { data: { client_material: 'allowed' } })).status()).toBe(403) // ADJUST(media-providers-adr)
    await signIn(page, PEOPLE.accountService)
    expect((await page.request.post(`${job.api}/providers/mock/clearance`, { data: { client_material: 'allowed' } })).status()).toBe(200)
    await signIn(page, PEOPLE.producer)
    expect((await runOp(page, doc, run)).status).toBe(200)
    await ctx.close()
  })
}
