// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The words of a page door that has no page yet: develop's SoonCard teaser, from the door's own line, verb and
// finished example in components/states/doors.ts.

import { doorById } from '../../components/states/doors'
import type { Teaser } from '../comingSoon'

/** The page doors the shell has built; every other door is a SoonCard until its record lands. */
export const BUILT_PAGES: readonly string[] = ['agency-dashboard', 'approvals', 'live-jobs', 'judge-scores']

/** A soft ring, in one colour on transparent: the card's mark, painted as a mask like a teaser's. */
const RING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="15" fill="none" stroke="black" stroke-width="3"/></svg>'

/** A door's finished example for a role that may not read a budget: the same page, with no hours against a budget
 *  (features/align-confidential-prices.clan; the review of 15 Nov). */
const NO_FIGURE: Readonly<Record<string, { title: string; lines: string[] }>> = {
  'time-money': { title: 'Example · Client A, an Irish whiskey', lines: ['J001: the hours each stage took, from confirmed timesheets.'] },
}

/** The SoonCard's teaser for a door: its own words. An id the table does not know (an agency's own door) gets a plain line.
 *  `mayReadBudget` is the role's (JobRights.read_budget): without it, a door whose example holds hours against a budget
 *  shows the same example with no figure. */
export function teaserFor(door: string, name: string | null, mayReadBudget?: boolean): Teaser {
  const content = doorById(door)
  const example = !mayReadBudget && NO_FIGURE[door] ? NO_FIGURE[door] : content?.example
  const title = name ?? content?.name ?? door.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  return {
    app_id: `door:${door}`,
    name: title,
    job: content?.verb ?? 'Open the J001 job',
    line: content?.line ?? `${title} goes here.`,
    colour: '#6D655A',
    mark: RING,
    example: example ?? { title: 'Example · Client A, an Irish whiskey', lines: [`${title} will list the J001 work here.`] },
  }
}
