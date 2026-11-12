// Phase 2 acceptance, record `client-review-full` (features/client-review-full.clan): tests 36 to 38 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// The client's screens are phone screens: a context with no cookies at all opens the link, primary buttons are 44 px tall, and nothing scrolls sideways.
// Screenshots: NAPKIN_E2E_SHOTS=docs/design/client-review-full npm run e2e -- j001-p2-client-review-full
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/, and the roster server's mail goes to a file (stack.mjs).

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { chainOf, open, rosterURL, SIZES, signIn, signOff } from './pilot'
import { asMe, PEOPLE, READY_BRIEF, seedJ001 } from './seed/j001'
import { AGENCY_ONLY, CANARY_SENTENCE, plantCanary } from './seed/j001/p2/wall.mjs'
import { CLIENT_REVIEWERS } from './seed/j001/p2/reviewers.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short
const shots = process.env.NAPKIN_E2E_SHOTS
/** The roster server's outbox: the mails its fake sender "sent", one JSON line each. */
const outbox = join(tmpdir(), `napkin-e2e-outbox-${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}.jsonl`)
const mails = (): { to: string; subject: string; body: string }[] => { try { return readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** A signed brief and a round to the two reviewers, made by account service (os-layer 7.5, client-review-full). */
async function issueRound(page: Page, job: Awaited<ReturnType<typeof seedJ001>>, code = false) {
  await signIn(page, PEOPLE.accountService)
  const brief = await asMe(page, job.api, job.brief)
  const r = await page.request.post(`${job.api}/d/${encodeURIComponent(brief.path)}/client-link/round`, { data: { reviewers: Object.values(CLIENT_REVIEWERS), code } })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()) as { links: { path: string; email: string }[]; round: number }
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test(t(36), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signOff(page, job)
    const round = await issueRound(page, job)
    expect(round.round).toBe(1)
    // The client opens one piece with no account: a context with no cookies at all.
    const phone = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } })
    const cp = await phone.newPage()
    await cp.goto(round.links[0].path)
    await expect(cp.getByTestId('piece-version')).toContainText(/Version \d+/)
    await expect(cp.getByTestId('ai-label')).toBeVisible()
    await expect(cp.getByTestId('ai-label')).toHaveText('AI use not recorded')
    await expect(cp.getByTestId('round-number')).toHaveText('Round 1')
    expect(await noSideScroll(cp), 'nothing scrolls sideways').toBe(true)
    const approve = cp.getByRole('button', { name: 'Approve', exact: true })
    if (size.width === 390) expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    if (shots) await cp.screenshot({ path: `${shots}/review-piece-${size.tag}.png`, fullPage: true })
    await approve.click()
    await expect(cp.getByTestId('client-link-done')).toBeVisible()
    if (shots) await cp.screenshot({ path: `${shots}/review-done-${size.tag}.png` })
    expect(await phone.cookies(), 'the client was given no session').toHaveLength(0)
    await phone.close()
    // One client_review decision lands on that exact version, with the reviewer's name.
    const brief = await asMe(page, job.api, job.brief)
    const chain = await chainOf(page, brief.token)
    const answers = chain.filter(d => d.kind === 'client_review' && d.action === 'client_answer')
    expect(answers).toHaveLength(1)
    expect(answers[0].actor ?? '').toBe(`client:${CLIENT_REVIEWERS.approver.email}`)
    expect(answers[0].version).toBe(chain.find(d => d.kind === 'approve')!.version)
    // The other reviewer's link is still open: one answer is one reviewer's.
    const other = await browser.newContext({ baseURL: rosterURL })
    expect((await other.request.get(`${round.links[1].path}/view`)).status()).toBe(200)
    await other.close()
    await ctx.close()
  })

  test(t(37), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    // The job's route gives the client three rounds.
    await signIn(page, PEOPLE.accountService)
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
    expect((await page.request.put(`${job.api}/jobs/${job.job}/route`, { data: { route: [
      { stage: 'brief-check', party: 'agency', role: 'planner', approver: PEOPLE.planning.username, due: day(2) },
      { stage: 'brief-check', party: 'agency', role: 'creative_director', approver: PEOPLE.creativeDirector.username, due: day(3) },
      { stage: 'client-approval', party: 'client', role: 'client', approver: 'Client A contact', contact: CLIENT_REVIEWERS.approver.email, due: day(6), rounds: 3 },
    ] } })).status()).toBe(200)
    await signOff(page, job)
    const round = await issueRound(page, job)
    // A reviewer taps the piece, types, and chooses the brief point; the comment is the reviewer's own and pinned.
    const phone = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } })
    const cp = await phone.newPage()
    await cp.goto(round.links[0].path)
    await expect(cp.getByTestId('round-number')).toHaveText('Round 1 of 3')
    await cp.getByTestId('add-comment').click()
    await expect(cp.getByTestId('comment-sheet')).toBeVisible()
    await cp.getByLabel(/What is it about/).selectOption({ label: 'The one thing to say' })
    await cp.getByRole('textbox').first().fill('Warmer here, please.')
    if (shots) await cp.screenshot({ path: `${shots}/review-comment-${size.tag}.png` })
    await cp.getByRole('button', { name: 'Save comment' }).click()
    await expect(cp.getByTestId('own-comment')).toContainText('Warmer here, please.')
    expect(await noSideScroll(cp)).toBe(true)
    await phone.close()
    // The second reviewer's comment, near the same spot, through the API as the page makes it.
    const second = await browser.newContext({ baseURL: rosterURL })
    const link = round.links[1].path.replace(/^\/c\//, '')
    const r = await second.request.post(`/c/${link}/comment`, { data: { piece: 1, pin: { x: 0.42, y: 0.4 }, tag: 'preference', text: 'Cooler here.' } })
    expect(r.status(), await r.text()).toBe(200)
    // and the first, pinned on the piece, to be flagged against it
    const first = await browser.newContext({ baseURL: rosterURL })
    const link0 = round.links[0].path.replace(/^\/c\//, '')
    expect((await first.request.post(`/c/${link0}/comment`, { data: { piece: 1, pin: { x: 0.4, y: 0.4 }, tag: 'preference', text: 'Warmer here.' } })).status()).toBe(200)
    await second.close(); await first.close()
    // The agency reads one merged list with the contradiction flagged and the round number.
    await signIn(page, PEOPLE.accountService)
    const brief = await asMe(page, job.api, job.brief)
    const merged = (await (await page.request.get(`${job.api}/d/${encodeURIComponent(brief.path)}/client-review/round`)).json()) as { round: number; rounds_in_scope: number | null; comments: { text: string; flags: string[]; tag: string }[] }
    expect(merged.comments).toHaveLength(3)
    expect(merged.comments.filter(c => c.flags.includes('same spot')).map(c => c.text).sort()).toEqual(['Cooler here.', 'Warmer here.'])
    expect(merged.comments.some(c => c.tag === 'proposition' || c.tag === 'single_minded_proposition')).toBe(true)
    expect(merged.round).toBe(1)
    expect(merged.rounds_in_scope).toBe(3)
    await page.goto('/'); await page.goto(`/#job-${job.job}`); await page.reload()
    await expect(page.getByTestId('round-comments').getByTestId('comment')).toHaveCount(3)
    await expect(page.getByTestId('round-number').first()).toContainText('Round 1 of 3')
    expect(await noSideScroll(page)).toBe(true)
    if (shots) await page.screenshot({ path: `${shots}/round-job-page-${size.tag}.png`, fullPage: true })
    await ctx.close()
  })

  test(t(38), async ({ browser }) => {
    // The wall. The seed holds every field and a canary sentence sits in every free-text field of the brief; the link's replies hold only the allowed ones.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const planted0 = plantCanary({ ...READY_BRIEF, internal: AGENCY_ONLY })
    // The six fields the Brief gate reads for its items stay as the seed has them (a canary sentence makes the proposition two sentences and the gate will not let the planner sign); the canary is in every other free-text field.
    const gateKeys = ['single_minded_proposition', 'insight', 'objectives', 'desired_response', 'famous', 'measurement'] as const
    const doc = { ...planted0.doc, ...Object.fromEntries(gateKeys.map(k => [k, READY_BRIEF[k]])) }
    const planted = planted0.planted
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
    // The replies hold the allowed fields: the planted sentence is in the words the client may read, and nowhere else.
    expect(bodies.some(b => b.includes(CANARY_SENTENCE)), 'the allowed fields reach the page').toBe(true)
    // A used link shows one plain line.
    await cp.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(cp.getByTestId('client-link-done')).toBeVisible()
    await cp.goto(round.links[0].path)
    await expect(cp.getByTestId('client-link-gone')).toHaveCount(1)
    await expect(cp.getByTestId('client-link-gone')).toHaveAttribute('data-state', 'answered')
    // A withdrawn link shows one plain line too. (A link cannot be made to expire here: its token is signed by the server, whose clock
    // is its own; expiry is proved in crates/napkin-web/tests/client_review.rs.)
    const brief = await asMe(page, job.api, job.brief)
    await signIn(page, PEOPLE.accountService)
    const row = ((await (await page.request.get(`${job.api}/d/${encodeURIComponent(brief.path)}/client-links`)).json()) as { links: { id: string; client: { email: string } }[] }).links.find(l => l.client.email === CLIENT_REVIEWERS.second.email)!
    expect((await page.request.post(`${job.api}/d/${encodeURIComponent(brief.path)}/client-link/${row.id}/withdraw`, { data: {} })).status()).toBe(200)
    await cp.goto(round.links[1].path)
    await expect(cp.getByTestId('client-link-gone')).toHaveAttribute('data-state', 'withdrawn')
    // A second agency's person cannot open this link's document.
    await signIn(page, PEOPLE.otherAgency)
    // (an app frame's `/s/<token>` is a capability URL whose token is the whole authority, so the wall is the tenant's own API.)
    for (const tail of ['client-review/round', 'client-links']) expect((await page.request.get(`${job.api}/d/${encodeURIComponent(brief.path)}/${tail}`)).status(), tail).not.toBe(200)
    await phone.close()
    // The email code works against the fake sender: nothing shows until the emailed code is in.
    await signIn(page, PEOPLE.accountService)
    const coded = await issueRound(page, job, true)
    const before = mails().length
    const phone2 = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height } })
    const cp2 = await phone2.newPage()
    await cp2.goto(coded.links[0].path)
    await expect(cp2.getByTestId('client-link-code')).toBeVisible()
    expect(await cp2.evaluate(() => document.body.innerText)).not.toContain('Client A')
    if (shots) await cp2.screenshot({ path: `${shots}/review-code-${size.tag}.png` })
    await cp2.getByRole('button', { name: 'Email me a code' }).click()
    await expect(cp2.getByTestId('code-input')).toBeVisible()
    const sent = mails().slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(CLIENT_REVIEWERS.approver.email)
    const code = /\b(\d{6})\b/.exec(sent[0].subject)![1]
    await cp2.getByTestId('code-input').fill(code === '000000' ? '111111' : '000000')
    await cp2.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(cp2.getByRole('alert')).toContainText('not right')
    await cp2.getByTestId('code-input').fill(code)
    await cp2.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(cp2.getByTestId('piece-version')).toBeVisible()
    await phone2.close()
    await ctx.close()
  })
}
