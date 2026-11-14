// Phase 3 acceptance, record `craft-review` (features/j001-phase3-suite.clan): test 100 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `craft-review` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(craft-review) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, open, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(100), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.accountService)
    const doc = await productionDoc(page, job)
    const still = await addAsset(page, doc, MEDIA.bottle.name, 'still')
    // No craft review: a link for the piece is refused with the line.
    const refused = await page.request.post(`${job.api}/d/${encodeURIComponent(doc.path)}/client-link`, { data: { client: { name: 'Client A contact', email: 'contact@client-a.example' }, piece: still.id } })
    expect(refused.status()).toBe(409)
    expect(await refused.text()).toContain('This piece has not had its craft review.')
    // The named craft reviewer passes that exact version.
    await signIn(page, PEOPLE.creativeDirector)
    const pass = await page.request.post(`/s/${doc.token}/craft-review`, { data: { target: still.sha256, polarity: 'good' } }) // ADJUST(craft-review)
    expect(pass.status()).toBe(200)
    await signIn(page, PEOPLE.accountService)
    const link = await page.request.post(`${job.api}/d/${encodeURIComponent(doc.path)}/client-link`, { data: { client: { name: 'Client A contact', email: 'contact@client-a.example' }, piece: still.id } })
    expect(link.status()).toBe(200)
    // The client's page shows the reviewer's name beside the piece.
    const { ctx: cctx, page: cpage } = await open(browser, size)
    await cpage.goto(((await link.json()) as { path: string }).path)
    await expect(cpage.getByTestId('craft-reviewer')).toHaveText(`Craft review: ${PEOPLE.creativeDirector.name}`) // ADJUST(craft-review)
    await cctx.close()
    await ctx.close()
  })
}
