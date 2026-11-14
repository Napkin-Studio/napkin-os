// Phase 3 acceptance, record `production-platform-rules` (features/j001-phase3-suite.clan): tests 75 to 79 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `production-platform-rules` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(production-platform-rules) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, chainOf } from './pilot'
import { PEOPLE } from './seed/j001'
import { MEDIA, addAsset, productionDoc, runOp, startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(75), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    expect((await runOp(page, doc, { op: 'generate', tier: 'sketch', inputs: [photo.id] })).status).toBe(200)
    const chain = await chainOf(page, doc.token)
    expect(chain.length).toBeGreaterThan(0)
    // Every write names an agent and an action, for people and for the crew.
    for (const d of chain) {
      expect(d.agent, `entry ${d.id} names an agent`).toBeTruthy()
      expect(d.action, `entry ${d.id} names an action`).toBeTruthy()
    }
    // The person's own upload is marked as theirs.
    expect(chain.some(d => (d.actor ?? '').includes(PEOPLE.producer.username))).toBe(true)
    await ctx.close()
  })

  test.fixme(t(79), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    const doc = await productionDoc(page, job)
    const photo = await addAsset(page, doc, MEDIA.bottle.name)
    // Every refusal the line can make, each with its own words and none with a figure or a currency word.
    const refusals = [
      await runOp(page, doc, { op: 'generate', provider: 'runway', tier: 'hero', inputs: [photo.id] }), // spend_stop, cap 0
      await runOp(page, doc, { op: 'generate', tier: 'hero', inputs: [photo.id], params: { force: 'limit_reached' } }), // ADJUST(production-platform-rules): the mock's fault switch
    ]
    for (const r of refusals) {
      expect(r.job.message, 'a refusal says one line').toBeTruthy()
      expect(r.job.message).not.toMatch(/\d/)
      expect(r.job.message).not.toMatch(/euro|eur|dollar|usd|credit|price|cost|\u20ac|\$/i)
    }
    await page.goto(`/production?job=${job.job}&open=image`) // ADJUST(phase3-doors)
    await page.getByTestId('run-hero').click()
    const shown = (await page.getByTestId('refusal').innerText())
    expect(shown).not.toMatch(/\d|euro|dollar|credit|price|cost/i)
    await ctx.close()
  })
}
