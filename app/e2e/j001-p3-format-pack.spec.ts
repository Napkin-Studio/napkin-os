// Phase 3 acceptance, record `format-pack` (features/j001-phase3-suite.clan): test 92 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `format-pack` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(format-pack) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, ledgerOf, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(92), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const master = await addAsset(page, doc, MEDIA.bottle.name, 'master')
    const layout = await addAsset(page, doc, MEDIA.layout.name, 'layout')
    const made = await runOp(page, doc, { op: 'format_pack', tier: 'standard', inputs: [master.id, layout.id], params: { pack: 'j001-12' } })
    expect(made.status).toBe(200)
    // Twelve sizes, each made by crop or layout, so no paid call and nothing on the ledger.
    const pack = await (await page.request.get(`/production/api/packs/${made.job.outputs![0].id}`)).json() as { sizes: { id: string; method: string; flagged: boolean }[]; ready: boolean } // ADJUST(format-pack)
    expect(pack.sizes).toHaveLength(12)
    expect(pack.sizes.every(s => s.method === 'crop' || s.method === 'layout')).toBe(true)
    expect((await ledgerOf(page, job)).filter(l => l.run === made.job.id && l.charged.amount > 0)).toHaveLength(0)
    // A person sees only the flagged ones: 2 of 12 by the fixture, 2 looks, then ready.
    await page.goto(`/production?job=${job.job}&open=formats`) // ADJUST(phase3-doors)
    const flagged = page.getByTestId('pack-flagged')
    await expect(flagged).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Mark ready' })).toBeDisabled()
    for (let i = 0; i < 2; i++) await page.getByTestId('look-ok').first().click() // 'ok as is'
    await expect(page.getByRole('button', { name: 'Mark ready' })).toBeEnabled()
    await page.getByRole('button', { name: 'Mark ready' }).click()
    await expect(page.getByTestId('pack-status')).toHaveText(/Ready/)
    await ctx.close()
  })
}
