// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Tools on their way, shown on the home after the installed ones
// (features/launcher-coming-soon.clan). The one place the home's words and
// colours do not come from an app's manifest: a teaser has no app yet. Once an
// app with the same id is installed, its own card replaces the teaser.

import type { InstalledApp } from './types'

export interface Teaser {
  app_id: string
  name: string
  /** The card's title, verb first, as an app's `home.job`. */
  job: string
  /** One sentence: the tooltip, and what a screen reader hears. */
  line: string
  /** `#rrggbb`, as an app's `home.colour`. */
  colour: string
  /** A one-colour SVG on transparent, painted as a mask like an app's icon. */
  mark: string
}

/** The Production Tool's quartered circle (production-tool/web/public/mark.svg), in one
 *  colour: the four quarters keep their order from dark to light as opacities. */
const PRODUCTION_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><clipPath id="c"><circle cx="22" cy="22" r="15"/></clipPath><g clip-path="url(#c)" transform="rotate(-45 22 22)"><rect x="7" y="7" width="15" height="15"/><rect x="22" y="7" width="15" height="15" opacity="0.75"/><rect x="7" y="22" width="15" height="15" opacity="0.3"/><rect x="22" y="22" width="15" height="15" opacity="0.55"/></g></svg>`

/** Deck Maker's slide (app/templates/deck-maker/icon.svg on feat/deck-maker-ui). */
const DECK_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect fill="none" stroke="black" stroke-width="3" x="6" y="9" width="32" height="22" rx="3"/><rect x="11" y="14" width="14" height="3" rx="1.5"/><rect x="11" y="21" width="20" height="2" rx="1"/><rect x="16" y="35" width="12" height="3" rx="1.5"/></svg>`

export const TEASERS: readonly Teaser[] = [
  {
    app_id: 'ie.napkin.production-tool',
    name: 'Production',
    job: 'Make the ad',
    line: 'From a drawing and a script to a finished ad.',
    colour: '#2F64F5', // its --tool colour (production-tool/web/src/styles.css)
    mark: PRODUCTION_MARK,
  },
  {
    app_id: 'ie.napkin.deck-maker',
    name: 'Deck Maker',
    job: 'Build a pitch deck',
    line: 'A pitch deck from your research and your brief.',
    colour: '#7C4DFF', // purple, apart from the Production Tool's blue (owner, 2026-10-19)
    mark: DECK_MARK,
  },
]

/** The teasers whose app is not installed yet. */
export function upcoming(installed: readonly Pick<InstalledApp, 'app_id'>[]): Teaser[] {
  return TEASERS.filter(t => !installed.some(a => a.app_id === t.app_id))
}
