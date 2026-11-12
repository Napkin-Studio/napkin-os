// Phase 2 acceptance, record `approval-route` (features/approval-route.clan): tests 33 to 35 of docs/design/phase2-acceptance.md,
// run at 390 and 1440 px on the real shell and the real server, plus the Approvals door's own facts (the page opens, axe in three
// modes, 44 px buttons on a phone, no em dash). Titles read `N short, W px`, the form the registry (phase2/tests.mjs) and counter read.
//
// The clock is the stack's test clock: stack.mjs gives the roster server NAPKIN_TEST_CLOCK_FILE and a test moves "today" by writing
// a time to it; it is put back after every test. No model and no paid provider.

import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { MODES, open, SIZES, signIn } from './pilot'
import { asMe, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

const rosterPort = process.env.NAPKIN_E2E_ROSTER_PORT || '18082'
/** Where the stack's test clock lives (stack.mjs writes the same path into the roster server's environment). */
const clockFile = join(tmpdir(), `napkin-e2e-clock-${rosterPort}`)
const setClock = (iso: string) => writeFileSync(clockFile, iso)
const resetClock = () => rmSync(clockFile, { force: true })

/** A date `n` days from today, as the server counts them (UTC). */
const inDays = (n: number, from = new Date()): string => new Date(from.getTime() + n * 86_400_000).toISOString().slice(0, 10)
const noon = (date: string): string => `${date}T12:00:00Z`

type Step = { stage: string; party: 'agency' | 'client'; role?: string; approver: string; contact?: string; due: string; rounds?: number }
type Job = Awaited<ReturnType<typeof seedJ001>>
type Entry = {
  number: string
  route: { stage: string; state: string; approver: string; approved_by: string | null; version: string | null; days_late: number | null }[]
  holder: { person: string; role: string | null; stage: string; days: number; due: string; days_late: number } | null
}
type NeedItem = { job: string; kind?: string; stage?: string; days_late?: number | null; due: string | null; action: string }

const putRoute = (page: Page, job: Job, route: Step[]) => page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { route } })
const entryOf = async (page: Page, job: Job) => (await (await page.request.get(`${job.api}/jobs/${job.job}`)).json()) as Entry
const needsOf = async (page: Page, job: Job) => ((await (await page.request.get(`${job.api}/needs`)).json()) as { items: NeedItem[] }).items.filter(n => n.job === job.job)

/** A planner's fresh job in the agency's workspace: the planner opens it, then the one who acts next signs in. */
async function aJob(page: Page, ready = false): Promise<Job> {
  await signIn(page, PEOPLE.planning)
  return seedJ001(page, { ready, fresh: true })
}

