// The Approvals page for the suite's axe, 44 px and em dash checks (tests 72 and 73), as account service reads it.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  { name: 'approvals', as: PEOPLE.accountService, show: async page => { await page.goto('/'); await page.goto('/#door-approvals'); await page.reload(); await expect(page.getByTestId('approvals')).toBeVisible() } },
]
