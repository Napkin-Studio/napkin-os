// Phase 2 acceptance, record `first-day` (features/first-day.clan): test 28 of docs/design/phase2-acceptance.md, and the record's own shell
// tests S17 to S19, at 390 and 1440 px. An admin invites a person already on the People page; the link carries the sign-in name and
// nothing else; the person signs in with one press, sees three pointers once, finds a real task first in Needs you and opens it.
// No model and no paid provider: the stand-in middleware answers from seed/j001/p2/answers/.

import { expect, test, type Browser, type Page } from '@playwright/test'
import { open, SIZES, signIn } from './pilot'
import { PEOPLE, seedJ001, type SeededJob } from './seed/j001'
import { INVITED, invitedFor, POINTERS } from './seed/j001/p2/first-day.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const short = (n: number) => PHASE2.find(x => x.n === n)!.short

type Who = { username: string; name: string; roles: string[] }

/** The admin adds the person the one way there is (the People page's route) and invites them; answers the link. */
async function invite(admin: Page, who: Who, job: SeededJob | null): Promise<string> {
  const added = await admin.request.post('/api/admin/people', { data: { username: who.username, name: who.name, roles: who.roles } })
  expect(added.status(), `add ${who.username}`).toBe(201)
  const r = await admin.request.post(`/api/admin/people/${who.username}/first-day`, { data: job ? { first: { path: job.brief.path } } : {} })
  expect(r.status(), `invite ${who.username}`).toBe(201)
  const { link } = await r.json() as { link: string }
  return link
}

/** A fresh browser opens the link: the sign-in name is filled, and one press signs the person in on the desk. */
async function arrive(browser: Browser, size: (typeof SIZES)[number], link: string, who: Who, mode = 'light') {
  const fresh = await open(browser, size, mode, { roster: true })
  await fresh.page.goto(link)
  const name = fresh.page.getByLabel('Sign-in name')
  await expect(name).toHaveValue(who.username)
  await fresh.page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(fresh.page.getByTestId('desk')).toBeVisible({ timeout: 30_000 })
  return fresh
}

