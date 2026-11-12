// Phase 2 acceptance, record `job-page` (features/job-page.clan): tests 21 and 22 of docs/design/phase2-acceptance.md, run at 390 and 1440 px
// on the roster stack, then the design's own shell tests: the page's live update, Live jobs and its Empty state, and who may open and
// change a job. Titles of the numbered tests read `N short, W px`, the form the suite's registry (phase2/tests.mjs) and counter read; the
// others carry the design's own S-number. No model and no paid provider.
//
//   NAPKIN_E2E_SHOTS=docs/design/job-page npm run e2e -- j001-p2-job-page

import { expect, test, type Page } from '@playwright/test'
import { asMe, gateOf, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { chainOf, open, SIZES, signIn } from './pilot'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short
const shots = process.env.NAPKIN_E2E_SHOTS

/** The way to a screen, as the other specs do it: the landing first, then the hash, then a reload so the hash is read from cold. */
const goto = async (page: Page, hash: string) => { await page.goto('/'); await page.goto(`/#${hash}`); await page.reload() }

const trail = (page: Page) => page.getByRole('navigation', { name: 'Where you are' })

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`
  const s = (id: string, what: string) => `${id} ${what}, ${size.tag} px`

  test(t(21), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    // Account service names who approves the brief, so the page can say who holds the job and for how long.
    const route = await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { route: [{ stage: 'brief-check', party: 'agency', role: 'planner', approver: PEOPLE.planning.username, due: '2026-12-01' }] } })
    expect(route.status()).toBe(200)
    // Open J001 from Live jobs.
    await goto(page, 'door-live-jobs')
    const row = page.locator(`[data-testid="live-job"][data-job="${job.job}"]`)
    await expect(row).toBeVisible()
    await row.getByTestId('live-job-link').click()
    await expect(page).toHaveURL(new RegExp(`#job-${job.job}$`))
    // One job page shows its stage, its documents, who holds it and its deadline.
    const jobPage = page.getByTestId('job-page')
    await expect(jobPage).toBeVisible()
    await expect(jobPage.getByTestId('job-stage')).toContainText('Step 2 of 11. Brief check.')
    await expect(jobPage.getByTestId('job-holder')).toContainText(PEOPLE.planning.username)
    await expect(jobPage.getByTestId('job-due')).toContainText('18 Dec') // J001's due date, 2026-12-18
    await expect(jobPage.getByTestId('route-strip')).toBeVisible()
    await expect(jobPage.getByTestId('job-document')).toHaveCount(3)
    for (const title of ['brief', 'research', 'deck']) await expect(jobPage.getByTestId('job-documents')).toContainText(new RegExp(title, 'i'))
    if (shots) await page.screenshot({ path: `${shots}/job-page-${size.tag}.png`, fullPage: true })
    // Each tool opens inside the job: the brief opens, and the client chip's way back lands on the job page.
    await jobPage.locator('[data-testid="job-document"][data-app="ie.napkin.brief-maker"]').getByTestId('job-open-document').click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await trail(page).getByRole('button').click()
    await expect(page).toHaveURL(new RegExp(`#job-${job.job}$`))
    await expect(page.getByTestId('job-page')).toBeVisible()
    await ctx.close()
  })

  test(t(22), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signBrief(page, job.brief)
    await signIn(page, PEOPLE.creativeDirector)
    expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
    // The brief gets a new version after work has started.
    const edit = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A new line.' }, agent: 'human', action: 'edit the proposition' } })
    expect(edit.status()).toBe(200)
    expect((await chainOf(page, job.brief.token)).find(d => d.action === 'edit the proposition')).toBeTruthy()
    expect((await gateOf(page, job.brief)).changed_since_lock, 'the signed version stays and the draft moved on').toBe(true)
    await goto(page, `job-${job.job}`)
    const changed = page.locator('[data-state="changed-brief"]')
    await expect(changed).toBeVisible()
    await expect(changed.locator('p')).toHaveCount(2) // two lines
    await expect(changed.getByRole('button')).toHaveCount(1) // one button
    await expect(changed.getByRole('button', { name: /^Update to brief v\d+$/ })).toHaveText('Update to brief v2')
    if (shots) await page.screenshot({ path: `${shots}/job-page-changed-brief-${size.tag}.png`, fullPage: true })
    // The button opens the brief, where the new version is signed.
    await changed.getByRole('button').click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await ctx.close()
  })

  test(s('S1', 'the page stays current: a stage change shows inside 10 seconds'), async ({ browser }) => {
    const mgr = await open(browser, size, 'white', { roster: true })
    const planner = await open(browser, size, 'white', { roster: true })
    await signIn(planner.page, PEOPLE.planning)
    const job = await seedJ001(planner.page, { ready: true, fresh: true })
    await signIn(mgr.page, PEOPLE.accountService)
    await goto(mgr.page, `job-${job.job}`)
    await expect(mgr.page.getByTestId('job-stage')).toContainText('Brief check')
    await expect(mgr.page.getByTestId('job-status')).not.toContainText('planner has signed')
    expect((await signBrief(planner.page, job.brief)).status()).toBe(200)
    await expect(mgr.page.getByTestId('job-status')).toContainText('planner has signed', { timeout: 10_000 })
    await mgr.ctx.close(); await planner.ctx.close()
  })

  test(s('S1', 'a job that is not in this agency, or is malformed, is not shown'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    await goto(page, 'job-J999')
    await expect(page.getByTestId('job-page')).toContainText('This job is not in your agency.')
    await page.getByRole('button', { name: 'Go to Live jobs' }).click()
    await expect(page.getByTestId('live-jobs')).toBeVisible()
    await goto(page, 'job-../x')
    await expect(page).toHaveURL(/#agency$/)
    await ctx.close()
  })

  test(s('S1', 'dashboard numbers and Needs you rows open the job page'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.management)
    await goto(page, 'door-agency-dashboard')
    const link = page.getByTestId('tile-stage').locator(`[data-job="${job.job}"]`).getByRole('link', { name: job.job })
    await expect(link).toHaveAttribute('href', `#job-${job.job}`)
    // a Needs you row: the job number is a link, and the button still opens the document
    await signIn(page, PEOPLE.planning) // the planner's Needs you holds the brief's gate need for this job
    await page.goto('/'); await expect(page.getByTestId('home')).toBeVisible()
    await expect(page.getByTestId('needs-you')).toBeVisible()
    // earlier jobs of this agency's planner may fill the first five rows: Show all, when it is offered
    await expect.poll(async () => {
      const more = page.getByTestId('needs-show-all')
      if (await more.count()) await more.click()
      return page.getByTestId('need').filter({ hasText: job.job }).count()
    }).toBeGreaterThan(0)
    const need = page.getByTestId('need').filter({ hasText: job.job }).first()
    await expect(need.getByTestId('need-job')).toHaveAttribute('href', `#job-${job.job}`)
    await need.getByTestId('need-job').click()
    await expect(page.getByTestId('job-page')).toBeVisible()
    await ctx.close()
  })

  test(s('S2', 'Live jobs lists J001 for account service and a fresh agency sees Empty'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await goto(page, 'door-live-jobs')
    await expect(page.getByTestId('live-job').filter({ hasText: job.job })).toBeVisible()
    if (shots) await page.screenshot({ path: `${shots}/live-jobs-${size.tag}.png`, fullPage: true })
    // soonest deadline first, none last: the list is in the order the server's dates give
    const due = await page.getByTestId('live-job').evaluateAll(rows => rows.map(r => r.querySelector('.jp-row-due')?.textContent ?? ''))
    const dated = due.findIndex(d => d === 'No deadline')
    if (dated >= 0) expect(due.slice(dated).every(d => d === 'No deadline'), 'a job with no deadline is last').toBe(true)
    await ctx.close()

    const fresh = await open(browser, size, 'white', { roster: true })
    await signIn(fresh.page, PEOPLE.emptyAgency)
    await goto(fresh.page, 'door-live-jobs')
    const empty = fresh.page.getByTestId('live-jobs').locator('[data-state="empty"]')
    await expect(empty).toBeVisible()
    await expect(empty.getByRole('button')).toHaveCount(1)
    await expect(empty.getByRole('button')).toHaveText('Open a job')
    if (shots) await fresh.page.screenshot({ path: `${shots}/live-jobs-empty-${size.tag}.png`, fullPage: true })
    await fresh.ctx.close()
  })

  test(s('S3', 'account service opens a job from Live jobs and sets its budget; planning changes the deadline and never sees the budget'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    // The seed numbers its jobs after its clients (J001 for Client A, J002 for Client A2): a job opened here takes a number the seed
    // will never reach, so a later test's fresh job is not the one this test opened.
    const high = await page.request.post(`${job.api}/jobs`, { data: { number: 'J900', client_id: job.client } })
    expect([201, 409]).toContain(high.status())
    await goto(page, 'door-live-jobs')
    await page.getByTestId('open-a-job').click()
    await page.getByTestId('open-f-client').selectOption(job.client)
    await page.getByTestId('open-f-title').fill('Winter bar night')
    await page.getByTestId('open-f-due').fill('2026-12-30')
    await page.getByTestId('open-f-budget').fill('80')
    await page.getByTestId('open-save').click()
    await expect(page).toHaveURL(/#job-J\d{3,6}$/)
    await expect(page.getByTestId('job-title')).toContainText('Winter bar night')
    await expect(page.getByTestId('job-budget')).toContainText('80 hours')
    const number = page.url().split('#job-')[1]
    // account service changes the title, owner and deadline on the page, and the budget
    await page.getByTestId('job-edit').click()
    await page.getByTestId('job-f-due').fill('2026-12-23')
    await page.getByTestId('job-f-budget').fill('90')
    await page.getByTestId('job-save').click()
    await expect(page.getByTestId('job-due')).toContainText('23 Dec')
    await expect(page.getByTestId('job-budget')).toContainText('90 hours')
    if (shots) await page.screenshot({ path: `${shots}/job-page-money-${size.tag}.png`, fullPage: true })

    // planning may change the deadline; the budget is not sent to it and the server refuses it
    await signIn(page, PEOPLE.planning)
    await goto(page, `job-${number}`)
    await expect(page.getByTestId('job-budget')).toHaveCount(0)
    await page.getByTestId('job-edit').click()
    await expect(page.getByTestId('job-f-budget')).toHaveCount(0)
    await page.getByTestId('job-f-due').fill('2027-01-08')
    await page.getByTestId('job-save').click()
    await expect(page.getByTestId('job-due')).toContainText('8 Jan')
    expect((await page.request.patch(`${job.api}/jobs/${number}`, { data: { budget_hours: 5 } })).status()).toBe(403)
    const list = (await (await page.request.get(`${job.api}/jobs`)).json()) as { number: string; budget_hours?: number }[]
    expect(list.find(j => j.number === number), 'the job is listed').toBeTruthy()
    expect(list.every(j => !('budget_hours' in j)), 'no job in the list carries a budget for planning').toBe(true)
    await ctx.close()
  })

  test(s('S3', 'a creative director sees no control to open or change a job and the server refuses the write'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    for (const who of [PEOPLE.creativeDirector, PEOPLE.artDirector, PEOPLE.copywriter]) {
      await signIn(page, who)
      await goto(page, `job-${job.job}`)
      await expect(page.getByTestId('job-page')).toBeVisible()
      await expect(page.getByTestId('job-file')).toBeVisible()
      await expect(page.getByTestId('job-edit')).toHaveCount(0)
      expect((await page.request.patch(`${job.api}/jobs/${job.job}`, { data: { title: 'x' } })).status(), who.username).toBe(403)
      expect((await page.request.post(`${job.api}/jobs`, { data: { client_id: job.client } })).status(), who.username).toBe(403)
      const entry = (await (await page.request.get(`${job.api}/jobs/${job.job}`)).json()) as { job: Record<string, unknown> }
      expect('budget_hours' in entry.job).toBe(false)
    }
    await ctx.close()
  })
}
