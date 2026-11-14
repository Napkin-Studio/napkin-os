// Phase 3 acceptance, record `flux-provider` (features/j001-phase3-suite.clan): test 109 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `flux-provider` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(flux-provider) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(109), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    // The first candidate is down: the router tries the next one, FLUX, and the job records both attempts.
    const run = await runOp(page, doc, { op: 'generate', tier: 'sketch', inputs: [photo.id], params: { fault: { runway: 'down' } } }) // ADJUST(media-router): the mock's fault switch
    expect(run.status).toBe(200)
    expect(run.job.router?.tried.map(t => `${t.provider}:${t.outcome}`)).toEqual(['runway:down', 'bfl:ok']) // ADJUST(flux-provider): the provider's id
    expect(run.job.router?.used).toBe('bfl')
    // With every real provider down on a deployed-like stack the job fails with one plain line, and nothing of kind mock is made.
    const failed = await runOp(page, doc, { op: 'generate', tier: 'sketch', inputs: [photo.id], params: { fault: { runway: 'down', bfl: 'down' }, deployed: true } })
    expect(failed.job.state).toBe('failed')
    expect(failed.job.message).toBeTruthy()
    expect(failed.job.outputs ?? []).toHaveLength(0)
    // With the cap at 0 and a real key unset, FLUX is refused before a request is built.
    const stopped = await runOp(page, doc, { op: 'generate', provider: 'bfl', tier: 'hero', inputs: [photo.id] })
    expect(stopped.job.reason).toBe('spend_stop')
    await ctx.close()
  })
}
