// The agency's pages for the suite's axe, 44 px and em dash checks (tests 72 and 73), as features/align-needs-lock-people.clan left them in
// stage 4: the People page (the dialog from the account menu) with its list and roles, its file import with a checked file (three bad rows listed),
// its roles editor, and the audit view. The setup flow and its card went; the People page is the one screen.
import { expect, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import { peopleCsv } from './seed/j001/p2/agency-setup.mjs'
import type { Phase2Page } from './phase2/pages'

async function people(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('desk')).toBeVisible()
  await page.getByTestId('account-button').click()
  await page.getByRole('menuitem', { name: /^People/ }).click()
  await expect(page.getByTestId('people-list')).toBeVisible()
}

export const PAGES: Phase2Page[] = [
  { name: 'people', as: PEOPLE.newAgencyAdmin, show: people },
  {
    name: 'people, a checked people file',
    as: PEOPLE.newAgencyAdmin,
    show: async page => {
      await people(page)
      await page.getByTestId('people-import-open').click()
      await page.getByTestId('people-import-input').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(peopleCsv(30, 'cr')) })
      await expect(page.getByTestId('import-summary')).toBeVisible()
    },
  },
  {
    name: 'people, adding a person',
    as: PEOPLE.newAgencyAdmin,
    show: async page => {
      await people(page)
      await page.getByRole('button', { name: 'Add a person', exact: true }).click()
      await expect(page.getByTestId('roles-picker')).toBeVisible()
    },
  },
  {
    name: 'audit',
    as: PEOPLE.newAgencyAdmin,
    show: async page => {
      await page.goto('/'); await page.goto('/#audit'); await page.reload()
      await expect(page.getByTestId('audit-page')).toBeVisible()
      await expect(page.getByTestId('audit-list').or(page.getByTestId('audit-none')).or(page.getByTestId('audit-page').getByText(/Nothing has been signed/))).toBeVisible()
    },
  },
  { name: 'home of an admin', as: PEOPLE.admin, show: async page => { await page.goto('/'); await expect(page.getByTestId('desk')).toBeVisible() } },
]
