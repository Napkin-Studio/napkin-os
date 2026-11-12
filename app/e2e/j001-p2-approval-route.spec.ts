// Phase 2 acceptance, record `approval-route` (features/j001-phase2-suite.clan): tests 33 to 35 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(approval-route) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { chainOf, open, SIZES, signIn } from './pilot'
import { asMe, lockBrief, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { ROUTE } from './seed/j001/p2/approval-route.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Need = { id: string; kind: string; stage?: string; days_late?: number; due?: string }

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(33), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    // The route is set through the host (os-layer 13): PUT /jobs/{number}/route, by account service and nobody else.
    const put = await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { steps: ROUTE } })
    expect(put.status()).toBe(200)
    await signIn(page, PEOPLE.planning)
    expect((await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { steps: ROUTE } })).status()).toBe(403)
    // The job shows who holds it and for how long.
    const entry = (await (await page.request.get(`${job.api}/jobs/${job.job}`)).json()) as { holder: { person: string; stage: string; days: number; due: string } }
    expect(entry.holder.person).toBe('dara@wk')
    expect(entry.holder.due).toBe(ROUTE[0].due)
    await page.goto(`/#job-${job.job}`); await page.reload() // ADJUST(approval-route): the job page's route strip
    await expect(page.getByTestId('route-strip')).toContainText('Dara Test') // ADJUST(approval-route)
    await ctx.close()
  })

  test.fixme(t(34), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { steps: ROUTE } })
    // The stack's test clock is moved two days past the brief check's due date. ADJUST(approval-route): the clock's address.
    const clock = await page.request.post(`${job.api}/test-clock`, { data: { now: '2026-11-22T09:00:00Z' } })
    expect(clock.status()).toBe(200)
    const needs = async (who: { username: string }) => { await signIn(page, who); return (await (await page.request.get(`${job.api}/needs`)).json()) as Need[] }
    const approver = (await needs(PEOPLE.creativeDirector)).find(n => n.kind === 'approval')
    expect(approver?.days_late).toBe(2) // the approver's Needs you
    expect(approver?.due).toBe(ROUTE[0].due)
    await signIn(page, PEOPLE.management)
    const dash = (await (await page.request.get(`${job.api}/dashboard`)).json()) as { at_risk: { job: string; line: string }[] }
    expect(dash.at_risk.find(a => a.job === job.job)?.line).toMatch(/2 days late/) // the dashboard
    expect((await needs(PEOPLE.accountService)).some(n => n.kind === 'approval-chase')).toBe(true) // then account service's
    expect((await needs(PEOPLE.copywriter)).some(n => n.kind === 'approval')).toBe(false)
    await signIn(page, PEOPLE.creativeDirector)
    await page.goto('/'); await page.reload()
    await expect(page.getByTestId('need').filter({ hasText: '2 days late' })).toBeVisible() // ADJUST(approval-route)
    await ctx.close()
  })

  test.fixme(t(35), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.accountService)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { steps: ROUTE } })
    await signIn(page, PEOPLE.planning)
    await signBrief(page, job.brief)
    await signIn(page, PEOPLE.creativeDirector)
    expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
    // The approval is withdrawn (the Brief gate's unlock): the stage returns to its holder, the earlier approval stays in the history.
    const unlock = await page.request.post(`/s/${(await asMe(page, job.api, job.brief)).token}/unlock`, { data: { rationale: 'Withdrawn.' } }) // ADJUST(approval-route): the withdraw action's route
    expect(unlock.status()).toBe(200)
    const entry = (await (await page.request.get(`${job.api}/jobs/${job.job}`)).json()) as { holder: { person: string } }
    expect(entry.holder.person).toBe('dara@wk')
    const chain = await chainOf(page, job.brief.token)
    expect(chain.filter(d => d.kind === 'approve')).toHaveLength(1) // the earlier approval is still there
    await ctx.close()
  })
}
