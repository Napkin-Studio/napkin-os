// Phase 3 acceptance, record `scope-document` (features/j001-phase3-suite.clan): tests 102 to 104 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Written before the tool exists, so each body is marked `test.fixme`: the registry (phase3/tests.mjs) names `scope-document` as the record that turns it on,
// and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(scope-document) (or another record's slug) are guesses from the
// design (routes, selectors, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read through a document's
// chain and the API do not move with the screen and are the part to keep.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { expect, test } from '@playwright/test'
import { SIZES, signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import { startJ001, title } from './phase3/support'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(102), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    // A three round job (the deliverable's rounds_included is 3) with three rounds already made.
    expect((await page.request.put(`${job.api}/jobs/${job.job}/scope`, { data: { deliverables: [{ name: 'Press ad', rounds_included: 3, rounds_used: 3 }] } })).status()).toBe(200) // ADJUST(scope-core)
    // The fourth round is refused with the line, and a change order is drafted.
    const round = await page.request.post(`${job.api}/jobs/${job.job}/rounds`, { data: { deliverable: 'Press ad' } }) // ADJUST(scope-core)
    expect(round.status()).toBe(409)
    expect(await round.text()).toContain('This round is outside the scope. A change order is waiting.')
    // A need reaches the producer.
    await page.goto('/#door-needs-you') // ADJUST(scope-document)
    await expect(page.locator('[data-testid="need"][data-kind="change-order"]')).toHaveCount(1)
    // The producer opens the scope and approves the change order in the Booth, a decision by a person with a note.
    await page.goto('/#door-scope-estimates')
    await page.getByTestId('scope-part-change-orders').click() // ADJUST(scope-document)
    await page.getByTestId('booth-note').fill('Agreed with the client.')
    await page.getByRole('button', { name: 'Approve' }).click()
    const chain = await (await page.request.get(`${job.api}/jobs/${job.job}/scope/chain`)).json() as { decisions: { kind?: string; actor?: string }[] }
    expect(chain.decisions.some(d => d.kind === 'change_order' && d.actor?.includes(PEOPLE.producer.username))).toBe(true)
    // The round goes ahead.
    expect((await page.request.post(`${job.api}/jobs/${job.job}/rounds`, { data: { deliverable: 'Press ad' } })).status()).toBe(200)
    await ctx.close()
  })

  test.fixme(t(103), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    // Two confirmed timesheet days and one drafted day; only the confirmed ones count, and nobody's time is submitted for them.
    const days = [{ day: '2026-11-09', hours: 6, state: 'confirmed' }, { day: '2026-11-10', hours: 4, state: 'confirmed' }, { day: '2026-11-11', hours: 8, state: 'draft' }]
    expect((await page.request.post(`${job.api}/jobs/${job.job}/timesheet-fixture`, { data: { days } })).status()).toBe(200) // ADJUST(scope-core): a fixture route, or the timesheet seed of Phase 2
    await page.goto('/#door-scope-estimates')
    await page.getByRole('button', { name: 'Draw up lines for this period' }).click() // ADJUST(scope-document)
    const rows = page.getByTestId('invoice-line')
    await expect(rows).toHaveCount(1) // hours by role at the rate card's rate: one role, two confirmed days
    await expect(rows.first()).toContainText('10') // 6 + 4 confirmed hours, not 18
    await expect(rows.first().getByTestId('invoice-source')).toHaveCount(2) // each line links its source
    // The CSV holds the same lines, with the source ids.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
    const csv = (await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8')).trim().split('\n')
    expect(csv.length).toBe(2) // a header and one line
    expect(csv[1]).toMatch(/2026-11-09/)
    expect(csv[1]).not.toMatch(/2026-11-11/)
    await ctx.close()
  })

  test.fixme(t(104), async ({ browser }) => {
    const { ctx, page, job } = await startJ001(browser, size, PEOPLE.producer)
    // A producer reads the figures in the sheet and none in the shell around it.
    await page.goto('/#door-scope-estimates') // ADJUST(scope-document)
    await expect(page.getByTestId('scope-sheet')).toBeVisible()
    await expect(page.getByTestId('scope-sheet')).toContainText(/\d/)
    for (const id of ['bar', 'status-pill', 'needs-you', 'job-card']) { // ADJUST(scope-document): the shell parts that must hold no figure
      const el = page.getByTestId(id).first()
      if (await el.count()) await expect(el).not.toContainText(/euro|eur|\u20ac|\$|price|estimate/i)
    }
    // A planner gets 403 or the Empty state, and no search finds the scope.
    await signIn(page, PEOPLE.planning)
    expect((await page.request.get(`${job.api}/jobs/${job.job}/scope`)).status()).toBe(403)
    await page.goto('/#door-scope-estimates')
    await expect(page.getByTestId('scope-sheet')).toHaveCount(0)
    const found = await (await page.request.get(`${job.api}/search?q=scope`)).text()
    expect(found).not.toMatch(/"kind":"scope"/)
    await ctx.close()
  })
}
