// The pages of record remaining-homes for the suite's axe, 44 px and em dash checks (tests 72 and 73): the five new homes.
import { expect, type Page } from '@playwright/test'
import { PEOPLE } from './seed/j001'

const home = async (page: Page) => { await page.goto('/'); await expect(page.getByTestId('home')).toBeVisible() }

export const PAGES = [
  { name: 'home of the art director', as: PEOPLE.artDirector, show: home },
  { name: 'home of the copywriter', as: PEOPLE.copywriter, show: home },
  { name: 'home of the producer', as: PEOPLE.producer, show: home },
  { name: 'home of the Agency Brain', as: PEOPLE.agencyBrain, show: home },
  { name: 'home of traffic', as: PEOPLE.traffic, show: home },
]
