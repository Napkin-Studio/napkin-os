// Phase 2 acceptance, record `needs-you-full` (features/needs-you-full.clan) as the one Needs you
// (features/align-needs-lock-people.clan): tests 23 to 25 of docs/design/phase2-acceptance.md, run at 390 and 1440 px on the roster
// stack, the real shell and the real server. No model and no paid provider.
//
//   23  The desk's Me rows are the documents that hold an item for me, soonest due first: five and then Show all, an empty list names
//       the next deadline.
//   24  A notice is set aside with five seconds to undo: Undo brings it back; after five seconds it stays gone, after a reload and in
//       another browser, Bring back is in the drawer's set-aside list, and nobody else's list changes.
//   25  Each live row of the v2 alerts table lands with the named people only, as a notice on the document it concerns. An event is
//       caused through the documents' own writes (an edit after the lock, the client's answer) or the stack's test clock (a late
//       approval, a deadline), never a test-only route.
//
// The presses are real; the five seconds are real too (a 5.5 second wait).

import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { open, SIZES, signIn, signOff } from './pilot'
import { factsOf, noticesOf, openMe, openMeAll } from './needs'
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

    await openMe(page)
    const rows = page.getByTestId('me-row')
    // Soonest deadline first, five and then Show all.
    await expect(rows).toHaveCount(5)
    expect(await rows.first().getAttribute('data-due'), 'the job with the sooner deadline is first').toBe(sooner)
    const all = page.getByTestId('me-show-all')
    await expect(all).toHaveText(/^Show all \d+$/)
    const n = Number((await all.textContent())!.replace(/\D/g, ''))
    expect(n).toBeGreaterThanOrEqual(7)
    if (shots) await page.screenshot({ path: `${shots}/needs-you-five-${size.tag}.png`, fullPage: true })
    await all.click()
    await expect(rows).toHaveCount(n)
    const due = await rows.evaluateAll(els => els.map(e => e.getAttribute('data-due') ?? ''))
    const dated = due.filter(d => d !== '')
    expect(dated).toEqual([...dated].sort())
    expect(due.lastIndexOf(''), 'a job with no deadline is last').toBe(due.length - 1)
    expect(due.indexOf(''), 'and only after every dated one').toBeGreaterThan(dated.length - 1)
    // One line each: the document, its client and how many items wait on me.
    await expect(rows.first()).toContainText('for you')

    // Only this person's items: a document that holds an item for the planner holds none for another person.
    const ours = new Set(jobs.map(j => j.brief.path))
    const mine = (await factsOf(page, jobs[0].api)).documents.filter(d => ours.has(d.path) && d.mine > 0)
    expect(mine.length).toBeGreaterThanOrEqual(7)
    for (const who of [PEOPLE.planningAndCreative, PEOPLE.copywriter, PEOPLE.management]) {
      await signIn(page, who)
      const theirs = (await factsOf(page, jobs[0].api)).documents.filter(d => ours.has(d.path) && d.mine > 0)
      expect(theirs, `${who.username} has no item of the planner's`).toEqual([])
    }

    // An empty list names the next deadline on the person's own jobs: a person with nothing waiting who has written in a job.
    await signIn(page, PEOPLE.needsQuiet)
    const wrote = await page.request.post(`/s/${(await asMe(page, jobs[0].api, jobs[0].research)).token}/patch-data`, { data: { patch: { topic: 'A note.' }, agent: 'human', action: 'note on the research' } })
    expect(wrote.status(), await wrote.text()).toBe(200)
    await openMe(page)
    await expect(page.getByTestId('needs-empty')).toHaveText(/^Nothing needs you now\. Next deadline: J\d+, Client A\d*, 18 Dec\.$/)
    if (shots) await page.screenshot({ path: `${shots}/needs-you-empty-${size.tag}.png`, fullPage: true })
    // The first row opens its document.
    await signIn(page, PEOPLE.planning)
    await openMe(page)
    await rows.first().click()
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
    const path = job.brief.path
    const changed = (p: typeof page) => noticesOf(p, job.api, job.brief, ['brief-changed'])
    const marks = async (p: typeof page) => (await factsOf(p, job.api)).aside[path] ?? []

    // The planner has the notice on the brief; it is a row of the document's own list, in the drawer's Notices.
    await signIn(page, PEOPLE.planning)
    expect(await changed(page)).toHaveLength(1)
    await openMeAll(page)
    const row = page.getByTestId('me-row').filter({ hasText: job.clientName })
    await expect(row).toHaveCount(1)
    await row.click()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('decisions').click()
    const drawer = page.getByTestId('decisions-drawer')
    const notices = drawer.getByTestId('notices-list')
    const notice = () => drawer.getByTestId('call-row').filter({ hasText: 'Worth a look' })
    await expect(notices).toBeVisible()
    await expect(notice()).toHaveCount(1)

    // Set aside: the row leaves the notices at once and says Undo; Undo inside five seconds puts it back, and the mark is gone.
    await notice().getByTestId('set-aside').click()
    await expect(notices).toHaveCount(0)
    await expect(drawer.getByTestId('aside-undo')).toBeVisible()
    if (shots) await page.screenshot({ path: `${shots}/needs-you-set-aside-undo-${size.tag}.png`, fullPage: true })
    await expect.poll(() => marks(page)).toHaveLength(1)
    await drawer.getByTestId('aside-undo').getByRole('button', { name: 'Undo' }).click()
    await expect(notices).toBeVisible()
    await expect.poll(() => marks(page)).toHaveLength(0)

    // Set aside again and left alone: after five seconds Undo is gone, the notice stays gone, and so after a reload.
    await notice().getByTestId('set-aside').click()
    await expect(drawer.getByTestId('aside-undo')).toBeVisible()
    await page.waitForTimeout(5500)
    await expect(drawer.getByTestId('aside-undo')).toHaveCount(0)
    await expect(notices).toHaveCount(0)
    await page.reload()
    await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('decisions').click()
    await expect(notices).toHaveCount(0)
    expect(await marks(page)).toHaveLength(1)
    // It is in the drawer's set-aside list, and Bring back puts it where it was.
    const list = drawer.getByTestId('set-aside-list')
    await expect(list).toBeVisible()
    if (shots) await page.screenshot({ path: `${shots}/needs-you-set-aside-list-${size.tag}.png`, fullPage: true })
    await drawer.getByTestId('bring-back').first().click()
    await expect(notices).toBeVisible()
    await expect.poll(() => marks(page)).toHaveLength(0)

    // Set aside once more: another browser of the same person has it gone too; nobody else's list changes.
    await notice().getByTestId('set-aside').click()
    await expect.poll(() => marks(page)).toHaveLength(1)
    const other = await open(browser, size, 'white', { roster: true })
    await signIn(other.page, PEOPLE.planning)
    expect(await marks(other.page)).toHaveLength(1)
    expect(await changed(other.page), 'the notice itself is still there for the planner; only the mark is theirs').toHaveLength(1)
    await other.ctx.close()
    await signIn(page, PEOPLE.creativeDirector)
    expect(await marks(page), 'the planner\'s mark is not the creative director\'s').toHaveLength(0)
    expect(await changed(page)).toHaveLength(1)
    // The old Done routes and the item list are gone, and the index takes no write.
    expect((await page.request.post(`${job.api}/needs/anything/done`)).status()).toBe(404)
    expect((await page.request.post(`${job.api}/needs`, { data: {} })).status()).toBe(405)
    // A set-aside that is not a document of this workspace is refused.
    expect((await page.request.post(`${job.api}/needs/k1/aside?path=..%2F..%2Fetc%2Fpasswd`)).status()).toBe(404)
    await ctx.close()
  })

  test(t(25), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    // One fresh job per event, so a notice of one event is never mistaken for another's.
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
        return (await noticesOf(page, job.api, job.brief, kinds)).map(n => n.code.slice(7))
      }
      for (const [who, kind] of lands) expect(await kindsFor(who as keyof typeof PEOPLE), `${event} lands with ${who}`).toContain(kind)
      for (const who of not) expect(await kindsFor(who as keyof typeof PEOPLE), `${event} is not for ${who}`).toEqual([])
      resetClock()
    }
    // The desk carries it: the planner's Me row for the job's brief counts the overdue approval, and the notice says how late.
    const job = await aJob()
    await cause('approval-two-days-late', job)
    await signIn(page, PEOPLE.planning)
    const late = (await noticesOf(page, job.api, job.brief, ['approval']))[0]
    expect(late?.text).toContain('2 days late')
    expect(late.for).toEqual({ person: PEOPLE.planning.username })
    await openMeAll(page)
    const row = page.getByTestId('me-row').filter({ hasText: job.clientName })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Due')
    await ctx.close()
  })
}
