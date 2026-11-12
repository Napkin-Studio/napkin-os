// The job page and Live jobs for the suite's axe, 44 px and em dash checks (tests 72 and 73), as account service reads them.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  { name: 'job page', as: PEOPLE.accountService, show: async (page, { job }) => { await page.goto('/'); await page.goto(`/#job-${job.job}`); await page.reload(); await expect(page.getByTestId('job-file')).toBeVisible() } },
  { name: 'live jobs', as: PEOPLE.accountService, show: async page => { await page.goto('/'); await page.goto('/#door-live-jobs'); await page.reload(); await expect(page.getByTestId('live-jobs')).toBeVisible() } },
]
