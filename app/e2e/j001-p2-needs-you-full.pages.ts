// Needs you for the suite's axe, 44 px and em dash checks (tests 72 and 73): the planner's desk on Me, where a job's brief waits for a signature.
import { expect } from '@playwright/test'
import { openMe } from './needs'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

export const PAGES: Phase2Page[] = [
  { name: 'needs you', as: PEOPLE.planning, show: async page => { await openMe(page); await expect(page.getByTestId('me-row').or(page.getByTestId('needs-empty')).first()).toBeVisible() } },
]
