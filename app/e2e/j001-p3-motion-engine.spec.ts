// Phase 3 acceptance, record `motion-engine` (features/j001-phase3-suite.clan): test 88 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `motion-engine` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(motion-engine) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, middlewareLog } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, ledgerOf, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(88), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.artDirector)
    const doc = await productionDoc(page, job)
    const layout = await addAsset(page, doc, MEDIA.layout.name, 'layout')
    await addAsset(page, doc, MEDIA.bottle.name)
    const render = () => runOp(page, doc, { op: 'motion', tier: 'sketch', inputs: [layout.id], params: { preset: 'end-card', seconds: 3, fps: 25 } })
    const a = await render()
    const b = await render()
    expect(a.status).toBe(200)
    // The same layout and preset give the same frames, by hash, and no model is asked.
    const frames = async (id: string) => (await (await page.request.get(`/production/api/assets/${id}/frames`)).json() as { sha256: string[] }).sha256 // ADJUST(motion-engine)
    expect(await frames(a.job.outputs![0].id)).toEqual(await frames(b.job.outputs![0].id))
    expect((await frames(a.job.outputs![0].id)).length).toBe(75) // 3 seconds at 25 a second
    expect((await middlewareLog(page)).filter(e => e.task !== 'start_campaign')).toHaveLength(0)
    expect((await ledgerOf(page, job)).filter(l => l.run === a.job.id)).toHaveLength(0) // no provider, so nothing to pay for
    await ctx.close()
  })
}
