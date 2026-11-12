// Needs you for the suite's axe, 44 px and em dash checks (tests 72 and 73): the planner's home, where a job's brief waits for a signature.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  { name: 'needs you', as: PEOPLE.planning, show: async page => { await page.goto('/'); await page.reload(); await expect(page.getByTestId('needs-you').or(page.getByTestId('needs-empty'))).toBeVisible() } },
]
