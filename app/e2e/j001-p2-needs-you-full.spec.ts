// Phase 2 acceptance, record `needs-you-full` (features/needs-you-full.clan): tests 23 to 25 of docs/design/phase2-acceptance.md, run at
// 390 and 1440 px on the roster stack, the real shell and the real server. No model and no paid provider.
//
//   23  Needs you shows only my items, soonest first: five and then Show all, an empty list names the next deadline.
//   24  A done item leaves with five seconds to undo: Undo brings it back; after five seconds it stays gone, after a reload and in
//       another browser, and nobody else's list changes.
//   25  Each live row of the v2 alerts table lands with the named people only. An event is caused through the documents' own writes
//       (an edit after the lock, the client's answer) or the stack's test clock (a late approval, a deadline), never a test-only route.
//
// The Done and Undo presses are real; the five seconds are real too (a 5.5 second wait), because the live read the page keeps runs on its own timers.

import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { chainOf, open, SIZES, signIn, signOff } from './pilot'
import { asMe, PEOPLE, seedJ001 } from './seed/j001'
import { ALERTS } from './seed/j001/p2/needs-you-full.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

const rosterPort = process.env.NAPKIN_E2E_ROSTER_PORT || '18082'
/** Where the stack's test clock lives (stack.mjs writes the same path into the roster server's environment). */
const clockFile = join(tmpdir(), `napkin-e2e-clock-${rosterPort}`)
const setClock = (iso: string) => writeFileSync(clockFile, iso)
const resetClock = () => rmSync(clockFile, { force: true })
const inDays = (n: number, from = new Date()): string => new Date(from.getTime() + n * 86_400_000).toISOString().slice(0, 10)
const noon = (date: string): string => `${date}T12:00:00Z`

const shots = process.env.NAPKIN_E2E_SHOTS

