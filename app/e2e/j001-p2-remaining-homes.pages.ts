// The five Phase 2 homes, for tests 72 and 73 (axe in three modes, 44 px buttons at 390 px, no em dash). The remaining-homes record
// adds the pages of the doors it builds here.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

const home = async (page: import('@playwright/test').Page) => { await page.goto('/'); await expect(page.getByTestId('home')).toBeVisible() }

export const PAGES: Phase2Page[] = (['artDirector', 'copywriter', 'producer', 'agencyBrain', 'traffic'] as const)
  .map(who => ({ name: `home of ${who}`, as: PEOPLE[who], show: home }))