const pointer = (page: Page) => page.getByTestId('pointer')
const sessionName = async (page: Page) => ((await (await page.request.get('/api/session')).json()) as { user: { username: string } }).user.username

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`
  const s = (id: string, words: string) => `${id} ${words}, ${size.tag} px`

  test(t(28), async ({ browser }) => {
    // An admin of the agency invites a copywriter; the invited person signs in for the first time.
    const admin = await open(browser, size, 'light', { roster: true })
    await signIn(admin.page, PEOPLE.admin)
    const job = await seedJ001(admin.page, { ready: true, fresh: true })
    const who = invitedFor(size.tag, '28')
    const link = await invite(admin.page, who, job)
    const fresh = await arrive(browser, size, link, who)
    expect(await sessionName(fresh.page)).toBe(who.username)
    // Three pointers, once, one at a time.
    await expect(pointer(fresh.page)).toHaveCount(1)
    await expect(pointer(fresh.page)).toHaveAttribute('data-anchor', 'pages')
    await pointer(fresh.page).getByRole('button', { name: 'Next' }).click()
    await expect(pointer(fresh.page)).toHaveAttribute('data-anchor', 'bar')
    await pointer(fresh.page).getByRole('button', { name: 'Next' }).click()
    await expect(pointer(fresh.page)).toHaveAttribute('data-anchor', 'needs')
    await pointer(fresh.page).getByRole('button', { name: 'Got it' }).click()
    await expect(pointer(fresh.page)).toHaveCount(0)
    expect(POINTERS).toBe(3)
    // Their first Needs you item is a real J001 task and it opens.
    const first = fresh.page.getByTestId('me-row').first()
    await expect(first).toContainText(job.job)
    await first.click()
    await expect(fresh.page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    // The second visit: the pointers do not show, and the task has gone.
    await fresh.page.goto('/'); await fresh.page.reload()
    await expect(fresh.page.getByTestId('desk')).toBeVisible()
    await expect(pointer(fresh.page)).toHaveCount(0)
    expect(INVITED.roles).toEqual(['copywriter'])
    await fresh.ctx.close(); await admin.ctx.close()
  })

  test(s('S17', 'an admin invites from the People page and the link opens sign-in with the name filled'), async ({ browser }) => {
    const admin = await open(browser, size, 'light', { roster: true })
    await signIn(admin.page, PEOPLE.admin)
    const job = await seedJ001(admin.page, { ready: true, fresh: true })
    const who = invitedFor(size.tag, '17')
    const added = await admin.page.request.post('/api/admin/people', { data: { username: who.username, name: who.name, roles: who.roles } })
    expect(added.status()).toBe(201)
    await admin.page.goto('/')
    await expect(admin.page.getByTestId('desk')).toBeVisible()
    await admin.page.getByTestId('account-button').click()
    await admin.page.getByRole('menuitem', { name: /^People/ }).click()
    await expect(admin.page.getByTestId('people-list')).toBeVisible()
    const row = admin.page.getByTestId('people-list').locator('tr', { hasText: who.username })
    await row.getByTestId('person-invite-open').click()
    const sheet = admin.page.getByTestId('people-invite')
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('First thing to open').selectOption(job.brief.path)
    await sheet.getByTestId('invite-make').click()
    const link = await sheet.getByTestId('invite-link').inputValue()
    expect(link).toContain(`welcome=${who.username}`)
    await sheet.getByRole('button', { name: 'Copy the link' }).click()
    await expect(sheet.getByTestId('invite-copied')).toBeVisible()
    // the link opens the sign-in screen with the name filled; nothing is signed in until the press
    const fresh = await open(browser, size, 'light', { roster: true })
    await fresh.page.goto(link)
    await expect(fresh.page.getByLabel('Sign-in name')).toHaveValue(who.username)
    expect((await fresh.page.request.get('/api/session')).status()).toBe(401)
    await fresh.page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(fresh.page.getByTestId('desk')).toBeVisible({ timeout: 30_000 })
    expect(await sessionName(fresh.page)).toBe(who.username)
    await fresh.ctx.close(); await admin.ctx.close()
  })

  test(s('S18', 'three pointers show once, never again, and read in light and dark'), async ({ browser }) => {
    const admin = await open(browser, size, 'light', { roster: true })
    await signIn(admin.page, PEOPLE.admin)
    const job = await seedJ001(admin.page, { ready: true, fresh: true })
    const who = invitedFor(size.tag, '18')
    const link = await invite(admin.page, who, job)
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    for (const mode of ['light', 'dark']) {
      // each mode is its own person, so the pointers are new to them
      const w = mode === 'light' ? who : invitedFor(size.tag, '18d')
      const l = mode === 'light' ? link : await invite(admin.page, w, job)
      const fresh = await arrive(browser, size, l, w, mode)
      await expect(pointer(fresh.page)).toHaveCount(1)
      const found = (await new AxeBuilder({ page: fresh.page }).exclude('iframe').analyze()).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      expect(found.map(v => `${v.id}: ${v.nodes[0]?.target}`), `${mode}: no serious finding with a pointer open`).toEqual([])
      // 44 px at 390
      if (size.width <= 480) {
        const box = await pointer(fresh.page).getByRole('button', { name: /Next|Got it/ }).first().boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
      }
      // Esc ends them all
      await fresh.page.keyboard.press('Escape')
      await expect(pointer(fresh.page)).toHaveCount(0)
      // a reload, and a second browser signed in as the same person: none
      await fresh.page.reload()
      await expect(fresh.page.getByTestId('desk')).toBeVisible()
      await expect(pointer(fresh.page)).toHaveCount(0)
      const second = await open(browser, size, mode, { roster: true })
      await signIn(second.page, w)
      await second.page.goto('/')
      await expect(second.page.getByTestId('desk')).toBeVisible()
      await expect(pointer(second.page)).toHaveCount(0)
      await second.ctx.close(); await fresh.ctx.close()
    }
    await admin.ctx.close()
  })

  test(s('S19', 'the first row is the J001 task and it opens inside two minutes, then is gone'), async ({ browser }) => {
    const admin = await open(browser, size, 'light', { roster: true })
    await signIn(admin.page, PEOPLE.admin)
    const job = await seedJ001(admin.page, { ready: true, fresh: true })
    const who = invitedFor(size.tag, '19')
    const link = await invite(admin.page, who, job)
    const started = Date.now()
    const fresh = await arrive(browser, size, link, who)
    await pointer(fresh.page).getByRole('button', { name: 'Got it' }).click()
    const first = fresh.page.getByTestId('me-row').first()
    await expect(first).toContainText(job.job)
    await first.click()
    await expect(fresh.page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
    expect((Date.now() - started) / 1000, 'seconds from the link to the document').toBeLessThan(120)
    // pressing its button took it off the list, and it does not come back
    await fresh.page.goto('/'); await fresh.page.reload()
    await expect(fresh.page.getByTestId('desk')).toBeVisible()
    await expect(fresh.page.getByTestId('me-row').filter({ hasText: job.job })).toHaveCount(0)
    const needs = await (await fresh.page.request.get(`/api/t/${(await (await fresh.page.request.get('/api/session')).json() as { tenant: string }).tenant}/needs`)).json() as { first_task: unknown }
    expect(needs.first_task).toBeNull()
    await fresh.ctx.close(); await admin.ctx.close()
  })
}
