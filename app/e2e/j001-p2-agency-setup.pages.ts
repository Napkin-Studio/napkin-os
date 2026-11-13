// The agency setup pages for the suite's axe, 44 px and em dash checks (tests 72 and 73): the flow's first step, its people step with a checked
// file (three bad rows listed), the people page of an agency that has people, and an admin's home with the setup card.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import { peopleCsv } from './seed/j001/p2/agency-setup.mjs'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  { name: 'setup, the logo step', as: PEOPLE.newAgencyAdmin, show: async page => { await page.goto('/'); await page.goto('/#setup'); await page.reload(); await expect(page.getByTestId('setup-step')).toBeVisible() } },
  {
    name: 'setup, a checked people file',
    as: PEOPLE.newAgencyAdmin,
    show: async page => {
      await page.goto('/'); await page.goto('/#setup'); await page.reload()
      await page.locator('[data-testid="setup-nav"][data-step="people"]').click()
      await page.getByTestId('setup-people-input').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(peopleCsv(30, 'cr')) })
      await expect(page.getByTestId('import-summary')).toBeVisible()
    },
  },
  {
    name: 'people',
    as: PEOPLE.newAgencyAdmin,
    show: async page => {
      // an agency with people to list: the first named also names the admin, so this stands on its own
      const { tenant } = (await (await page.request.get('/api/session')).json()) as { tenant: string }
      await page.request.post(`/api/t/${tenant}/agency/people/invite`, { data: { username: 'dan@cr', name: 'Dan Test', email: 'dan@mail.example.test', roles: ['planning'] } })
      await page.goto('/'); await page.goto('/#people'); await page.reload()
      await expect(page.getByTestId('people-list')).toBeVisible()
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
  { name: 'home of an admin, with the setup card', as: PEOPLE.admin, show: async page => { await page.goto('/'); await expect(page.getByTestId('desk')).toBeVisible() } },
]
