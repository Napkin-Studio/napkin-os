// The pages of record remaining-homes for the suite's axe, 44 px and em dash checks (tests 72 and 73): the five new desks.
import { expect, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001'

const home = async (page: Page) => { await page.goto('/'); await expect(page.getByTestId('desk')).toBeVisible() }

export const PAGES = [
  { name: 'desk of the art director', as: PEOPLE.artDirector, show: home },
  { name: 'desk of the copywriter', as: PEOPLE.copywriter, show: home },
  { name: 'desk of the producer', as: PEOPLE.producer, show: home },
  { name: 'desk of the Agency Brain', as: PEOPLE.agencyBrain, show: home },
  { name: 'desk of traffic', as: PEOPLE.traffic, show: home },
]
