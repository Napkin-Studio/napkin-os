// Phase 2 acceptance, record `idea-room` (features/idea-room.clan): tests 45, 46, 48, 50, 51, 52 and 70 of
// docs/design/phase2-acceptance.md at 390 and 1440 px, live; tests 47 and 49 stay `test.fixme` because the model
// methods (47) and the own-words precedent port (49) are slices 2 and 3 of the record, behind NAPKIN_IDEA_ROOM_AI.
// Run on the roster stack (stack.mjs). No model is called and no provider key is set.
//
//   NAPKIN_E2E_SHOTS=docs/design/idea-room npm run e2e -- j001-p2-idea-room
//
// Titles read `N short, W px`, the form the suite's registry (phase2/tests.mjs) and counter (phase2/count.mjs) read.
// The room is spun off a signed, confirmed brief the way a person does it (Continue in), and its five team cards are
// written by signed-in people through the host, never by the seed: the host counts the team's cards from who wrote them.

import { expect, test, type Browser, type BrowserContext, type FrameLocator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PHASE2 } from './phase2/tests.mjs'
import { asMe, gateOf, lockBrief, PEOPLE, recordClientConfirmation, seedJ001, signBrief } from './seed/j001'

type Size = { tag: string; width: number; height: number }
const SIZES: Size[] = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]
const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`
const SHOTS = process.env.NAPKIN_E2E_SHOTS
const IDEA_ROOM = 'ie.napkin.idea-room'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Decision = { id?: string; kind?: string; agent?: string; action?: string; actor?: string; version?: string; polarity?: string; reason_code?: string; reviewer_role?: string; superseded_by?: string; handler?: string; backend?: string }
type Job = Awaited<ReturnType<typeof seedJ001>>

async function open(browser: Browser, size: Size): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('napkin.theme', 'white') } catch { /* not kept */ } })
  return { ctx, page: await ctx.newPage() }
}

async function signIn(page: Page, who: { username: string }) {
  expect((await page.request.post('/api/auth/sign-in', { data: { username: who.username } })).status(), `sign in as ${who.username}`).toBe(200)
}

const chainOf = async (page: Page, token: string): Promise<Decision[]> =>
  ((await (await page.request.get(`/s/${token}/chain`)).json()) as { decisions: Decision[] }).decisions

const frameOf = (page: Page): FrameLocator => page.frameLocator('iframe').first()

/** A brief that has passed the gate, been signed by the planner and the creative director and confirmed by the client,
 *  in a client of its own. Leaves the creative director signed in. */
async function signedBrief(page: Page): Promise<Job> {
  await signIn(page, PEOPLE.planning)
  const job = await seedJ001(page, { ready: true, fresh: true })
  expect((await signBrief(page, job.brief)).status()).toBe(200)
  await signIn(page, PEOPLE.creativeDirector)
  expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
  const locked = await asMe(page, job.api, job.brief)
  expect((await recordClientConfirmation(page, locked)).status()).toBe(200)
  return { ...job, brief: locked }
}

/** The idea room, spun off the brief as the signed-in person. Leaves the room open as that person. */
async function makeRoom(page: Page, job: Job) {
  const made = await page.request.post(`${job.api}/d/${encodeURIComponent(job.brief.path)}/spinoff`, { data: { app_id: IDEA_ROOM, title: 'J001 idea room' } })
  expect(made.status(), await made.text()).toBe(200)
  return (await made.json()) as { token: string; path: string }
}

const WRITERS = [PEOPLE.copywriter, PEOPLE.artDirector, PEOPLE.copywriter, PEOPLE.artDirector, PEOPLE.copywriter]
const IDEAS = [
  'One song of silence, once a night, in every bar that pours it.',
  'The first pour takes a full minute, and the bartender says why.',
  'A coaster that is a short list of how to start.',
  'Last orders is a bell that means something.',
  'The label says how to start.',
]

/** `count` team cards, each written by a signed-in person through the host (what the host counts). Leaves `as` signed in. */
async function writeCards(page: Page, job: Job, room: { path: string }, count: number, as: { username: string }) {
  for (let i = 0; i < count; i++) {
    await signIn(page, WRITERS[i])
    const me = await asMe(page, job.api, { path: room.path, id: '' })
    const r = await page.request.post(`/s/${me.token}/ideas/card`, { data: { text: IDEAS[i] } })
    expect(r.status(), await r.text()).toBe(200)
  }
  await signIn(page, as)
  return asMe(page, job.api, { path: room.path, id: '' })
}

const gate = async (page: Page, token: string) =>
  (await (await page.request.get(`/s/${token}/ideas/gate`)).json()) as { team_cards: number; needed: number; open: boolean; opened_by: string | null; opened_via: string | null; routes_out: string[]; chosen: { route: string; version: string } | null }
const roomData = async (page: Page, token: string) =>
  ((await (await page.request.get(`/s/${token}/ideas/room`)).json()) as { data: { cards: Record<string, { by: string; kind: string }>; routes: Record<string, { name: string; version: number }> } }).data

/** Open the room in the shell as the signed-in person, and wait for its page. */
async function openRoom(page: Page, job: Job) {
  await page.goto(`/#tool-${job.client}-idea`)
  await page.reload()
  await page.getByTestId('work-item').first().click()
  await expect(frameOf(page).locator('[data-where="idea-room"]')).toBeVisible({ timeout: 30_000 })
  return frameOf(page)
}

