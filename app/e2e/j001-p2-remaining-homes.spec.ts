// Phase 2 acceptance, record `remaining-homes` (features/remaining-homes.clan): tests 19 and 20 of
// docs/design/phase2-acceptance.md at 390 and 1440 px, then the design's own shell tests: S10 (a door with no tool opens
// its Empty state), S11 (the O) and the axe and 44 px check of each new home in the three modes.
// Run on the roster stack (stack.mjs), whose placeholder people are in seed/j001/people.mjs. No model is called.
//
//   NAPKIN_E2E_SHOTS=docs/design/remaining-homes npm run e2e -- j001-p2-remaining-homes
//
// Titles read `N short, W px`, the form the suite's registry (phase2/tests.mjs) and counter (phase2/count.mjs) read.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001'

type Size = { tag: string; width: number; height: number }
const SIZES: Size[] = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]
const MODES = ['white', 'grey', 'black'] as const
const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`
const shots = process.env.NAPKIN_E2E_SHOTS

const SHORT: Record<number, string> = {
  19: 'the five Phase 2 roles see their own doors',
  20: 'a copywriter gets 403 on Proprietary data and two roles merge to five doors',
}

/** The v2 section 4 doors table for the five roles, in order. */
const HOMES = {
  artDirector: {
    doors: ['Ideas', 'Stills', 'Video and motion', 'Formats and in situ', 'Shopper stands'],
    more: ['Experiential', 'Presentations', 'Craft review'],
  },
  copywriter: {
    doors: ['Ideas', 'Script editor', 'Radio', 'Video and motion', 'Formats and in situ'],
    more: ['Shopper stands', 'Experiential', 'Presentations', 'Craft review'],
  },
  producer: {
    doors: ['Live jobs', 'Video and motion', 'Radio', 'Scope and estimates', 'Timetables'],
    more: ['Formats and in situ', 'Shopper stands', 'Traffic board'],
  },
  agencyBrain: {
    doors: ['Client brains', 'Pitches', 'Awards', 'Case studies', 'Proprietary data'],
    more: ['Judge scores (read only)', 'Job memory'],
  },
  traffic: {
    doors: ['Traffic board', 'Timesheets', 'Resources', 'Live jobs', 'Timetables'],
    more: ['Scope and estimates (read only)'],
  },
} as const
type Who = keyof typeof HOMES
const WHO = Object.keys(HOMES) as Who[]
const SLUG: Record<Who, string> = { artDirector: 'art-director', copywriter: 'copywriter', producer: 'producer', agencyBrain: 'agency-brain', traffic: 'traffic' }

async function open(browser: Browser, size: Size, mode = 'white'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: rosterURL, viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript(m => { try { localStorage.setItem('napkin.theme', m) } catch { /* not kept */ } }, mode)
  return { ctx, page: await ctx.newPage() }
}

async function signIn(page: Page, who: { username: string }) {
  const r = await page.request.post('/api/auth/sign-in', { data: { username: who.username } })
  expect(r.status(), `sign in as ${who.username}`).toBe(200)
}

const texts = (page: Page, id: string) => page.getByTestId(id).allInnerTexts()

for (const size of SIZES) {
  const t = (n: number) => `${n} ${SHORT[n]}, ${size.tag} px`

  test(t(19), async ({ browser }) => {
    for (const role of WHO) {
      const { ctx, page } = await open(browser, size)
      await signIn(page, PEOPLE[role])
      await page.goto('/')
      await expect(page.getByTestId('home')).toBeVisible()
      await expect(page.getByTestId('door')).toHaveCount(5)
      expect(await texts(page, 'door'), `${role} doors`).toEqual([...HOMES[role].doors])
      expect(await texts(page, 'more-tool'), `${role} More tools`).toEqual([...HOMES[role].more])
      await ctx.close()
    }
  })

  test(t(20), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.copywriter)
    const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
    // Proprietary data is the Agency Brain's alone (roles.rs Group::Proprietary).
    expect((await page.request.get(`/api/t/${tenant}/proprietary`)).status()).toBe(403)
    expect((await page.request.get(`/api/t/${tenant}/proprietary/rates`)).status()).toBe(403)
    await ctx.close()
    // The Agency Brain opens it: past the role check, so anything but 403.
    const brain = await open(browser, size)
    await signIn(brain.page, PEOPLE.agencyBrain)
    const b = (await (await brain.page.request.get('/api/session')).json()) as { tenant: string }
    expect((await brain.page.request.get(`/api/t/${b.tenant}/proprietary`)).status()).not.toBe(403)
    await brain.ctx.close()
    // A Phase 1 role and a Phase 2 role: one merged home of five doors, planning's first, then the copywriter's.
    const merged = await open(browser, size)
    await signIn(merged.page, PEOPLE.planningAndCopywriter)
    await merged.page.goto('/')
    await expect(merged.page.getByTestId('door')).toHaveCount(5)
    const doors = await texts(merged.page, 'door')
    expect(doors).toEqual(['Brief', 'Ideas', 'Research', 'Script editor', 'Territories'])
    expect(new Set(doors).size, 'no door twice').toBe(5)
    const more = await texts(merged.page, 'more-tool')
    expect(more, 'no door is also in More tools').toEqual(expect.not.arrayContaining(doors))
    for (const left of ['Client brains', 'Radio', 'Presentations']) expect(more).toContain(left)
    await expect(merged.page.getByTestId('home-eyebrow')).toHaveText('PLANNING AND COPYWRITER · HOME')
    await merged.ctx.close()
  })

  const at = (title: string) => `remaining-homes: ${title}, ${size.tag} px`

  test(at('S10 a door with no tool opens its own Empty state, and says the tool comes later'), async ({ browser }) => {
    const { ctx, page } = await open(browser, size)
    await signIn(page, PEOPLE.copywriter)
    await page.goto('/')
    const cases: [string, string, string, string][] = [
      ['Radio', 'Radio spots go here, from script to finished audio.', 'Start a spot', 'Spot: 30 seconds, script approved, voice booked for Thursday.'],
      ['Formats and in situ', 'Each format goes here, with the work placed where it will run.', 'Place a format', 'Format: a poster at a bus stop, the half shut door, one line below it.'],
      // The Script editor had its Empty state here until its record built the tool (features/script-editor.clan); its door opens the tool now.
    ]
    for (const [name, line, verb, example] of cases) {
      await page.goto('/')
      await page.getByTestId('door').filter({ hasText: new RegExp(`^${name}$`) }).click()
      const door = page.getByTestId('door-page')
      await expect(door).toBeVisible()
      await expect(page.getByTestId('door-title')).toContainText(name)
      const empty = door.locator('[data-state="empty"]')
      await expect(empty).toContainText(line)
      await expect(empty).toContainText(example)
      await expect(empty).toContainText('Client A, an Irish whiskey')
      await expect(empty).toContainText('This tool comes in a later phase')
      await expect(empty.getByRole('button')).toHaveCount(1)
      await expect(empty.getByText(verb, { exact: true })).toBeVisible()
      await expect(door.getByRole('alert')).toHaveCount(0)
      if (shots && name === 'Radio') await page.screenshot({ path: `${shots}/door-radio-${size.tag}.png` })
    }
    // a More tools line opens its own Empty state too
    await page.goto('/')
    await page.getByTestId('more-tool').filter({ hasText: 'Craft review' }).click()
    await expect(page.getByTestId('door-page').locator('[data-state="empty"]')).toContainText('Work waiting for a second eye on its craft goes here.')
    await ctx.close()
  })

  test(at('S11 the O shows at most five circles, the person\'s own first, and their own circle opens their own home'), async ({ browser }) => {
    const admin = await open(browser, size)
    await signIn(admin.page, PEOPLE.admin)
    await admin.page.goto('/#map')
    await expect(admin.page.getByTestId('o-circle')).toHaveCount(5)
    await expect(admin.page.getByTestId('other-department')).toHaveCount(2)
    await admin.ctx.close()
    for (const role of WHO) {
      const { ctx, page } = await open(browser, size)
      await signIn(page, PEOPLE[role])
      await page.goto('/#map')
      await expect(page.getByTestId('the-o')).toBeVisible()
      const count = await page.getByTestId('o-circle').count()
      expect(count, role).toBeGreaterThanOrEqual(1)
      expect(count, role).toBeLessThanOrEqual(5)
      await page.getByTestId('o-circle').first().click()
      await expect(page.getByTestId('home')).toBeVisible()
      expect(await texts(page, 'door'), `${role}: the first circle opens their own home`).toEqual([...HOMES[role].doors])
      if (shots && role === 'artDirector') { await page.goto('/#map'); await page.screenshot({ path: `${shots}/the-o-art-director-${size.tag}.png` }) }
      await ctx.close()
    }
  })

  test(at('each new home reads in White, Grey and Black with no serious axe finding, and its doors are 44 px targets'), async ({ browser }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    const problems: string[] = []
    for (const mode of MODES) {
      for (const role of WHO) {
        const { ctx, page } = await open(browser, size, mode)
        await signIn(page, PEOPLE[role])
        await page.goto('/')
        await expect(page.getByTestId('door')).toHaveCount(5)
        await page.waitForTimeout(700) // the page's own entrance finishes before it is read
        const found = (await new AxeBuilder({ page }).exclude('iframe').analyze()).violations
          .filter(v => v.impact === 'serious' || v.impact === 'critical')
        problems.push(...found.map(v => `${role} ${mode}: ${v.id} ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`))
        if (size.tag === '390') {
          for (const box of await page.getByTestId('door').evaluateAll(els => els.map(e => e.getBoundingClientRect()))) {
            if (box.height < 44 || box.width < 44) problems.push(`${role} ${mode}: a door is ${Math.round(box.width)} by ${Math.round(box.height)} px`)
          }
        }
        if (shots && mode === 'white') await page.screenshot({ path: `${shots}/home-${SLUG[role]}-${size.tag}.png`, fullPage: true })
        await ctx.close()
      }
    }
    expect(problems).toEqual([])
  })
}
