// Phase 2 acceptance, record `job-page` (features/j001-phase2-suite.clan): tests 21 and 22 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(job-page) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { chainOf, open, SIZES, signIn } from './pilot'
import { PHASE2 } from './phase2/tests.mjs'
import { asMe, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(21), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.goto('/#live-jobs') // ADJUST(job-page): the Live jobs address
    await page.reload()
    await page.getByTestId('job-row').filter({ hasText: job.job }).click() // ADJUST(job-page)
    const jobPage = page.getByTestId('job-page') // ADJUST(job-page)
    await expect(jobPage).toBeVisible()
    for (const part of ['job-stage', 'job-documents', 'job-holder', 'job-deadline']) await expect(jobPage.getByTestId(part)).toBeVisible()
    await expect(jobPage.getByTestId('job-deadline')).toContainText('18 Dec') // J001's due date, 2026-12-18
    // Each tool opens inside the job: the brief opens and the job page's crumb stays.
    await jobPage.getByTestId('job-document').filter({ hasText: 'brief' }).first().click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('job-crumb')).toContainText(job.job) // ADJUST(job-page)
    await ctx.close()
  })

  test.fixme(t(22), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signBrief(page, job.brief)
    await signIn(page, PEOPLE.creativeDirector)
    expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
    // The brief gets a new version after work has started.
    const edit = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A new line.' }, agent: 'human', action: 'edit the proposition' } })
    expect(edit.status()).toBe(200)
    expect((await chainOf(page, job.brief.token)).find(d => d.action === 'edit the proposition')?.version).toBeTruthy()
    await page.goto(`/#job-${job.job}`) // ADJUST(job-page): the job page's address
    await page.reload()
    const changed = page.getByTestId('changed-brief')
    await expect(changed).toBeVisible()
    await expect(changed.locator('li, p')).toHaveCount(2) // two lines
    await expect(changed.getByRole('button')).toHaveCount(1) // one button
    await expect(changed.getByRole('button', { name: /^Update to brief v\d+$/ })).toBeVisible()
    await ctx.close()
  })
}