const section = (page: Page, job: Job) => page.locator(`[data-testid="approval-job"][data-job="${job.job}"]`)

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.afterEach(() => resetClock())

  test(t(33), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    const job = await aJob(page)
    const [planner, director, client] = [inDays(1), inDays(2), inDays(6)]

    // Account service opens the Approvals door and names the route on the page.
    await signIn(page, PEOPLE.accountService)
    await page.goto('/')
    await page.getByTestId('door').filter({ hasText: 'Approvals' }).click()
    await expect(page.getByTestId('approvals')).toBeVisible()
    const mine = section(page, job)
    await expect(mine.getByTestId('holder')).toContainText('No route yet')
    await mine.getByTestId('route-edit').click()
    const rows = mine.getByTestId('route-row')
    await rows.nth(0).getByLabel('Role').fill('planner')
    await rows.nth(0).getByLabel('Approver sign-in').fill(PEOPLE.planning.username)
    await rows.nth(0).getByLabel('Due').fill(planner)
    await mine.getByTestId('route-add').click()
    await rows.nth(1).getByLabel('Role').fill('creative_director')
    await rows.nth(1).getByLabel('Approver sign-in').fill(PEOPLE.creativeDirector.username)
    await rows.nth(1).getByLabel('Due').fill(director)
    await mine.getByTestId('route-add').click()
    await rows.nth(2).getByLabel('Stage').selectOption('client-approval')
    await rows.nth(2).getByLabel('Who approves').selectOption('client')
    await rows.nth(2).getByLabel('Role').fill('client')
    await rows.nth(2).getByLabel('Approver name').fill('Client A contact')
    await rows.nth(2).getByLabel('Client email').fill('contact@client-a.example')
    await rows.nth(2).getByLabel('Rounds of changes').fill('2')
    await rows.nth(2).getByLabel('Due').fill(client)
    const save = mine.getByTestId('route-save')
    if (size.width <= 560) expect((await save.boundingBox())!.height, 'a primary button on a phone').toBeGreaterThanOrEqual(44)
    await save.click()

    // The job now shows who holds it and for how long, and the route as a strip of three steps.
    await expect(mine.getByTestId('route-step')).toHaveCount(3)
    await expect(mine.getByTestId('holder')).toContainText(`Waiting on ${PEOPLE.planning.username}, planner, for 0 days. Due`)
    await expect(mine.getByTestId('route-step').nth(0)).toHaveAttribute('data-state', 'waiting')
    await expect(mine.getByTestId('route-step').nth(1)).toHaveAttribute('data-state', 'not_started')
    await expect(mine.getByTestId('route-step').nth(2)).toContainText('Client approval')

    // The same facts are in the job index, and the route is the host's: the steps, the holder, the client's contact kept.
    const entry = await entryOf(page, job)
    expect(entry.route.map(s => [s.stage, s.state])).toEqual([['brief-check', 'waiting'], ['brief-check', 'not_started'], ['client-approval', 'not_started']])
    expect(entry.holder).toMatchObject({ person: PEOPLE.planning.username, role: 'planner', stage: 'brief-check', days: 0, due: planner })
    const briefAsCian = await asMe(page, job.api, job.brief)
    const gate = (await (await page.request.get(`/s/${briefAsCian.token}/gate`)).json()) as { signers: { role: string; person: string }[] }
    expect(gate.signers, "the brief names the route's two signers").toEqual([
      { role: 'planner', person: PEOPLE.planning.username, signed: false },
      { role: 'creative_director', person: PEOPLE.creativeDirector.username, signed: false },
    ])

    // Nobody else can name it: a planner gets 403, and the route stays as it was.
    await signIn(page, PEOPLE.planning)
    expect((await putRoute(page, job, [])).status()).toBe(403)
    expect((await entryOf(page, job)).route).toHaveLength(3)
    // A wrong step is refused with a sentence, and nothing is written.
    await signIn(page, PEOPLE.accountService)
    const bad = await putRoute(page, job, [{ stage: 'brief-check', party: 'agency', approver: 'dara@wk', due: '14 Nov' }])
    expect(bad.status()).toBe(400)
    expect((await entryOf(page, job)).route).toHaveLength(3)
    await ctx.close()
  })

  test(t(34), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    const job = await aJob(page)
    const due = inDays(1)
    await signIn(page, PEOPLE.accountService)
    expect((await putRoute(page, job, [{ stage: 'decks', party: 'agency', role: 'creative_director', approver: PEOPLE.creativeDirector.username, due }])).status()).toBe(200)

    // A day before it is due the approver already has it: no timer made it, the clock did.
    await signIn(page, PEOPLE.creativeDirector)
    expect((await needsOf(page, job)).map(n => [n.kind, n.days_late])).toEqual([['approval', 0]])

    // Two days past the due date.
    setClock(noon(inDays(2, new Date(`${due}T00:00:00Z`))))
    // Needs you shows five lines before Show all, and earlier tests leave routes in this agency's workspace, so a row is
    // looked for behind Show all, once the list has loaded.
    const rowsFor = async (p: Page, count: number, text?: string) => {
      await expect(p.getByTestId('need').first()).toBeVisible()
      await expect(async () => {
        const more = p.getByTestId('needs-show-all')
        if (await more.count()) await more.click()
        const rows = p.getByTestId('need').filter({ hasText: job.job })
        await expect(rows).toHaveCount(count, { timeout: 1500 })
        if (text) for (const t of text.split('|')) await expect(rows).toContainText(t, { timeout: 1500 })
      }).toPass({ timeout: 20_000 })
    }

    // The approver: one item, kind approval, 2 days late, the step's own due date. On the screen too.
    const items = await needsOf(page, job)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'approval', stage: 'decks', days_late: 2, due })
    await page.goto('/')
    await rowsFor(page, 1, '2 days late')

    // Someone else on the job does not have it.
    await signIn(page, PEOPLE.planning)
    expect((await needsOf(page, job)).filter(n => n.kind?.startsWith('approval'))).toEqual([])
    await page.goto('/')
    await rowsFor(page, 1) // the planner's own gate item for the brief, and no approval row
    await expect(page.getByTestId('need').filter({ hasText: job.job }).filter({ hasText: 'days late' })).toHaveCount(0)

    // The dashboard: the At risk tile names the job, the stage and 2 days late.
    await signIn(page, PEOPLE.management)
    const risk = (await (await page.request.get(`${job.api}/dashboard`)).json()) as { at_risk: { number: string; line: string }[] }
    expect(risk.at_risk.find(l => l.number === job.job)?.line).toContain('Decks and presentation approval is 2 days late.')
    await page.goto('/#door-agency-dashboard')
    const tile = page.getByTestId('tile-risk')
    await expect(tile).toBeVisible()
    await expect(tile.locator(`li[data-job="${job.job}"]`)).toContainText('2 days late')

    // Then account service's: one day late only the approver had it; at two days the person who set the route does too.
    await signIn(page, PEOPLE.accountService)
    expect((await needsOf(page, job)).map(n => [n.kind, n.days_late])).toEqual([['approval-chase', 2]])
    await page.goto('/')
    await rowsFor(page, 1, '2 days late|Chase the approval')
    setClock(noon(inDays(1, new Date(`${due}T00:00:00Z`))))
    expect(await needsOf(page, job)).toEqual([])
    await ctx.close()
  })

  test(t(35), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    const job = await aJob(page, true)
    const [planner, director] = [inDays(1), inDays(2)]
    await signIn(page, PEOPLE.accountService)
    expect((await putRoute(page, job, [
      { stage: 'brief-check', party: 'agency', role: 'planner', approver: PEOPLE.planning.username, due: planner },
      { stage: 'brief-check', party: 'agency', role: 'creative_director', approver: PEOPLE.creativeDirector.username, due: director },
    ])).status()).toBe(200)

    // The planner signs, the creative director locks: both steps are approved, from the decisions.
    await signIn(page, PEOPLE.planning)
    expect((await signBrief(page, job.brief)).status()).toBe(200)
    await signIn(page, PEOPLE.creativeDirector)
    const mineAsDara = await asMe(page, job.api, job.brief)
    expect((await lockBrief(page, mineAsDara)).status()).toBe(200)
    await signIn(page, PEOPLE.accountService)
    await page.goto('/#door-approvals')
    const mine = section(page, job)
    await expect(mine.getByTestId('route-step').nth(1)).toHaveAttribute('data-state', 'approved')
    await expect(mine.getByTestId('route-step').nth(1)).toContainText(`Approved by ${PEOPLE.creativeDirector.username}`)
    await expect(mine.getByTestId('holder')).toContainText('Every step is approved.')
    const locked = await entryOf(page, job)
    const lockVersion = locked.route[1].version
    expect(lockVersion, 'the version is read from the approve decision').toBeTruthy()
    expect(locked.route[1].approved_by).toBe(PEOPLE.creativeDirector.username)

    // The creative director withdraws the approval (unlock).
    await signIn(page, PEOPLE.creativeDirector)
    const reopened = await page.request.post(`/s/${mineAsDara.token}/unapprove`, { data: { rationale: 'Reopened to change the proposition.' } })
    expect(reopened.status(), await reopened.text()).toBe(200)

    // The stage is back with its holder; the planner's signature, which still holds, is untouched.
    await signIn(page, PEOPLE.accountService)
    await page.goto('/#door-approvals')
    await expect(mine.getByTestId('route-step').nth(1)).toHaveAttribute('data-state', 'waiting')
    await expect(mine.getByTestId('route-step').nth(0)).toHaveAttribute('data-state', 'approved')
    await expect(mine.getByTestId('holder')).toContainText(`Waiting on ${PEOPLE.creativeDirector.username}, creative director`)
    const back = await entryOf(page, job)
    expect(back.holder).toMatchObject({ person: PEOPLE.creativeDirector.username, stage: 'brief-check' })
    expect(back.route[1]).toMatchObject({ state: 'waiting', approved_by: null })

    // The earlier approval stays in the history: the approve is still in the chain, with the unlock above it.
    await signIn(page, PEOPLE.creativeDirector)
    const chain = ((await (await page.request.get(`/s/${mineAsDara.token}/chain`)).json()) as { decisions: { kind?: string; actor?: string; version?: string; action?: string; superseded_by?: string }[] }).decisions
    const approve = chain.findIndex(d => d.kind === 'approve')
    const unlock = chain.findIndex(d => d.kind === 'unlock')
    expect(approve, 'the approve decision is still there').toBeGreaterThanOrEqual(0)
    expect(unlock, 'newest first: the unlock is above the approve it ends').toBeGreaterThanOrEqual(0)
    expect(unlock).toBeLessThan(approve)
    expect(chain[approve].version).toBe(lockVersion)
    expect(chain[approve].superseded_by).toBeUndefined()
    await ctx.close()
  })

  // The Approvals door itself: live for account service, with no serious axe finding in the three modes, 44 px primary
  // buttons on a phone, and no em dash in what it says. Not a numbered test of the list.
  test(`the Approvals door opens a real page; axe, 44 px buttons and no em dash, ${size.tag} px`, async ({ browser }) => {
    test.setTimeout(240_000) // three modes, each seeding a job and scanning two states
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    const problems: string[] = []
    for (const mode of MODES) {
      const { ctx, page } = await open(browser, size, mode, { roster: true })
      const job = await aJob(page)
      await signIn(page, PEOPLE.accountService)
      expect((await putRoute(page, job, [
        { stage: 'brief-check', party: 'agency', role: 'planner', approver: PEOPLE.planning.username, due: inDays(-1) },
        { stage: 'brief-check', party: 'agency', role: 'creative_director', approver: PEOPLE.creativeDirector.username, due: inDays(2) },
        { stage: 'client-approval', party: 'client', role: 'client', approver: 'Client A contact', contact: 'contact@client-a.example', due: inDays(6), rounds: 2 },
      ])).status()).toBe(200)
      await page.goto('/')
      const door = page.getByTestId('door').filter({ hasText: 'Approvals' })
      await expect(door).toHaveAttribute('data-live', 'true')
      await door.click()
      const mine = section(page, job)
      await expect(mine.getByTestId('route-step')).toHaveCount(3)
      await expect(mine.getByTestId('holder')).toContainText('1 day late')
      const scan = async (what: string) => {
        const found = await new AxeBuilder({ page }).include('[data-testid="door-page"]').analyze()
        for (const v of found.violations.filter(x => x.impact === 'serious' || x.impact === 'critical')) problems.push(`${mode}, ${what}: ${v.id} (${v.nodes.length})`)
      }
      await scan('the page')
      await page.getByTestId('door-page').screenshot({ path: join(process.env.NAPKIN_SHOTS || tmpdir(), `approval-route-${mode}-${size.tag}.png`) })
      expect(await page.getByTestId('door-page').innerText(), `no em dash in ${mode}`).not.toContain('—')
      await mine.getByTestId('route-edit').click()
      await expect(mine.getByTestId('route-editor')).toBeVisible()
      await scan('the editor')
      expect(await page.getByTestId('door-page').innerText()).not.toContain('—')
      if (size.width <= 560) {
        const buttons = page.locator('[data-testid="door-page"] .ch-btn-primary, [data-testid="door-page"] .ap-primary')
        for (let i = 0; i < await buttons.count(); i++) {
          const box = await buttons.nth(i).boundingBox()
          if (box) expect(box.height, `a primary button in ${mode}`).toBeGreaterThanOrEqual(44)
        }
      }
      // The page only, below the bar: the sample agency's name is a real one and does not go in a screenshot.
      await page.getByTestId('door-page').screenshot({ path: join(process.env.NAPKIN_SHOTS || tmpdir(), `approval-route-editor-${mode}-${size.tag}.png`) })
      await ctx.close()
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
}
