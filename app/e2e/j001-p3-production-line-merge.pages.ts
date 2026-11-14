// The pages of record `production-line-merge` for the Phase 3 suite's axe, 44 px and em dash checks (test 108): the Production Tool as
// the merge brings it, at /production, opened by the job's producer. Its screens are the UI track's (Shrey's); the rules that carry the
// platform's look onto them are record production-platform-rules, so test 108 may find work there when it is turned on.
import { expect, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Person } from './pilot'

export const PAGES: { name: string; as: Person; show: (page: Page) => Promise<void> }[] = [
  {
    name: 'production tool', as: PEOPLE.producer,
    show: async page => {
      await page.goto('/production/')
      await expect(page.locator('#root > *').first()).toBeVisible({ timeout: 30_000 })
    },
  },
]