type Job = Awaited<ReturnType<typeof seedJ001>>
type Need = { id: string; kind: string; job: string; text: string; due: string | null; can_done: boolean }
/** The signed-in person's own list, as the server answers it (`GET /needs`). */
const needsOf = async (page: Page, api: string) => ((await (await page.request.get(`${api}/needs`)).json()) as { items: Need[] }).items

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.afterEach(() => resetClock())

  test(t(23), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    // Seven jobs, each asking the planner to sign its brief. One has a sooner deadline and one has none.
    const jobs: Job[] = []
    for (let i = 0; i < 7; i++) jobs.push(await seedJ001(page, { ready: true, fresh: true }))
    const patch = (j: Job, due: string | null) => page.request.patch(`${j.api}/jobs/${j.job}`, { data: { due } })
    // each width has its own sooner date, earlier than any other test's (the stack is shared), so the job is first by date, not by luck
    const sooner = size.width < 500 ? '2026-11-05' : '2026-11-04'
    expect((await patch(jobs[3], sooner)).status()).toBe(200)
    expect((await patch(jobs[5], null)).status()).toBe(200)

    await page.goto('/')
    await page.reload()
    const items = page.getByTestId('need')
    // Soonest deadline first, five and then Show all.
    await expect(items).toHaveCount(5)
    const first = await items.first().getAttribute('data-due')
    expect(first, 'the job with the sooner deadline is first').toBe(sooner)
    const all = page.getByTestId('needs-show-all')
    await expect(all).toHaveText(/^Show all \d+$/)
    const n = Number((await all.textContent())!.replace(/\D/g, ''))
    expect(n).toBeGreaterThanOrEqual(7)
    if (shots) await page.screenshot({ path: `${shots}/needs-you-five-${size.tag}.png`, fullPage: true })
    await all.click()
    await expect(items).toHaveCount(n)
    const due = await items.evaluateAll(els => els.map(e => e.getAttribute('data-due') ?? ''))
    const dated = due.filter(d => d !== '')
    expect(dated).toEqual([...dated].sort())
    expect(due.lastIndexOf(''), 'a job with no deadline is last').toBe(due.length - 1)
    expect(due.indexOf(''), 'and only after every dated one').toBeGreaterThan(dated.length - 1)
    // One line each, its next action a button that opens the document.
    await expect(items.first().locator('.btn-rect')).toHaveText('Sign the brief')

    // Only this person's items: what is addressed to the planner is not on another person's list.
    // (A role's item on a job with nobody of that role, a brief with no named planner, reaches every planner by design: so only this
    // test's jobs, whose briefs name the planner, are compared.)
    const ours = (l: Need[]) => l.filter(x => jobs.some(j => j.job === x.job))
    const mine = ours(await needsOf(page, jobs[0].api))
    expect(mine.length).toBeGreaterThanOrEqual(7)
    for (const who of [PEOPLE.planningAndCreative, PEOPLE.copywriter, PEOPLE.management]) {
      await signIn(page, who)
      const theirs = ours(await needsOf(page, jobs[0].api))
      expect(theirs.filter(x => mine.some(m => m.id === x.id)), `${who.username} has none of the planner's items`).toEqual([])
    }

    // An empty list names the next deadline on the person's own jobs: a person with nothing waiting who has written in a job.
    await signIn(page, PEOPLE.needsQuiet)
    const wrote = await page.request.post(`/s/${(await asMe(page, jobs[0].api, jobs[0].research)).token}/patch-data`, { data: { patch: { topic: 'A note.' }, agent: 'human', action: 'note on the research' } })
    expect(wrote.status(), await wrote.text()).toBe(200)
    await page.goto('/')
    await page.reload()
    await expect(page.getByTestId('needs-empty')).toHaveText(/^Nothing needs you now\. Next deadline: J\d+, Client A\d*, 18 Dec\.$/)
    if (shots) await page.screenshot({ path: `${shots}/needs-you-empty-${size.tag}.png`, fullPage: true })
    // The first row opens its document.
    await signIn(page, PEOPLE.planning)
    await page.goto('/')
    await page.reload()
    await items.first().locator('.btn-rect').click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await ctx.close()
  })

  test(t(24), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signOff(page, job) // leaves the creative director signed in
    const edit = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A new line.' }, agent: 'human', action: 'edit the proposition' } })
    expect(edit.status()).toBe(200)

    await page.goto('/')
    await page.reload()
    // five rows show, and this person's list holds more than five by now: Show all when it is offered
    const reveal = async () => { const all = page.getByTestId('needs-show-all'); if (await all.isVisible()) await all.click() }
    await expect(page.getByTestId('needs-you')).toBeVisible()
    await reveal()
    const row = () => page.locator('[data-testid="need"][data-kind="brief-changed"]').filter({ hasText: `${job.job}, ${job.clientName}` })
    await expect(row()).toHaveCount(1)
    const id = (await row().getAttribute('data-id'))!
    expect(id).toMatch(/^J\d+:brief-check:everyone:brief-changed:/)
    const mine = (p: Page) => needsOf(p, job.api).then(l => l.filter(x => x.id === id).length)
    // The work to do (sign the changed brief) has no Done; the notice has one.
    const task = page.locator('[data-testid="need"][data-kind="gate"]').filter({ hasText: `${job.job}, ${job.clientName}` })
    await expect(task).toHaveCount(1)
    await expect(task.getByRole('button', { name: /^Done/ })).toHaveCount(0)
    const done = row().getByRole('button', { name: /^Done:/ })
    await expect(done).toBeVisible()
    if (size.width < 500) expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    // Done replaces the row in place with Done and Undo; the server has the mark at once.
    await done.click()
    const held = page.locator(`[data-testid="need-done"][data-done-id="${id}"]`)
    await expect(held).toBeVisible()
    await expect(held).toContainText('Done')
    await expect(row()).toHaveCount(0)
    if (shots) await page.screenshot({ path: `${shots}/needs-you-done-undo-${size.tag}.png`, fullPage: true })
    await expect.poll(() => mine(page)).toBe(0)
    // Undo inside five seconds puts the row back, and the mark is gone.
    await held.getByRole('button', { name: 'Undo' }).click()
    await expect(row()).toHaveCount(1)
    await expect(held).toHaveCount(0)
    await expect.poll(() => mine(page)).toBe(1)

    // Done again and left alone: after five seconds the row is gone, and stays gone after a reload.
    await row().getByRole('button', { name: /^Done:/ }).click()
    await expect(held).toBeVisible()
    await page.waitForTimeout(5500)
    await expect(held).toHaveCount(0)
    await expect(row()).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('needs-you')).toBeVisible()
    await reveal()
    await expect(row()).toHaveCount(0)
    expect(await mine(page)).toBe(0)
    // Another browser of the same person has it gone too.
    const other = await open(browser, size, 'white', { roster: true })
    await signIn(other.page, PEOPLE.creativeDirector)
    await other.page.goto('/')
    await expect(other.page.getByTestId('needs-you')).toBeVisible()
    const otherAll = other.page.getByTestId('needs-show-all')
    if (await otherAll.isVisible()) await otherAll.click()
    await expect(other.page.locator('[data-testid="need"][data-kind="brief-changed"]').filter({ hasText: `${job.job}, ${job.clientName}` })).toHaveCount(0)
    await other.ctx.close()
    // Private: the planner, who has the same notice, still has it, and the creative director's mark is nobody else's to see.
    await signIn(page, PEOPLE.planning)
    expect(await mine(page)).toBe(1)
    expect((await page.request.post(`${job.api}/needs/${encodeURIComponent(id)}/done`)).status()).toBe(200)
    await signIn(page, PEOPLE.creativeDirector)
    expect(await mine(page), 'the planner pressing Done did not touch the creative director\'s list').toBe(0)
    // A task refuses Done at the server too.
    const gate = (await needsOf(page, job.api)).find(x => x.kind === 'gate')
    expect(gate, 'the creative director has a task to sign').toBeTruthy()
    expect((await page.request.post(`${job.api}/needs/${encodeURIComponent(gate!.id)}/done`)).status()).toBe(409)
    // The index takes no write.
    expect((await page.request.post(`${job.api}/needs`, { data: {} })).status()).toBe(405)
    expect((await chainOf(page, job.brief.token)).length).toBeGreaterThan(0)
    await ctx.close()
  })

  test(t(25), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    // One fresh job per event, so a need of one event is never mistaken for another's.
    const aJob = async (): Promise<Job> => { await signIn(page, PEOPLE.planning); return seedJ001(page, { ready: true, fresh: true }) }
    const cause = async (c: string, job: Job) => {
      if (c === 'edit-after-lock') {
        await signOff(page, job)
        const r = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A new line.' }, agent: 'human', action: 'edit the proposition' } })
        expect(r.status()).toBe(200)
      } else if (c === 'client-asks-changes') {
        await signOff(page, job)
        const r = await page.request.post(`/s/${job.brief.token}/client-review`, { data: { answer: 'accepted_with_changes', client: { name: 'Client A contact' }, channel: 'call', said: 'Please change the line.', parts: [] } })
        expect(r.status(), await r.text()).toBe(200)
      } else if (c === 'approval-two-days-late') {
        const due = inDays(1)
        await signIn(page, PEOPLE.accountService)
        const r = await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { route: [{ stage: 'brief-check', party: 'agency', role: 'planner', approver: PEOPLE.planning.username, due }] } })
        expect(r.status(), await r.text()).toBe(200)
        setClock(noon(inDays(3))) // two days after the date
      } else if (c === 'day-before-deadline') {
        setClock(noon('2026-12-17')) // the job's date is 18 Dec
      }
    }
    for (const { event, cause: c, kinds, lands, not } of ALERTS) {
      const job = await aJob()
      await cause(c, job)
      const kindsFor = async (who: keyof typeof PEOPLE) => {
        await signIn(page, PEOPLE[who])
        return (await needsOf(page, job.api)).filter(n => n.job === job.job && kinds.includes(n.kind)).map(n => n.kind)
      }
      for (const [who, kind] of lands) expect(await kindsFor(who as keyof typeof PEOPLE), `${event} lands with ${who}`).toContain(kind)
      for (const who of not) expect(await kindsFor(who as keyof typeof PEOPLE), `${event} is not for ${who}`).toEqual([])
      resetClock()
    }
    // The page itself carries it: the planner's list shows the overdue approval as a row with its own next action and how late.
    const job = await aJob()
    await cause('approval-two-days-late', job)
    await signIn(page, PEOPLE.planning)
    await page.goto('/')
    await page.reload()
    await expect(page.getByTestId('needs-you')).toBeVisible()
    const showAll = page.getByTestId('needs-show-all') // five rows show; the planner's list holds more by now
    if (await showAll.isVisible()) await showAll.click()
    const row = page.locator('[data-testid="need"][data-kind="approval"]').filter({ hasText: `${job.job}, ${job.clientName}` })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('2 days late')
    await expect(row.getByRole('button', { name: 'Review and approve' })).toBeVisible()
    await ctx.close()
  })
}
