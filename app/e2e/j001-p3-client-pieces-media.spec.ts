// Phase 3 acceptance, record `client-pieces-media` (features/j001-phase3-suite.clan): test 101 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `client-pieces-media` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(client-pieces-media) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, open, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(101), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.accountService)
    const doc = await productionDoc(page, job)
    const pieces = [
      { file: MEDIA.bottle.name, role: 'still', element: 'img' },
      { file: MEDIA.tv.name, role: 'film', element: 'video' },
      { file: MEDIA.radio.name, role: 'radio_spot', element: 'audio' },
    ]
    const ids: string[] = []
    await signIn(page, PEOPLE.creativeDirector)
    for (const p of pieces) {
      const a = await addAsset(page, doc, p.file, p.role)
      expect((await page.request.post(`/s/${doc.token}/craft-review`, { data: { target: a.sha256, polarity: 'good' } })).status()).toBe(200) // ADJUST(craft-review)
      ids.push(a.id)
    }
    await signIn(page, PEOPLE.accountService)
    const link = await page.request.post(`${job.api}/d/${encodeURIComponent(doc.path)}/client-link`, { data: { client: { name: 'Client A contact', email: 'contact@client-a.example' }, pieces: ids } })
    expect(link.status()).toBe(200)
    const { ctx: cctx, page: cpage } = await open(browser, size)
    await cpage.goto(((await link.json()) as { path: string }).path)
    // One piece at a time, each with its label text and its craft reviewer's name.
    for (const p of pieces) {
      await expect(cpage.getByTestId('client-piece')).toHaveCount(1)
      await expect(cpage.getByTestId('client-piece').locator(p.element).first()).toBeVisible() // ADJUST(client-pieces-media)
      await expect(cpage.getByTestId('client-piece-label')).toContainText(/AI/)
      await expect(cpage.getByTestId('craft-reviewer')).toContainText(PEOPLE.creativeDirector.name!)
      await cpage.getByTestId('client-comment').fill('Lovely.')
      await cpage.getByRole('button', { name: 'Send comment' }).click()
      await cpage.getByRole('button', { name: 'Next piece' }).click().catch(() => undefined)
    }
    await cctx.close()
    await ctx.close()
  })
}
