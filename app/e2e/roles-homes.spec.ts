// Roles on the desk (features/align-landing-look.clan, which took over features/roles-and-homes.clan): everyone lands on the
// desk; a role adds one row of page doors under the greeting ("Your pages", at most five, the rest under More) and
// filters the tools the Dial offers; an admin tries a role through the account menu's View as; a door with no
// page yet opens the SoonCard; the old role-home and O addresses fall to the desk; a person with no role keeps the desk
// with no row. Run on the roster server (stack.mjs: the placeholder people of seed/j001/people.mjs, with their roles),
// at 390 and 1440 px. Clients are placeholders.
//
// With NAPKIN_E2E_SHOTS=<dir> it also writes a screenshot of the desk for each role and a page door's SoonCard:
//   NAPKIN_E2E_SHOTS=docs/design/align-landing-look npm run e2e -- roles-homes

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
const row = async (page: Page) => { await expect(page.getByTestId('desk')).toBeVisible(); return names(page, 'page-door') }

for (const size of SIZES) {
  const at = (title: string) => `${title}, ${size.tag} px`

  test(at('a person with two roles gets one merged row of five pages, the rest under More'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planningAndCreative)
    await page.goto('/')
    await expect(page.getByTestId('desk')).toBeVisible()
    await expect(page.getByTestId('page-door')).toHaveCount(5)
    expect(await row(page)).toEqual(['Client brains', 'Ready for review', 'Judge scores', 'Approved work', 'Direction notes'])
    await expect(page.getByTestId('your-pages').getByRole('heading', { name: 'Your pages' })).toBeVisible()
    await page.getByTestId('pages-more').click()
    const more = await names(page, 'more-page')
    for (const left of ['Traffic board (read only)', 'Case study builder (read only)']) expect(more).toContain(left)
    expect(more.filter(m => m === 'Client brains')).toHaveLength(0)
    await ctx.close()
  })

  test(at('no desk draws more than five page doors, whoever signs in'), async ({ browser }) => {
    for (const who of [PEOPLE.planning, PEOPLE.creativeDirector, PEOPLE.accountService, PEOPLE.management, PEOPLE.planningAndCreative, PEOPLE.admin]) {
      const { ctx, page } = await signedIn(browser, size, who)
      await page.goto('/')
      await expect(page.getByTestId('desk')).toBeVisible()
      await expect(page.getByTestId('home')).toHaveCount(0)
      expect(await page.getByTestId('page-door').count(), who.username).toBeLessThanOrEqual(5)
      await expect(page.getByTestId('client-circle').or(page.getByTestId('add-client')).first()).toBeVisible()
      await ctx.close()
    }
  })

  test(at('View as is in the account menu for an admin and not for Planning, and changes the row'), async ({ browser }) => {
    const planner = await signedIn(browser, size, PEOPLE.planning)
    await planner.page.goto('/')
    await expect(planner.page.getByTestId('desk')).toBeVisible()
    await planner.page.getByTestId('account-button').click()
    await expect(planner.page.getByRole('menuitem', { name: /People/ })).toHaveCount(0)
    await expect(planner.page.getByRole('menuitem', { name: /View as/ })).toHaveCount(0)
    await planner.ctx.close()

    const { ctx, page } = await signedIn(browser, size, PEOPLE.admin)
    await page.goto('/')
    expect(await row(page)).toEqual(['Agency dashboard', 'Live jobs', 'Time and money', 'Traffic board', 'People'])
    await page.getByTestId('account-button').click()
    await page.getByRole('menuitem', { name: /View as/ }).click()
    await page.getByTestId('role-switcher').selectOption('copywriter')
    await expect(page.getByTestId('page-door')).toHaveText(['Radio', 'Video and motion', 'Formats and in situ'])
    await expect(page).toHaveURL(/#agency$|\/$/)
    await page.getByTestId('account-button').click()
    await page.getByRole('menuitem', { name: /View as/ }).click()
    await page.getByTestId('role-switcher').selectOption('')
    await expect(page.getByTestId('page-door')).toHaveText(['Agency dashboard', 'Live jobs', 'Time and money', 'Traffic board', 'People'])
    await ctx.close()
  })

  test(at('the O and the role homes are gone: their old addresses are the desk'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.admin)
    for (const old of ['#map', '#home-creative-director', '#home-planning']) {
      await page.goto(`/${old}`)
      await page.reload()
      await expect(page.getByTestId('desk')).toBeVisible()
      await expect(page.getByTestId('the-o')).toHaveCount(0)
      await expect(page.getByTestId('home')).toHaveCount(0)
      expect(await page.evaluate(() => location.hash)).toMatch(/^(#agency)?$/)
    }
    await ctx.close()
  })

  test(at('Client brains, with no page yet, opens the SoonCard and not an error, and Back goes to the desk'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    await page.goto('/')
    await page.getByTestId('page-door').filter({ hasText: 'Client brains' }).click()
    await expect(page.getByTestId('door-page')).toBeVisible()
    await expect(page.locator('[data-state="empty"]')).toBeVisible()
    await expect(page.locator('[data-state="empty"]')).toContainText('What the agency knows about one client goes here.')
    await expect(page.locator('.ch-banner')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    if (shots) await page.screenshot({ path: `${shots}/door-client-brains-${size.tag}.png`, fullPage: true, mask: [page.getByTestId('agency-pill')], maskColor: '#C8CBFF' })
    await page.getByTestId('to-home').click()
    await expect(page.getByTestId('desk')).toBeVisible()
    await ctx.close()
  })

  test(at('the Dial offers the tools of the role: a planner has Brief, Research and Deck, a copywriter has Deck only'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    const job = await seedJ001(page)
    await page.goto('/')
    await page.getByTestId('client-circle').first().click()
    await expect(page.getByTestId('dial')).toBeVisible()
    await expect(page.getByTestId('quadrant-brief')).toHaveCount(1)
    await expect(page.getByTestId('quadrant-research')).toHaveCount(1)
    await expect(page.getByTestId('quadrant-deck')).toHaveCount(1)
    await expect(page.getByTestId('quadrant-prod')).toHaveCount(0)
    await page.getByTestId('quadrant-brief').click()
    await expect(page).toHaveURL(new RegExp(`#tool-${job.client}-brief$`))
    await ctx.close()

    const cw = await signedIn(browser, size, PEOPLE.copywriter)
    await cw.page.goto('/')
    const { tenant } = await (await cw.page.request.get('/api/session')).json() as { tenant: string }
    await cw.page.request.post(`/api/t/${tenant}/clients`, { data: { name: 'Client A' } })
    await cw.page.reload()
    await cw.page.getByTestId('client-circle').first().click()
    await expect(cw.page.getByTestId('dial')).toBeVisible()
    await expect(cw.page.getByTestId('quadrant-deck')).toHaveCount(1)
    for (const gone of ['brief', 'research', 'prod']) await expect(cw.page.getByTestId(`quadrant-${gone}`), gone).toHaveCount(0)
    // a tool the role is not offered is not its address either: the client's page answers instead
    const id = (await (await cw.page.request.get(`/api/t/${tenant}/clients`)).json() as { id: string }[])[0].id
    await cw.page.goto(`/#tool-${id}-brief`)
    await cw.page.reload()
    await expect(cw.page).toHaveURL(new RegExp(`#client-${id}$`))
    await expect(cw.page.getByTestId('group-brief')).toHaveCount(0)
    await cw.ctx.close()
  })

  test(at('a person with no role keeps the desk, and the server refuses them nothing'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.noRole)
    await page.goto('/')
    await expect(page.getByTestId('desk')).toBeVisible()
    await expect(page.getByTestId('home')).toHaveCount(0)
    await expect(page.getByTestId('your-pages')).toHaveCount(0)
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

  test(at('screenshots of the desk for each role'), async ({ browser }) => {
    test.skip(!shots, 'set NAPKIN_E2E_SHOTS=<dir> to write them')
    const seed = await signedIn(browser, size, PEOPLE.management)
    const job = await seedJ001(seed.page)
    for (const [title, app, patch] of [['Spring brief', 'ie.napkin.brief-maker', CONTEST], ['Territories research', 'ie.napkin.campaign-research', CONTEST]] as const) {
      const r = await seed.page.request.post(`${job.api}/documents`, { data: { app_id: app, title, client_id: job.client } })
      const v = await r.json() as { token: string }
      await seed.page.request.post(`/s/${v.token}/patch-data`, { data: { agent: 'human', action: 'seed the test document', patch } })
    }
    await seed.ctx.close()
    const take = async (who: { username: string }, name: string) => {
      const { ctx, page } = await signedIn(browser, size, who)
      await page.goto('/')
      await expect(page.getByTestId('desk')).toBeVisible()
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${shots}/${name}-${size.tag}.png`, fullPage: true, mask: [page.getByTestId('agency-pill')], maskColor: '#C8CBFF' })
      await ctx.close()
    }
    await take(PEOPLE.planning, 'desk-planning')
    await take(PEOPLE.creativeDirector, 'desk-creative-director')
    await take(PEOPLE.accountService, 'desk-account-service')
    await take(PEOPLE.management, 'desk-management')
    await take(PEOPLE.planningAndCreative, 'desk-merged-planning-creative')
    await take(PEOPLE.admin, 'desk-admin')
    await take(PEOPLE.noRole, 'desk-no-role')
  })
}
