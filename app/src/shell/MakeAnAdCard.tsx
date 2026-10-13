// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The OS home's way into the Production Tool (features/os-sign-in.clan).
//
// Not an installed .clan app: napkin-web serves the tool itself at
// /production, behind the same sign-in, so the card is a plain link (a full
// page load, which the service worker leaves to the server). It shows only
// when /api/session says `production: true`. It replaces Advertising Studio.

import type { CSSProperties } from 'react'

/** The tool's path on this origin. */
export const PRODUCTION_PATH = '/production/'

/** Production's colour on the home: the tool's own accent. */
const TINT = { '--tc': '#E4572E' } as CSSProperties

export function MakeAnAdCard({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <a className="ln-app ln-app-link" href={PRODUCTION_PATH} style={TINT} data-dogfood="open production"
      title="Script, storyboard and video for an ad, in one place.">
      <span className="ln-cover" aria-hidden>
        <b className="ln-big ln-mono">P</b>
      </span>
      <span className="ln-body">
        <span className="ln-app-name eyebrow">Production</span>
        <span className="ln-app-job">Make an ad</span>
        <span className="ln-app-go">Start <span aria-hidden>→</span></span>
      </span>
    </a>
  )
}
