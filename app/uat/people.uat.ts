// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// People (features/people-admin.clan): adding someone to sign-in from the People page, on UAT.
// The owner allowed engineer@napkin (his own account) for this one check only (2026-11-12);
// everything else in the suite stays on mock accounts. The test person is removed at the end
// whatever happens, so a failed round never leaves an extra account behind.

import { test, expect, type Browser, type Page } from '@playwright/test'
import { measure } from './helpers'

test.describe.configure({ mode: 'serial' })

const ADMIN = 'engineer@napkin'
const NON_ADMIN = 'plu@pluto'
// One test person per round, in the Pluto agency (an agency with its own look).
const ID = `uat${(process.env.UAT_CLIENT || '').replace(/\D/g, '').slice(-8) || 'probe'}`
const PERSON = `${ID}@pluto`
const NAME = 'UAT Probe'

async function signInAs(browser: Browser, who: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/')
  await page.getByPlaceholder('name@agency').fill(who)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const notice = page.getByRole('button', { name: 'I understand' })
  const desk = page.getByRole('heading', { name: /^Clients/ })
  await expect(desk.or(notice).first(), `${who} signs in`).toBeVisible({ timeout: 30_000 })
  if (await notice.isVisible()) await notice.click()
  await expect(desk).toBeVisible({ timeout: 30_000 })
  return { page, close: () => ctx.close() }
}

async function openPeople(page: Page) {
  await page.getByTestId('account-button').click()
  const menu = page.getByTestId('account-menu')
  await expect(menu).toBeVisible()
  await menu.locator('button, [role=menuitem]').filter({ hasText: /^People/ }).first().click()
  const people = page.getByTestId('people-page')
  await expect(people, 'the People page opens for the admin').toBeVisible({ timeout: 15_000 })
  // The list loads after the page opens; reading it before then finds no one (first run, 2026-11-13).
  await expect(people.getByText(/Reading who can sign in/), 'the list of people loads').toHaveCount(0, { timeout: 15_000 })
  return people
}

async function removeIfThere(browser: Browser) {
  const { page, close } = await signInAs(browser, ADMIN)
  try {
    const people = await openPeople(page)
    await people.getByPlaceholder('Find a person or agency').fill(ID)
    const row = people.getByRole('row').filter({ hasText: PERSON })
    if (await row.count()) {
      await row.getByRole('button', { name: 'Remove' }).click()
      await page.getByRole('alertdialog', { name: 'Remove a person' }).getByRole('button', { name: 'Remove' }).click()
      await expect(row, `${PERSON} is gone from the list`).toHaveCount(0, { timeout: 15_000 })
    }
  } finally { await close() }
}

test.afterAll(async ({ browser }) => { await removeIfThere(browser).catch(() => {}) })

test('people: the admin adds a person by name and agency, in the Napkin look', async ({ browser }) => {
  await removeIfThere(browser)   // a person left by an earlier failed round
  const { page, close } = await signInAs(browser, ADMIN)
  try {
    const t0 = Date.now()
    const people = await openPeople(page)
    await expect(people, 'the People page always wears the Napkin look').toHaveAttribute('data-look', 'napkin')
    await people.getByRole('button', { name: 'Add a person' }).click()
    await page.locator('#pa-nm').fill(NAME)
    await page.locator('#pa-ag').fill('pluto')
    await expect(page.getByTestId('agency-card'), 'the agency is recognised as Pluto').toHaveAttribute('data-agency', 'pluto')
    await expect(page.locator('#pa-em'), 'the sign-in name is made from the name and agency').toHaveValue(/@pluto$/)
    await page.locator('#pa-em').fill(PERSON)
    await page.getByTestId('people-add').getByRole('button', { name: 'Add', exact: true }).click()
    await expect(people.getByText(PERSON).first(), 'the new person is listed').toBeVisible({ timeout: 15_000 })
    measure('people-add', Date.now() - t0, 15_000)
  } finally { await close() }
})

test('people: the new person signs in at once, in their agency\'s look, and is not an admin', async ({ browser }) => {
  const t0 = Date.now()
  const { page, close } = await signInAs(browser, PERSON)
  try {
    measure('people-new-sign-in', Date.now() - t0, 5_000)
    const me = await page.evaluate(() => fetch('/api/session').then(r => r.json()))
    expect(me.user?.username, 'signed in as the new person, with no redeploy').toBe(PERSON)
    expect(me.user?.agency, 'in the Pluto agency').toBe('pluto')
    const status = await page.evaluate(() => fetch('/api/admin/people').then(r => r.status))
    expect(status, 'a person who is not the admin is refused the admin routes').toBe(403)
  } finally { await close() }
})

test('people: anyone but the admin has no People in the account menu', async ({ browser }) => {
  const { page, close } = await signInAs(browser, NON_ADMIN)
  try {
    await page.getByTestId('account-button').click()
    const menu = page.getByTestId('account-menu')
    await expect(menu).toBeVisible()
    await expect(menu.locator('button, [role=menuitem]').filter({ hasText: /^People/ }), 'no People entry for a non-admin').toHaveCount(0)
  } finally { await close() }
})

test('people: the admin removes the person, and they can no longer sign in', async ({ browser }) => {
  await removeIfThere(browser)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  try {
    await page.goto('/')
    await page.getByPlaceholder('name@agency').fill(PERSON)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText(/not on this studio.s list/i), 'a removed person is refused at sign-in').toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /^Clients/ })).toHaveCount(0)
  } finally { await ctx.close() }
})
