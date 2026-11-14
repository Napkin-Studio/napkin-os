// Phase 3 acceptance, record `asset-library` (features/j001-phase3-suite.clan): test 106 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `asset-library` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(asset-library) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, sessionOf, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(106), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.accountService)
    const doc = await productionDoc(page, job)
    const made = [
      await addAsset(page, doc, MEDIA.bottle.name, 'still'),
      await addAsset(page, doc, MEDIA.tv.name, 'film'),
      await addAsset(page, doc, MEDIA.radio.name, 'radio_spot'),
    ]
    // Approved: a creative director's approve on each piece's hash.
    await signIn(page, PEOPLE.creativeDirector)
    for (const a of made) expect((await page.request.post(`/s/${doc.token}/approve`, { data: { target: a.sha256, rationale: 'Approved.' } })).status()).toBe(200)
    await signIn(page, PEOPLE.accountService)
    const find = async (q: string) => ((await (await page.request.get(`${job.api}/assets?${q}`)).json()) as { assets: { sha256: string }[] }).assets // ADJUST(asset-library): the route is GET /t/{tenant}/assets
    for (const q of [`client=${job.client}`, 'kind=still', 'kind=film', 'kind=radio_spot', 'date=2026-11']) {
      expect((await find(q)).length, q).toBeGreaterThan(0)
    }
    expect((await find(`client=${job.client}`)).map(a => a.sha256).sort()).toEqual(made.map(a => a.sha256).sort())
    // A second agency finds none of them.
    await signIn(page, PEOPLE.otherAgency)
    const other = await page.request.get(`/api/t/${(await sessionOf(page)).tenant}/assets?client=${job.client}`)
    expect([200, 403, 404]).toContain(other.status())
    if (other.status() === 200) expect(((await other.json()) as { assets: unknown[] }).assets).toHaveLength(0)
    await ctx.close()
  })
}
