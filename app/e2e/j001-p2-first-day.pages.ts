// First day for the suite's axe, 44 px and em dash checks (tests 72 and 73): the invite on a person's row of the People page, and the
// desk of an invited person with a pointer open.
import { expect } from '@playwright/test'
import { signIn } from './pilot'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  {
    name: 'people, an invite',
    // an agency's own admin: the Napkin admin's list carries a NAPKIN ADMIN tag whose contrast axe flags on the People page already
    as: PEOPLE.newAgencyAdmin2,
    show: async page => {
      await page.goto('/')
      await expect(page.getByTestId('desk')).toBeVisible()
      await page.getByTestId('account-button').click()
      await page.getByRole('menuitem', { name: /^People/ }).click()
      await expect(page.getByTestId('people-list')).toBeVisible()
      await page.getByTestId('person-invite-open').first().click()
      await expect(page.getByTestId('people-invite')).toBeVisible()
    },
  },
  {
    name: 'desk, first pointer',
    as: PEOPLE.admin,
    show: async page => {
      // the admin adds and invites a person, who signs in and sees the pointers
      const username = `pg${Math.random().toString(36).slice(2, 8)}@napkin`
      expect((await page.request.post('/api/admin/people', { data: { username, name: 'Pointer Test', roles: ['copywriter'] } })).status()).toBe(201)
      expect((await page.request.post(`/api/admin/people/${username}/first-day`, { data: {} })).status()).toBe(201)
      await signIn(page, { username })
      await page.goto('/')
      await expect(page.getByTestId('desk')).toBeVisible()
      await expect(page.getByTestId('pointer')).toBeVisible()
    },
  },
]
