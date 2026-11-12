// Phase 2 acceptance, record `client-review-full` (features/j001-phase2-suite.clan): tests 36 to 38 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(client-review-full) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test } from '@playwright/test'
import { open, rosterURL, SIZES, signIn, signOff } from './pilot'
import { asMe, PEOPLE, READY_BRIEF, seedJ001 } from './seed/j001'
import { AGENCY_ONLY, CANARY_SENTENCE, plantCanary } from './seed/j001/p2/wall.mjs'
import { CLIENT_REVIEWERS } from './seed/j001/p2/reviewers.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

/** A signed brief and a round to the two reviewers, made by account service (os-layer 7.5, client-review-full). */
async function issueRound(page: import('@playwright/test').Page, job: Awaited<ReturnType<typeof seedJ001>>) {
  await signIn(page, PEOPLE.accountService)
  const brief = await asMe(page, job.api, job.brief)
  const r = await page.request.post(`${job.api}/d/${encodeURIComponent(brief.path)}/client-link/issue-round`, { data: { reviewers: Object.values(CLIENT_REVIEWERS) } }) // ADJUST(client-review-full)
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()) as { links: { path: string; email: string }[]; round: number }
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(36), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signOff(page, job)
    const round = await issueRound(page, job)
    // The client opens one piece with no account: a context with no cookies at all.
    const phone = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } })
    const cp = await phone.newPage()
    await cp.goto(round.links[0].path)
    await expect(cp.getByTestId('piece-version')).toContainText(/Version \d+/) // ADJUST(client-review-full)
    await expect(cp.getByTestId('ai-label')).toBeVisible() // ADJUST(client-review-full)
    const approve = cp.getByRole('button', { name: 'Approve' })
    if (size.width === 390) expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await approve.click()
    await phone.close()
    // One client_review decision lands on that exact version, with the reviewer's name.
    const brief = await asMe(page, job.api, job.brief)
    const chain = ((await (await page.request.get(`/s/${brief.token}/chain`)).json()) as { decisions: { kind?: string; actor?: string; version?: string }[] }).decisions
    const answers = chain.filter(d => d.kind === 'client_review')
    expect(answers).toHaveLength(1)
    expect(answers[0].actor ?? '').toContain(CLIENT_REVIEWERS.approver.email)
    expect(answers[0].version).toBe(chain.find(d => d.kind === 'approve')!.version)
    await ctx.close()
  })

  test.fixme(t(37), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signOff(page, job)
    const round = await issueRound(page, job)
    const comments = [{ piece: 1, pin: { x: 0.4, y: 0.4 }, tag: 'preference', text: 'Warmer here.' }, { piece: 1, pin: { x: 0.42, y: 0.4 }, tag: 'preference', text: 'Cooler here.' }]
    for (const [i, c] of comments.entries()) {
      const link = round.links[i].path.replace(/^\/c\//, '')
      const phone = await browser.newContext({ baseURL: rosterURL })
      const r = await phone.request.post(`/c/${link}/comment`, { data: c }) // ADJUST(client-review-full)
      expect(r.status(), await r.text()).toBe(200)
      await phone.close()
    }
    // The agency reads one merged list with the contradiction flagged and the round number.
    await signIn(page, PEOPLE.accountService)
    const brief = await asMe(page, job.api, job.brief)
    const merged = (await (await page.request.get(`${job.api}/d/${encodeURIComponent(brief.path)}/client-review/round`)).json()) as { round: number; comments: { text: string; flags: string[] }[] }
    expect(merged.comments).toHaveLength(2)
    expect(merged.comments.every(c => c.flags.includes('same spot'))).toBe(true)
    expect(merged.round).toBe(1)
    await page.goto(`/#job-${job.job}`); await page.reload() // ADJUST(client-review-full): where the agency reads the round
    await expect(page.getByTestId('round-comments').getByTestId('comment')).toHaveCount(2)
    await expect(page.getByTestId('round-number')).toContainText('Round 1')
    await ctx.close()
  })

  test.fixme(t(38), async ({ browser }) => {
    // The wall. The seed holds every field and a canary sentence sits in every free-text field of the brief; the link's replies hold only the allowed ones.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const { doc, planted } = plantCanary({ ...READY_BRIEF, internal: AGENCY_ONLY })
    expect(planted, 'the canary is in every free-text field').toBeGreaterThan(10)
    const patched = await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: doc, agent: 'j001-seed', action: 'seed: canary in every field' } })
    expect(patched.status()).toBe(200)
    await signOff(page, job)
    const round = await issueRound(page, job)
    const phone = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } })
    const bodies: string[] = []
    const cp = await phone.newPage()
    cp.on('response', async r => { try { bodies.push(await r.text()) } catch { /* gone */ } })
    await cp.goto(round.links[0].path)
    await expect(cp.getByTestId('piece-version')).toBeVisible()
    bodies.push(await cp.evaluate(() => document.body.innerText))
    for (const key of Object.keys(AGENCY_ONLY)) expect(bodies.filter(b => b.includes(AGENCY_ONLY[key as keyof typeof AGENCY_ONLY]))).toEqual([])
    expect(bodies.filter(b => /Judge score|Banned list|idea card/i.test(b) && b.includes(CANARY_SENTENCE))).toEqual([])
    // A used link and an expired link each show one plain line. ADJUST(client-review-full): how the stack expires a link.
    await cp.getByRole('button', { name: 'Approve' }).click()
    await cp.goto(round.links[0].path)
    await expect(cp.getByTestId('client-link-line')).toHaveCount(1)
    // A second agency's person cannot open this link's document.
    await signIn(page, PEOPLE.otherAgency)
    expect((await page.request.get(`/s/${job.brief.token}/chain`)).status()).not.toBe(200)
    // The email code works against a fake sender. ADJUST(client-review-full): the in-memory mailer's inbox route.
    const code = await phone.request.post(`/c/${round.links[1].path.replace(/^\/c\//, '')}/code`)
    expect([200, 204]).toContain(code.status())
    await phone.close()
    await ctx.close()
  })
}
