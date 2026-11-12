// Phase 2 acceptance, record `idea-room` (features/j001-phase2-suite.clan): tests 45 to 52 and 70 of docs/design/phase2-acceptance.md, run at 390 and 1440 px.
// Written before the screen exists, so each body is marked `test.fixme`: the registry (phase2/tests.mjs) names this record as the one
// that turns it on, and it does so by editing only this file, its pages file and its seed. Lines marked ADJUST(idea-room) are guesses from
// the design (selectors, routes, test ids): the owning record changes them to what it builds, then removes the fixme. Facts read
// through the document's chain and the API do not move with the screen and are the part to keep.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.
//
// The Idea room (features/idea-room.clan): humans first, the creative director decides, three routes are three forks, own-words precedents only.
// The host's operations (os-layer, the Idea room section): POST /s/{token}/ideas/open-early {rationale}, POST /s/{token}/ideas/pick
// {route, rationale}, GET /s/{token}/ideas/gate -> {team_cards, needed, open, opened_by}, POST /s/{token}/merge.

import { expect, test, type Page } from '@playwright/test'
import { asMe, gateOf, lockBrief, makeClientLink, PEOPLE, seedJ001, signBrief } from './seed/j001'
import { chainOf, control, middlewareLog, open, rosterURL, SIZES, signIn, type Decision } from './pilot'
import { BANNED_MATCH_CARD, IDEA_ROOM, IDEA_ROOM_APP, PRECEDENTS, TEAM_CARDS } from './seed/j001/p2/idea-room.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Seeded = Awaited<ReturnType<typeof seedJ001>>

