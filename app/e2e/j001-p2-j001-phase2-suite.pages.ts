// The pages the suite scans from the first day (tests 72 and 73): the Phase 1 pages that exist on this branch. Each Phase 2
// record adds its own pages in its own j001-p2-<slug>.pages.ts. Pages that need a signed, confirmed brief (Territories) stay
// with pilot test 7. The app frame is a document with its own paper, so it is left out of the scan.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

const loaded = async (page: import('@playwright/test').Page, hash: string) => {
  await page.goto('/'); await page.goto(`/#${hash}`); await page.reload()
  await expect(page.getByTestId('os-bar')).toBeVisible()
}

export const PAGES: Phase2Page[] = [
  { name: 'home of the creative director', as: PEOPLE.creativeDirector, show: async page => { await page.goto('/'); await expect(page.getByTestId('home')).toBeVisible() } },
  { name: 'desk', as: PEOPLE.planning, show: page => loaded(page, 'agency') },
  { name: 'clients', as: PEOPLE.planning, show: page => loaded(page, 'clients') },
  { name: 'client', as: PEOPLE.planning, show: (page, { job }) => loaded(page, `client-${job.client}`) },
  { name: 'brief page', as: PEOPLE.planning, show: async (page, { job }) => { await loaded(page, `tool-${job.client}-brief`); await expect(page.getByTestId('work-item').first()).toBeVisible() } },
]
