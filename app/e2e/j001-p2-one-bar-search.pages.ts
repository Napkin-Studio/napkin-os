// The one bar, drawn open, for the suite's axe, 44 px and em dash checks (tests 72 and 73) in light and dark. The bar has no field (Cmd K and the account
// menu open it); these show the panel: with results, with none, with the empty bar's doors,
// a person's card is left to the Rust suite (no directory in the roster stack), and the shortcuts sheet.
import { expect } from '@playwright/test'
import { PEOPLE } from './seed/j001'
import type { Phase2Page } from './phase2/pages'

type Pg = import('@playwright/test').Page
const phone = (page: Pg) => (page.viewportSize()?.width ?? 1440) <= 720
const loaded = async (page: Pg) => {
  await page.goto('/'); await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page.getByTestId('os-bar')).toBeVisible()
}
const openBar = async (page: Pg) => {
  await page.keyboard.press('Meta+k')
  await expect(page.getByTestId('bar-search-input')).toBeFocused()
}

export const PAGES: Phase2Page[] = [
  { name: 'the empty bar, open', as: PEOPLE.planning, show: async page => { await loaded(page); await openBar(page); await expect(page.getByTestId('bar-result').first()).toBeVisible() } },
  { name: 'the bar, open with results', as: PEOPLE.planning, show: async (page, { job }) => { await loaded(page); await openBar(page); await page.getByTestId('bar-search-input').fill(`${job.job} brief`); await expect(page.getByTestId('bar-result').first()).toBeVisible() } },
  { name: 'the bar, open with none', as: PEOPLE.planning, show: async page => { await loaded(page); await openBar(page); await page.getByTestId('bar-search-input').fill('qzx nothing matches'); await expect(page.getByTestId('bar-none')).toBeVisible() } },
  { name: 'the shortcuts sheet', as: PEOPLE.planning, show: async page => { await loaded(page); if (phone(page)) { await openBar(page); await page.getByTestId('bar-shortcuts-link').click() } else await page.locator('body').press('?'); await expect(page.getByTestId('shortcuts')).toBeVisible() } },
]