/** An Idea room for the job with `cards` team cards (the seed's first n), made as the signed-in person. */
async function ideaRoom(page: Page, job: Seeded, cards = 5) {
  const made = await page.request.post(`${job.api}/documents`, { data: { app_id: IDEA_ROOM_APP, title: 'J001 idea room', client_id: job.client, job: job.job } })
  expect(made.status(), 'the Idea room app is installed').toBe(200)
  const body = (await made.json()) as { token: string; path: string }
  const data = { ...IDEA_ROOM, cards: Object.fromEntries(TEAM_CARDS.slice(0, cards).map(c => [c.id, c])), routes: {} }
  expect((await page.request.post(`/s/${body.token}/patch-data`, { data: { patch: data, agent: 'j001-seed', action: 'seed: idea room' } })).status()).toBe(200)
  return body
}
const gate = async (page: Page, token: string) => (await (await page.request.get(`/s/${token}/ideas/gate`)).json()) as { team_cards: number; needed: number; open: boolean; opened_by: string | null }

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test.fixme(t(45), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const room = await ideaRoom(page, job, 4)
    expect(await gate(page, room.token)).toMatchObject({ team_cards: 4, needed: 5, open: false })
    await page.goto(`/#tool-${job.client}-ideas`); await page.reload() // ADJUST(idea-room)
    await page.getByTestId('work-item').first().click()
    await expect(page.getByTestId('ai-ideas')).toHaveCount(0) // the AI shows no ideas
    await expect(page.getByTestId('ai-gate')).toContainText('one card to go') // ADJUST(idea-room)
    await page.getByTestId('card-input').fill('The label that says how to start.') // the fifth card opens it
    await page.getByRole('button', { name: 'Add card' }).click()
    await expect.poll(async () => (await gate(page, room.token)).open).toBe(true)
    await ctx.close()
  })

  test.fixme(t(46), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const room = await ideaRoom(page, job, 2)
    // A copywriter trying to open the AI early gets 403.
    const asWriter = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await page.request.post(`/s/${asWriter.token}/ideas/open-early`, { data: { rationale: 'Early.' } })).status()).toBe(403)
    // The creative director opens it: one decision in their name.
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await page.request.post(`/s/${cd.token}/ideas/open-early`, { data: { rationale: 'The team asked for help.' } })).status()).toBe(200)
    const opened = (await chainOf(page, cd.token)).filter((d: Decision) => d.action === 'open_early' || d.kind === 'open_early')
    expect(opened).toHaveLength(1)
    expect(opened[0].actor ?? '').toContain(PEOPLE.creativeDirector.username)
    expect(await gate(page, cd.token)).toMatchObject({ open: true, opened_by: PEOPLE.creativeDirector.username })
    await ctx.close()
  })

  test.fixme(t(47), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const room = await ideaRoom(page, job, 5)
    await page.goto(`/#tool-${job.client}-ideas`); await page.reload()
    await page.getByTestId('work-item').first().click()
    await page.getByRole('button', { name: 'Ban the default' }).click() // the stand-in answers from answers/ban_default.json
    await expect(page.getByTestId('banned-card')).toHaveCount(3)
    // A team card that matches one is flagged.
    await page.getByTestId('card-input').fill(BANNED_MATCH_CARD)
    await page.getByRole('button', { name: 'Add card' }).click()
    await expect(page.getByTestId('card').filter({ hasText: BANNED_MATCH_CARD }).getByTestId('banned-flag')).toBeVisible()
    // A card shows its Swap test flag and its two Fame test lines.
    const card = page.getByTestId('card').first()
    await expect(card.getByTestId('swap-flag')).toBeVisible()
    await expect(card.getByTestId('fame-line')).toHaveCount(2)
    expect((await middlewareLog(page)).filter(e => e.task === 'ban_default')).toHaveLength(1)
    expect(room.token).toBeTruthy()
    await ctx.close()
  })

  test.fixme(t(48), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const room = await ideaRoom(page, job, 5)
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    // Three routes are three forks. ADJUST(idea-room): how a route is made from cards (a fork per route).
    const before = (await middlewareLog(page)).length
    const merged = await page.request.post(`/s/${cd.token}/merge`, { data: { branches: ['route-1', 'route-2', 'route-3'] } })
    expect(merged.status(), await merged.text()).toBe(200)
    const body = (await merged.json()) as { routes: Record<string, unknown>; clashes: { left: unknown; right: unknown }[] }
    expect(Object.keys(body.routes)).toHaveLength(3) // the merged file holds all three
    for (const c of body.clashes) { expect(c.left).toBeTruthy(); expect(c.right).toBeTruthy() } // a clash is listed with both sides
    expect((await chainOf(page, cd.token)).some(d => /merge/.test(`${d.kind} ${d.action}`))).toBe(true) // the chain shows the merge
    expect((await middlewareLog(page)).length, 'merging calls no model').toBe(before)
    await ctx.close()
  })

  test.fixme(t(49), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.creativeDirector)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await ideaRoom(page, job, 5)
    // With no own-words records the check says it is off.
    await page.goto(`/#tool-${job.client}-ideas`); await page.reload()
    await page.getByTestId('work-item').first().click()
    await expect(page.getByTestId('originality')).toContainText(/off/i) // ADJUST(idea-room)
    // With fixture own-words records a close idea shows its precedent and source. ADJUST(idea-room): how the precedent port is loaded with the fixture.
    expect((await page.request.put(`${job.api}/precedents`, { data: { records: PRECEDENTS } })).status()).toBe(200)
    await page.reload(); await page.getByTestId('work-item').first().click()
    const shown = page.getByTestId('precedent')
    await expect(shown).toHaveCount(1) // only the own-words house record
    await expect(shown).toContainText('A pub that closed for a song')
    await expect(shown.getByRole('link')).toHaveAttribute('href', 'https://precedents.example/house/1')
    for (const never of ['An awards entry', 'An effectiveness case', 'Not own words']) await expect(page.getByText(never)).toHaveCount(0)
    await ctx.close()
  })

  test.fixme(t(50), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const room = await ideaRoom(page, job, 5)
    const pick = (token: string) => page.request.post(`/s/${token}/ideas/pick`, { data: { route: 'route_1', rationale: 'The ritual is the idea.' } })
    expect((await pick((await asMe(page, job.api, { path: room.path, id: '' })).token)).status()).toBe(403) // a copywriter's pick is refused
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await pick(cd.token)).status()).toBe(200)
    const picks = (await chainOf(page, cd.token)).filter(d => d.action === 'pick_route' || d.kind === 'pick_route')
    expect(picks).toHaveLength(1)
    expect(picks[0].actor ?? '').toContain(PEOPLE.creativeDirector.username) // in their name
    expect(picks[0].version).toBeTruthy() // on that exact route version
    // No AI task can write the pick: the agent of every pick decision is a person's, never a handler's.
    expect(picks.every(p => p.agent === 'human')).toBe(true)
    await ctx.close()
  })

  test.fixme(t(51), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.copywriter)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const room = await ideaRoom(page, job, 3)
    await page.goto(`/#tool-${job.client}-ideas`); await page.reload()
    await page.getByTestId('work-item').first().click()
    await ctx.setOffline(true) // cut the network while writing a card
    await page.getByTestId('card-input').fill('A card written offline.')
    await page.getByRole('button', { name: 'Add card' }).click()
    await expect(page.locator('[data-state="save-failed"]')).toBeVisible() // ADJUST(idea-room): the save-failed state's selector, as pilot test 13 reads it
    await expect(page.getByTestId('card-input')).toHaveValue('A card written offline.') // the text stays
    await ctx.setOffline(false)
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('card').filter({ hasText: 'A card written offline.' })).toBeVisible()
    // Later the creative director reopens the choice with a reason, and the first pick stays in the history.
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    await page.request.post(`/s/${cd.token}/ideas/pick`, { data: { route: 'route_1', rationale: 'The first pick.' } })
    expect((await page.request.post(`/s/${cd.token}/ideas/reopen`, { data: { rationale: 'The client changed the budget.' } })).status()).toBe(200) // ADJUST(idea-room): the reopen route
    const history = (await chainOf(page, cd.token)).filter(d => /pick|reopen/.test(`${d.kind} ${d.action}`))
    expect(history.length).toBeGreaterThanOrEqual(2) // the first pick stays
    await ctx.close()
  })

  test.fixme(t(52), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signBrief(page, job.brief)
    await signIn(page, PEOPLE.creativeDirector)
    await lockBrief(page, await asMe(page, job.api, job.brief))
    const room = await ideaRoom(page, job, 5)
    // The brief gets a new version after routes exist.
    expect((await page.request.post(`/s/${job.brief.token}/patch-data`, { data: { patch: { single_minded_proposition: 'A newer line.' }, agent: 'human', action: 'edit the proposition' } })).status()).toBe(200)
    expect((await gateOf(page, job.brief)).changed_since_lock).toBe(true)
    await page.goto(`/#tool-${job.client}-ideas`); await page.reload()
    await page.getByTestId('work-item').first().click()
    const changed = page.getByTestId('changed-brief') // ADJUST(idea-room): the same component the job page uses
    await expect(changed).toBeVisible()
    await expect(changed.getByRole('button', { name: /^Update to brief v\d+$/ })).toBeVisible()
    expect(room.token).toBeTruthy()
    await ctx.close()
  })

  test.fixme(t(70), async ({ browser }) => {
    // J001 from brief to chosen route, in one run (the gate walk, by the API where it can be, on the screens where they exist).
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signBrief(page, job.brief) // signed and confirmed brief
    await signIn(page, PEOPLE.creativeDirector)
    expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
    await signIn(page, PEOPLE.accountService)
    const link = await makeClientLink(page, job.api, job.brief)
    const phone = await browser.newContext({ baseURL: rosterURL })
    expect((await phone.request.post(`${link.path}/answer`, { data: { answer: 'accepted' } })).status()).toBe(200) // ADJUST(client-review-full)
    await phone.close()
    await signIn(page, PEOPLE.copywriter) // five team cards
    const room = await ideaRoom(page, job, 5)
    await control(page, { variant: { judge_work: 'score24' } })
    // three routes, three scores, one pick by the creative director
    await signIn(page, PEOPLE.creativeDirector)
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    const doc = (await (await page.request.get(`/s/${cd.token}/data`)).json()) as { routes: Record<string, unknown> } // ADJUST(idea-room): reading the data
    expect(Object.keys(doc.routes)).toHaveLength(3)
    for (const route of Object.keys(doc.routes)) {
      expect((await page.request.post(`/s/${cd.token}/judge`, { data: { target: `routes.${route}` } })).status()).toBe(200) // ADJUST(judge): the score call
    }
    expect((await page.request.post(`/s/${cd.token}/ideas/pick`, { data: { route: 'route_1', rationale: 'The ritual is the idea.' } })).status()).toBe(200)
    // The job page shows the chosen route.
    await page.goto(`/#job-${job.job}`); await page.reload() // ADJUST(job-page)
    await expect(page.getByTestId('job-chosen-route')).toContainText('One song')
    await ctx.close()
  })
}
