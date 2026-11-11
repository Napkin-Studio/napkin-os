// Roles and homes (features/roles-and-homes.clan): the doors each role lands on, the merged home of a
// person with two roles, the role switcher, the O as a map, a later-phase door opening its Empty state,
// and a person with no role keeping the desk. Run on the roster server (stack.mjs: the placeholder
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

  test(at('a person with two roles gets one merged home of five doors, the rest under More tools'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planningAndCreative)
    await page.goto('/')
    await expect(page.getByTestId('door')).toHaveCount(5)
    expect(await names(page, 'door')).toEqual(['Brief', 'Ideas', 'Research', 'Ready for review', 'Territories'])
    const more = await names(page, 'more-tool')
    for (const left of ['Judge scores', 'Client brains', 'Presentations', 'Approved work', 'Direction notes']) expect(more).toContain(left)
    await expect(page.getByTestId('home-eyebrow')).toHaveText('PLANNING AND CREATIVE DIRECTOR · HOME')
    await ctx.close()
  })

  test(at('no home draws more than five doors, and Needs you opens each home'), async ({ browser }) => {
    for (const who of [PEOPLE.planning, PEOPLE.creativeDirector, PEOPLE.accountService, PEOPLE.management, PEOPLE.planningAndCreative, PEOPLE.admin]) {
      const { ctx, page } = await signedIn(browser, size, who)
      await page.goto('/')
      await expect(page.getByTestId('home')).toBeVisible()
      expect(await page.getByTestId('door').count(), who.username).toBeLessThanOrEqual(5)
      await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'More tools' })).toBeVisible()
      await ctx.close()
    }
  })

  test(at('the role switcher shows for an admin and not for Planning'), async ({ browser }) => {
    const planner = await signedIn(browser, size, PEOPLE.planning)
    await planner.page.goto('/')
    await expect(planner.page.getByTestId('home')).toBeVisible()
    await expect(planner.page.getByTestId('role-switcher')).toHaveCount(0)
    await planner.ctx.close()

    const { ctx, page } = await signedIn(browser, size, PEOPLE.admin)
    await page.goto('/')
    await expect(page.getByTestId('role-switcher')).toBeVisible()
    await page.getByTestId('role-switcher').selectOption('copywriter')
    await expect(page.getByTestId('door')).toHaveText(['Ideas', 'Script editor', 'Radio', 'Video and motion', 'Formats and in situ'])
    await expect(page).toHaveURL(/#home-copywriter$/)
    await page.getByTestId('role-switcher').selectOption('')
    await expect(page.getByTestId('door')).toHaveText(['Agency dashboard', 'Live jobs', 'Time and money', 'Clients', 'Traffic board'])
    await ctx.close()
  })

  test(at('the O: with seven departments open to an admin, five circles render and two are in Other departments'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.admin)
    await page.goto('/#map')
    await expect(page.getByTestId('the-o')).toBeVisible()
    await expect(page.getByTestId('o-circle')).toHaveCount(5)
    await expect(page.getByTestId('other-department')).toHaveCount(2)
    expect(await names(page, 'o-circle')).toEqual(['Management', 'Clients', 'Account service', 'Planning', 'Creative'])
    expect(await names(page, 'other-department')).toEqual(['Production', 'Agency Brain'])
    await expect(page.getByTestId('o-circle').first()).toHaveAttribute('data-mine', 'true') // the person's own first
    await expect(page.getByTestId('o-logo')).toBeVisible()
    // a circle opens that department's home
    await page.getByTestId('o-circle').filter({ hasText: 'Creative' }).click()
    await expect(page.getByTestId('door')).toHaveText(['Ideas', 'Ready for review', 'Judge scores', 'Approved work', 'Direction notes'])
    await ctx.close()
  })

  test(at('the O is a map, not the landing: a planner lands on a home and finds one circle'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    await page.goto('/')
    await expect(page.getByTestId('home')).toBeVisible()
    await expect(page.getByTestId('the-o')).toHaveCount(0)
    await page.getByTestId('open-map').click()
    await expect(page.getByTestId('o-circle')).toHaveCount(1)
    await expect(page.getByTestId('o-circle')).toHaveText('Planning')
    await expect(page.getByTestId('other-department')).toHaveCount(0)
    await ctx.close()
  })

  test(at('Client brains, whose tool comes in a later phase, opens an Empty state and not an error'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    await page.goto('/')
    await page.getByTestId('door').filter({ hasText: 'Client brains' }).click()
    await expect(page.getByTestId('door-page')).toBeVisible()
    await expect(page.locator('[data-state="empty"]')).toBeVisible()
    await expect(page.locator('[data-state="empty"]')).toContainText('What the agency knows about one client goes here.')
    await expect(page.locator('.ch-banner')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByTestId('to-home').click()
    await expect(page.getByTestId('home')).toBeVisible()
    await ctx.close()
  })

  test(at('Brief, whose tool exists, asks which client and opens that client\'s tool'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.planning)
    const job = await seedJ001(page)
    await page.goto('/')
    await page.getByTestId('door').filter({ hasText: /^Brief$/ }).click()
    await expect(page.getByTestId('door-client').first()).toBeVisible()
    await page.getByTestId('door-client').filter({ hasText: 'Client A' }).first().click()
    await expect(page).toHaveURL(new RegExp(`#tool-${job.client}-brief$`))
    await ctx.close()
  })

  test(at('a person with no role keeps the desk, and the server refuses them nothing'), async ({ browser }) => {
    const { ctx, page } = await signedIn(browser, size, PEOPLE.noRole)
    await page.goto('/')
    await expect(page.getByTestId('desk')).toBeVisible()
    await expect(page.getByTestId('home')).toHaveCount(0)
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

  test(at('screenshots of each home, the O and a later-phase door'), async ({ browser }) => {
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
    await take(PEOPLE.admin, '#map', 'the-o-admin')
    await take(PEOPLE.planning, '#map', 'the-o-planning')
    await take(PEOPLE.planning, '#door-client-brains', 'door-client-brains-empty')
    await take(PEOPLE.planning, '#door-brief', 'door-brief-clients')
  })
}