/** Three routes made from the room's cards, as the creative director, then worked on by two people and merged. */
async function threeRoutesMerged(page: Page, job: Job, room: { path: string }) {
  await signIn(page, PEOPLE.creativeDirector)
  const cd = await asMe(page, job.api, { path: room.path, id: '' })
  const start = await page.request.post(`/s/${cd.token}/ideas/routes/start`, {
    data: { routes: [
      { name: 'One song', bet: 'A bar goes quiet for one song, and the whiskey is what it pours.', cards: ['c1', 'c2'] },
      { name: 'The long pour', bet: 'The first pour takes a minute, and that minute is the ad.', cards: ['c3'] },
      { name: 'Last orders', bet: 'A bell that means something at the end of the night.', cards: ['c4', 'c5'] },
    ] },
  })
  expect(start.status(), await start.text()).toBe(200)
  for (const [who, note] of [[PEOPLE.copywriter, 'The film is the pour.'], [PEOPLE.artDirector, 'Shot in one take, no cuts.']] as const) {
    await signIn(page, who)
    const me = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await page.request.post(`/s/${me.token}/ideas/routes/edit`, { data: { route: 'route_1', note } })).status()).toBe(200)
  }
  await signIn(page, PEOPLE.creativeDirector)
  const again = await asMe(page, job.api, { path: room.path, id: '' })
  const merged = await page.request.post(`/s/${again.token}/merge`, { data: { branches: ['route_1', 'route_2', 'route_3'] } })
  expect(merged.status(), await merged.text()).toBe(200)
  return { merged: (await merged.json()) as { routes: Record<string, unknown>; clashes: unknown[] }, token: (await asMe(page, job.api, { path: room.path, id: '' })).token }
}

