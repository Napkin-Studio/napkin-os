// Roles on the desk (features/roles-and-homes.clan, reshaped by features/align-landing-look.clan): the Your pages
// row each role adds to the one desk, the merged row of a person with two roles, View as, the old home and map
// addresses falling to the desk, a door with no page opening its card, the dial offering a role its tools only,
// and a person with no role keeping the whole desk. Run on the roster server (stack.mjs: the placeholder
// people of seed/j001/people.mjs, with their roles), at 390 and 1440 px. Clients are placeholders.
//
// With NAPKIN_E2E_SHOTS=<dir> it also writes a screenshot of each home, the O and a later-phase door:
//   NAPKIN_E2E_SHOTS=docs/design/roles-and-homes npm run e2e -- roles-homes

import { expect, test, type Browser, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001/people'
import { seedJ001 } from './seed/j001'

const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`
const shots = process.env.NAPKIN_E2E_SHOTS
const SIZES = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]
const CONTEST = { selection: { contested: [{ id: 'c1', key: 'headline', status: 'open', values: [{ value: 'One' }, { value: 'Two' }] }] } }

async function signedIn(browser: Browser, size: { width: number; height: number }, who: { username: string }) {
  const ctx = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('napkin.theme', 'light') } catch { /* not kept */ } })
  const page = await ctx.newPage()
  const r = await page.request.post('/api/auth/sign-in', { data: { username: who.username } })
  expect(r.status(), `sign in as ${who.username}`).toBe(200)
  return { ctx, page }
}

const names = (page: Page, id: string) => page.getByTestId(id).allInnerTexts()

for (const size of SIZES) {
  const at = (title: string) => `${title}, ${size.tag} px`

  test(at('a person with two roles gets one Your pages row of five, the rest under More'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planningAndCreative)
    await page.goto('/')
    await expect(page.getByTestId('door')).toHaveCount(5)
    expect(await names(page, 'door')).toEqual(['Ready for review', 'Judge scores', 'Client brains', 'Approved work', 'Direction notes'])
    const more = await names(page, 'more-tool')
    for (const left of ['Case study builder (read only)', 'Traffic board (read only)']) expect(more).toContain(left)
    // the tools are not doors: Brief, Research, Ideas, Territories and Presentations are on the dial
    expect(await names(page, 'door')).not.toContain('Brief')
    await ctx.close()
  })

  test(at('no desk draws more than five page doors, and Needs you sits under them'), async ({ browser }) => {
    for (const who of [PEOPLE.planning, PEOPLE.creativeDirector, PEOPLE.accountService, PEOPLE.management, PEOPLE.planningAndCreative, PEOPLE.admin]) {
      const { ctx, page } = await signedIn(browser, size, who)
      await page.goto('/')
      await expect(page.getByTestId('desk')).toBeVisible()
      await expect(page.getByTestId('pages-row')).toBeVisible()
      expect(await page.getByTestId('door').count(), who.username).toBeLessThanOrEqual(5)
      await expect(page.getByRole('heading', { name: 'Your pages' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
      await ctx.close()
    }
  })

  test(at('View as is in an admin\'s account menu, changes the row, and a planner has none'), async ({ browser }) => {
    const planner = await signedIn(browser, size, PEOPLE.planning)
    await planner.page.goto('/')
    await expect(planner.page.getByTestId('desk')).toBeVisible()
    await planner.page.getByTestId('account-button').click()
    await expect(planner.page.getByRole('menuitem', { name: /View as/ })).toHaveCount(0)
    await planner.ctx.close()

    const { ctx, page } = await signedIn(browser, size, PEOPLE.admin)
    await page.goto('/')
    await expect(page.getByTestId('door')).toHaveText(['Agency dashboard', 'Live jobs', 'Time and money', 'Traffic board', 'Agency Brain (read only)'])
    await page.getByTestId('account-button').click()
    await page.getByRole('menuitem', { name: /^View as/ }).click()
    await expect(page.getByTestId('door')).toHaveText(['Client brains', 'Case study builder (read only)'])
    await expect(page).toHaveURL(/#agency$/)
    await ctx.close()
  })

  test(at('#map and #home-<role> are not routes: each is the desk'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.admin)
    for (const old of ['#map', '#home-copywriter']) {
      await page.goto('/' + old)
      await page.reload()
      await expect(page.getByTestId('desk')).toBeVisible()
      await expect(page.getByTestId('the-o')).toHaveCount(0)
      await expect(page.getByTestId('role-switcher')).toHaveCount(0)
    }
    await ctx.close()
  })

  test(at('a planner lands on the desk, with one row of pages and no home of its own'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    await page.goto('/')
    await expect(page.getByTestId('desk')).toBeVisible()
    await expect(page.getByTestId('home-title')).toHaveCount(0)
    await expect(page.getByTestId('the-o')).toHaveCount(0)
    await expect(page.getByTestId('open-map')).toHaveCount(0)
    expect(await names(page, 'door')).toEqual(['Client brains', 'Case study builder (read only)'])
    await ctx.close()
  })

  test(at('Client brains, which has no page yet, opens a card with its own example and not an error'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    await page.goto('/')
    await page.getByTestId('door').filter({ hasText: 'Client brains' }).click()
    await expect(page.getByTestId('door-page')).toBeVisible()
    await expect(page.locator('[data-state="empty"]')).toBeVisible()
    await expect(page.locator('[data-state="empty"]')).toContainText('What the agency knows about one client goes here.')
    await expect(page.locator('.ch-banner')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByTestId('to-desk').click()
    await expect(page.getByTestId('desk')).toBeVisible()
    await ctx.close()
  })

  test(at('a tool is on the dial for the role that has it and absent for the role that has not'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    const job = await seedJ001(page)
    await page.goto('/')
    await page.getByTestId('client-circle').first().click()
    await expect(page.getByTestId('quadrant-brief')).toBeVisible()
    await page.getByTestId('quadrant-brief').click()
    await expect(page).toHaveURL(new RegExp(`#tool-${job.client}-brief$`))
    await ctx.close()
    // Management is offered Presentations only (the v2 doors table): no Brief on its dial, and its address falls back to the client
    const mgr = await signedIn(browser, size, PEOPLE.management)
    const j2 = await seedJ001(mgr.page)
    await mgr.page.goto('/')
    await mgr.page.getByTestId('client-circle').first().click()
    await expect(mgr.page.getByTestId('quadrant-deck')).toBeVisible()
    await expect(mgr.page.getByTestId('quadrant-brief')).toHaveCount(0)
    await mgr.page.goto(`/#tool-${j2.client}-brief`)
    await mgr.page.reload()
    await expect(mgr.page).toHaveURL(new RegExp(`#client-${j2.client}$`))
    await mgr.ctx.close()
  })

  test(at('a person with no role keeps the whole desk, and the server refuses them nothing'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.noRole)
    await page.goto('/')
    await expect(page.getByTestId('desk')).toBeVisible()
    await expect(page.getByTestId('pages-row')).toHaveCount(0)
    const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
    expect((await page.request.get(`/api/t/${tenant}/jobs/J001/scope`)).status()).not.toBe(403)
    await ctx.close()
  })

  test(at('the session carries the roles'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planningAndCreative)
    const me = await (await page.request.get('/api/session')).json() as { roles: string[] }
    expect(me.roles).toEqual(['planning', 'creative-director'])
    await ctx.close()
  })

  test(at('screenshots of each desk and a later-phase door'), async ({ browser }) => {
    test.skip(!shots, 'set NAPKIN_E2E_SHOTS=<dir> to write them')
    const seed = await signedIn(browser, size, PEOPLE.management)
    const job = await seedJ001(seed.page)
    for (const [title, app, patch] of [['Spring brief', 'ie.napkin.brief-maker', CONTEST], ['Territories research', 'ie.napkin.campaign-research', CONTEST]] as const) {
      const r = await seed.page.request.post(`${job.api}/documents`, { data: { app_id: app, title, client_id: job.client } })
      const v = await r.json() as { token: string }
      await seed.page.request.post(`/s/${v.token}/patch-data`, { data: { agent: 'human', action: 'seed the test document', patch } })
    }
    await seed.ctx.close()
    const take = async (who: { username: string }, hash: string, name: string) => {
      const { ctx, page } = await signedIn(browser, size, who)
      await page.goto(`/${hash}`)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${shots}/${name}-${size.tag}.png`, fullPage: true })
      await ctx.close()
    }
    await take(PEOPLE.planning, '', 'home-planning')
    await take(PEOPLE.creativeDirector, '', 'home-creative-director')
    await take(PEOPLE.accountService, '', 'home-account-service')
    await take(PEOPLE.management, '', 'home-management')
    await take(PEOPLE.planningAndCreative, '', 'home-merged-planning-creative')
    await take(PEOPLE.admin, '', 'home-admin-switcher')
    await take(PEOPLE.planning, '#door-client-brains', 'door-client-brains-soon')
  })
}
