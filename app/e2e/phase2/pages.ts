// The shape of a Phase 2 page, for tests 72 and 73 of the suite (j001-p2-j001-phase2-suite.spec.ts). Each record lists its
// pages in its own j001-p2-<slug>.pages.ts (a plain file, not a spec, so importing it registers no test) as
// `export const PAGES: Phase2Page[] = [ { name: 'idea room', as: PEOPLE.creativeDirector, show: ... }, ... ]`.
// The suite's spec reads every such file by a glob, so a record adds its pages by editing only its own file.
import type { Page } from '@playwright/test'
import type { Person } from '../pilot'
import type { SeededJob } from '../seed/j001'

export type PageCtx = { job: SeededJob; mode: string }
export type Phase2Page = {
  /** A name for the failure line. */
  name: string
  /** The placeholder person who reads the page. */
  as: Person
  /** Open the page and wait until it is drawn. */
  show: (page: Page, ctx: PageCtx) => Promise<void>
}