async function shot(page: Page, name: string, size: Size, at?: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  // The page scrolls inside the shell's frame: bring `at` (a selector in the page) to the top of it, else the top.
  if (await page.locator('iframe').count()) await frameOf(page).locator('body').evaluate((_b, sel) => { const el = sel ? document.querySelector(sel) : null; window.scrollTo(0, el ? el.getBoundingClientRect().top + window.scrollY - 12 : 0) }, at ?? '')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, `${name}-${size.tag}.png`), fullPage: size.width < 1000 })
}

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test(t(45), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    const room = await makeRoom(page, job)
    const me = await writeCards(page, job, room, 4, PEOPLE.copywriter)
    expect(await gate(page, me.token)).toMatchObject({ team_cards: 4, needed: 5, open: false })
    const app = await openRoom(page, job)
    await expect(app.getByTestId('brief-insight')).toContainText('Younger drinkers think Irish whiskey is for someone else')
    await expect(app.getByTestId('ai-ideas')).toHaveCount(0) // the AI shows no ideas
    await expect(app.getByTestId('ai-gate')).toContainText('One card to go')
    await expect(app.getByTestId('card')).toHaveCount(4)
    await shot(page, 'room-four-cards', size)
    // The host refuses a model task now, and the page cannot get round it.
    const task = () => page.request.post(`/s/${me.token}/api-proxy`, { data: { request_kind: 'middleware', payload: { task: 'ban_default', input: {} } } })
    const closed = await task()
    expect(closed.status(), 'a model task is refused before the room is open').toBe(409)
    expect(await closed.text()).toContain('ideas_closed')
    // The fifth card opens it.
    await app.getByTestId('card-input').fill('A card is a promise to the team.')
    await app.getByRole('button', { name: 'Add card' }).click()
    await expect.poll(async () => (await gate(page, me.token)).open).toBe(true)
    await expect(app.getByTestId('ai-gate')).toContainText('The room is open')
    await expect(app.getByTestId('card')).toHaveCount(5)
    expect((await gate(page, me.token)).opened_via).toBe('cards')
    // Open, the team goes past the first rule; the AI methods themselves are off in this slice, and say so.
    const after = await task()
    expect(after.status()).toBe(403)
    expect(await after.text()).toContain('ai_off')
    await shot(page, 'room-open', size)
    await ctx.close()
  })

  test(t(46), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    const room = await makeRoom(page, job)
    await writeCards(page, job, room, 2, PEOPLE.copywriter)
    // A copywriter trying to open the AI early gets 403, and the page offers it to nobody but the creative director.
    const writer = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await page.request.post(`/s/${writer.token}/ideas/open-early`, { data: { rationale: 'Early.' } })).status()).toBe(403)
    const asWriter = await openRoom(page, job)
    await expect(asWriter.getByRole('button', { name: 'Open early' })).toHaveCount(0)
    await expect(asWriter.getByTestId('ai-gate')).toContainText('Only Dara, the creative director on the brief, can open it early.')
    // The creative director opens it: one decision in their name, with the reason.
    await signIn(page, PEOPLE.creativeDirector)
    const app = await openRoom(page, job)
    await app.getByRole('button', { name: 'Open early' }).click()
    await expect(app.getByRole('button', { name: 'Open the room early' })).toHaveAttribute('aria-disabled', 'true')
    await app.getByLabel('Why open it before the team has its 5?').fill('The team asked for help.')
    await shot(page, 'room-open-early-form', size)
    await app.getByRole('button', { name: 'Open the room early' }).click()
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    await expect.poll(async () => (await gate(page, cd.token)).open).toBe(true)
    const opened = (await chainOf(page, cd.token)).filter(d => d.action === 'open_early')
    expect(opened).toHaveLength(1)
    expect(opened[0].actor).toBe(`human:${PEOPLE.creativeDirector.username}`)
    expect(await gate(page, cd.token)).toMatchObject({ open: true, opened_by: PEOPLE.creativeDirector.username, opened_via: 'early' })
    await expect(app.getByTestId('ai-gate')).toContainText('Opened early by Dara')
    await expect(app.getByTestId('ai-gate')).toContainText('The team asked for help.')
    await ctx.close()
  })

  test.fixme(t(47), async () => {
    // Slice 2: Ban the default, the Swap test and the Fame test, behind NAPKIN_IDEA_ROOM_AI and a model seam. Not built yet:
    // see features/idea-room.clan next_step. Written when the slice lands; the stand-in answers from seed/j001/p2/answers/.
  })

  test(t(48), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    const room = await makeRoom(page, job)
    await writeCards(page, job, room, 5, PEOPLE.creativeDirector)
    const calls = async () => ((await (await page.request.get('/api/session')).json()) as { quota: { used: number } }).quota.used
    const before = await calls()
    const { merged, token } = await threeRoutesMerged(page, job, room)
    expect(Object.keys(merged.routes), 'the merged file holds all three').toEqual(['route_1', 'route_2', 'route_3'])
    expect(merged.clashes, 'no route wrote outside its own key, so no clash').toEqual([])
    expect(await calls(), 'merging calls no model').toBe(before)
    // Three routes are three forks: three branch documents were made next to the room, and the room holds the merge.
    const data = await roomData(page, token)
    expect(Object.values(data.routes).map(r => r.name)).toEqual(['One song', 'The long pour', 'Last orders'])
    expect(data.routes.route_1.version, 'version counts the two notes').toBe(3)
    const chain = await chainOf(page, token)
    expect(chain.some(d => d.agent === 'clan-merge'), 'the chain shows the merge marker').toBe(true)
    expect(chain.every(d => !d.handler && !d.backend && !(d.actor ?? '').startsWith('process:')), 'no handler or model entry').toBe(true)
    // Both notes are in the history under their own names.
    const who = chain.map(d => d.actor)
    expect(who).toContain(`human:${PEOPLE.copywriter.username}`)
    expect(who).toContain(`human:${PEOPLE.artDirector.username}`)
    const app = await openRoom(page, job)
    await expect(app.getByTestId('route')).toHaveCount(3)
    await expect(app.getByTestId('route').first()).toContainText('One song')
    await expect(app.getByTestId('route').first()).toContainText('The film is the pour.')
    await shot(page, 'room-routes-merged', size, '#routes')
    await ctx.close()
  })

  test.fixme(t(49), async () => {
    // Slice 3: the originality check, from own-words records only (precedents port). Not built yet: see features/idea-room.clan next_step.
  })

  test(t(50), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    const room = await makeRoom(page, job)
    await writeCards(page, job, room, 5, PEOPLE.creativeDirector)
    await threeRoutesMerged(page, job, room)
    const pick = (token: string, route = 'route_1') => page.request.post(`/s/${token}/ideas/pick`, { data: { route, rationale: 'The ritual is the idea.' } })
    await signIn(page, PEOPLE.copywriter)
    const writer = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await pick(writer.token)).status(), "a copywriter's pick is refused").toBe(403)
    // The page offers it to nobody else.
    const asWriter = await openRoom(page, job)
    await expect(asWriter.getByRole('button', { name: /^Pick the route/ })).toHaveCount(0)
    await expect(asWriter.getByTestId('pick-note')).toContainText('Only Dara, the creative director on the brief, picks the route.')
    await signIn(page, PEOPLE.creativeDirector)
    const app = await openRoom(page, job)
    await shot(page, 'room-before-pick', size, '#routes')
    await app.getByRole('button', { name: 'Pick the route One song' }).click()
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    await expect.poll(async () => (await gate(page, cd.token)).chosen?.route).toBe('route_1')
    const picks = (await chainOf(page, cd.token)).filter(d => d.action === 'pick_route')
    expect(picks).toHaveLength(1)
    expect(picks[0].actor).toBe(`human:${PEOPLE.creativeDirector.username}`) // in their name
    expect(picks[0]).toMatchObject({ kind: 'verdict', polarity: 'good', reason_code: 'route.chosen', reviewer_role: 'creative-director', version: '3' }) // on that exact route version
    // No AI task can write the pick: nothing but a person's context writes it, and the generic patch is refused.
    expect(picks.every(p => p.actor?.startsWith('human:') && !p.handler && !p.backend)).toBe(true)
    const patch = await page.request.post(`/s/${cd.token}/patch-data`, { data: { patch: { chosen: { route: 'route_2' } }, agent: 'human', action: 'edit' } })
    expect(patch.status(), 'a patch cannot write the pick').toBe(403)
    await expect(app.getByTestId('chosen-route')).toContainText('Chosen · version 3 · Dara')
    await shot(page, 'room-chosen', size, '#routes')
    await ctx.close()
  })

  test(t(51), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    const room = await makeRoom(page, job)
    const me = await writeCards(page, job, room, 3, PEOPLE.copywriter)
    const app = await openRoom(page, job)
    await expect(app.getByTestId('card')).toHaveCount(3)
    await ctx.setOffline(true) // cut the network while writing a card
    await app.getByTestId('card-input').fill('A card written offline.')
    await app.getByRole('button', { name: 'Add card' }).click()
    await expect(page.locator('[data-state="failed-save"]')).toBeVisible() // the Failed save state, in the shell
    await expect(app.getByTestId('card-input')).toHaveValue('A card written offline.') // the text stays
    await shot(page, 'room-failed-save', size, '#cards')
    await ctx.setOffline(false)
    await page.locator('[data-state="failed-save"]').getByRole('button', { name: 'Try again' }).click()
    await expect(app.getByTestId('card').filter({ hasText: 'A card written offline.' })).toBeVisible()
    await expect(app.getByTestId('card-input')).toHaveValue('')
    expect((await chainOf(page, me.token)).filter(d => d.action === 'idea_card')).toHaveLength(4) // one decision for it, not two
    // Later the creative director reopens the choice with a reason, and the first pick stays in the history.
    await signIn(page, PEOPLE.copywriter)
    await writeCards(page, job, room, 2, PEOPLE.creativeDirector)
    await threeRoutesMerged(page, job, room)
    const cd = await asMe(page, job.api, { path: room.path, id: '' })
    expect((await page.request.post(`/s/${cd.token}/ideas/pick`, { data: { route: 'route_1', rationale: 'The first pick.' } })).status()).toBe(200)
    const reopen = await page.request.post(`/s/${cd.token}/ideas/reopen`, { data: { rationale: 'The client changed the budget.' } })
    expect(reopen.status(), await reopen.text()).toBe(200)
    const history = await chainOf(page, cd.token)
    const first = history.find(d => d.action === 'pick_route')!
    expect(first, 'the first pick stays in the history').toBeTruthy()
    expect(first.superseded_by, 'and says what replaced it').toBe(history.find(d => d.action === 'reopen_choice')!.id)
    expect((await gate(page, cd.token)).chosen, 'nothing is chosen until the next pick').toBeNull()
    await ctx.close()
  })

  test(t(52), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    const room = await makeRoom(page, job)
    await writeCards(page, job, room, 5, PEOPLE.creativeDirector)
    await threeRoutesMerged(page, job, room)
    // The brief gets a new version after routes exist: it is unlocked, edited, and the room has moved on from what it carried.
    const brief = await asMe(page, job.api, job.brief)
    expect((await page.request.post(`/s/${brief.token}/unapprove`, { data: { rationale: 'The client changed the line.' } })).status()).toBe(200)
    const reopened = await asMe(page, job.api, job.brief)
    expect((await page.request.post(`/s/${reopened.token}/patch-data`, { data: { patch: { single_minded_proposition: 'The easy way to your first Irish pour.' }, agent: 'human', action: 'edit the proposition' } })).status()).toBe(200)
    const app = await openRoom(page, job)
    const changed = page.locator('[data-state="changed-brief"]')
    await expect(changed).toBeVisible()
    await expect(changed).toContainText('The brief changed to v2. This work was made from v1.')
    await expect(changed.getByRole('button', { name: 'Update to brief v2' })).toBeVisible()
    await shot(page, 'room-changed-brief', size)
    await changed.getByRole('button', { name: 'Update to brief v2' }).click()
    await expect(app.getByTestId('brief-proposition')).toContainText('The easy way to your first Irish pour.')
    await expect(page.locator('[data-state="changed-brief"]')).toHaveCount(0)
    await ctx.close()
  })

  test(t(70), async ({ browser }) => {
    // J001 from brief to chosen route, in one run: signed and confirmed brief, five team cards, three routes, one pick by the
    // creative director. (Judge's three scores are the Judge record's: this run reaches the pick without them.)
    const { ctx, page } = await open(browser, size)
    const job = await signedBrief(page)
    expect((await gateOf(page, job.brief)).open, 'the brief has passed, is signed and confirmed').toBe(true)
    // A brief that is not confirmed makes no room. A planner opens its job (a creative director may not open one: job-page),
    // and the creative director asks for the room.
    await signIn(page, PEOPLE.planning)
    const early = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.creativeDirector)
    const refused = await page.request.post(`${early.api}/d/${encodeURIComponent(early.brief.path)}/spinoff`, { data: { app_id: IDEA_ROOM, title: 'Too early' } })
    expect(refused.status(), 'a brief that has not passed the gate makes no idea room').toBe(409)
    const room = await makeRoom(page, job)
    const me = await writeCards(page, job, room, 5, PEOPLE.creativeDirector)
    const cards = (await roomData(page, me.token)).cards
    expect(Object.values(cards).map(c => c.by), 'five team cards, from two people').toEqual([PEOPLE.copywriter, PEOPLE.artDirector, PEOPLE.copywriter, PEOPLE.artDirector, PEOPLE.copywriter].map(p => p.username))
    expect(await gate(page, me.token)).toMatchObject({ team_cards: 5, open: true })
    const { token, merged } = await threeRoutesMerged(page, job, room)
    expect(Object.keys(merged.routes)).toHaveLength(3)
    const app = await openRoom(page, job)
    await shot(page, 'room-j001-routes', size, '#routes')
    await app.getByRole('button', { name: 'Pick the route The long pour' }).click()
    await expect.poll(async () => (await gate(page, token)).chosen?.route).toBe('route_2')
    await expect(app.getByTestId('chosen-route')).toContainText('Chosen · version 1 · Dara')
    expect((await chainOf(page, token)).filter(d => d.action === 'pick_route')).toHaveLength(1)
    await shot(page, 'room-j001-chosen', size, '#routes')
    await ctx.close()
  })
}
