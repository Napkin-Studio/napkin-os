// Phase 3 acceptance, record `traffic-board` (features/j001-phase3-suite.clan): test 105 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `traffic-board` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(traffic-board) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES } from './pilot'
import { PEOPLE } from './seed/j001'
import { startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(105), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.traffic)
    // A fixture of 12 people on the board, and a new job with one open role.
    expect((await page.request.post(`${job.api}/traffic-fixture`, { data: { people: 12, open_role: { job: job.job, role: 'copywriter' } } })).status()).toBe(200) // ADJUST(traffic-core)
    const started = Date.now()
    await page.goto('/traffic') // ADJUST(phase3-doors, traffic-board)
    await page.getByTestId('open-role').first().click()
    const suggestions = page.getByTestId('suggestion')
    expect(await suggestions.count()).toBeLessThanOrEqual(5)
    await expect(suggestions.first().getByTestId('suggestion-reason')).not.toBeEmpty()
    await suggestions.first().click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByTestId('board-role-filled').first()).toBeVisible()
    expect(Date.now() - started).toBeLessThan(60_000)
    // One decision is written, and the job page shows who is on the job.
    const people = ((await (await page.request.get(`${job.api}/jobs/${job.job}`)).json()) as { staffing?: unknown[] }).staffing ?? [] // ADJUST(traffic-core)
    expect(people).toHaveLength(1)
    await ctx.close()
  })
}
