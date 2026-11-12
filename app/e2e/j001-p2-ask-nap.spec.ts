// Phase 2 acceptance, record `ask-nap` (features/j001-phase2-suite.clan): tests 29 and 30 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(ask-nap) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { chainOf, middlewareLog, open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { CAP_ZERO, SUGGESTIONS } from './seed/j001/p2/ask-nap.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(29), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto(`/#tool-${job.client}-brief`); await page.reload()
    await page.getByTestId('work-item').first().click()
    await page.getByTestId('ask-nap-button').click() // ADJUST(ask-nap)
    const panel = page.getByTestId('ask-nap') // ADJUST(ask-nap)
    await expect(panel.getByTestId('ask-nap-suggestion')).toHaveCount(SUGGESTIONS)
    await panel.getByTestId('ask-nap-suggestion').first().click() // the answer is the fixture's (answers/ask_nap.json)
    await expect(panel.getByTestId('ask-nap-source')).toContainText('J001 brief') // its answer names its source
    // A proposed change is a preview with Keep and Discard; Discard leaves the decision chain as it was.
    const before = (await chainOf(page, job.brief.token)).length
    await expect(panel.getByTestId('ask-nap-preview')).toBeVisible()
    await panel.getByRole('button', { name: 'Discard' }).click()
    expect((await chainOf(page, job.brief.token)).length).toBe(before)
    await ctx.close()
  })

  test.fixme(t(30), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto(`/#tool-${job.client}-brief`); await page.reload()
    await page.getByTestId('work-item').first().click()
    await page.getByTestId('ask-nap-button').click() // ADJUST(ask-nap)
    // A run shows its price before it starts.
    await expect(page.getByTestId('run-price')).toBeVisible() // ADJUST(ask-nap)
    // With the cap at 0 the run is refused with one plain line and nothing is sent to the middleware.
    const r = await page.request.put(`${job.api}/spend-cap`, { data: { cap: CAP_ZERO } }) // ADJUST(ask-nap): where the cap is set
    expect(r.status()).toBe(200)
    const sent = (await middlewareLog(page)).length
    await page.getByRole('button', { name: 'Run' }).click()
    const refused = page.locator('[data-state="over-cap"], [data-testid="run-refused"]') // ADJUST(ask-nap)
    await expect(refused).toBeVisible()
    expect((await refused.locator('.ns-line, p').allInnerTexts()).filter(Boolean)).toHaveLength(1)
    expect((await middlewareLog(page)).length, 'nothing was sent').toBe(sent)
    await ctx.close()
  })
}
