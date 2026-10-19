// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A coming-soon card on the home (features/launcher-coming-soon.clan).

import type { CSSProperties } from 'react'
import type { Teaser } from './comingSoon'

/** A tool's card that opens nothing yet: the same card as an app's, with Coming soon for Start. */
export function SoonCard({ teaser }: { teaser: Teaser }) {
  const mark = { '--mark': `url("data:image/svg+xml,${encodeURIComponent(teaser.mark)}")` } as CSSProperties
  return (
    <div
      className="ln-app ln-app-soon"
      style={{ '--tc': teaser.colour } as CSSProperties}
      title={teaser.line}
      aria-disabled="true"
      data-teaser={teaser.app_id}
    >
      <span className="ln-cover" aria-hidden>
        <i className="ln-big" style={mark} />
        <i className="ln-ghost" style={mark} />
      </span>
      <span className="ln-body">
        <span className="ln-app-name eyebrow">{teaser.name}</span>
        <span className="ln-app-job">{teaser.job}</span>
        <span className="ln-sr">{teaser.line}</span>
        <span className="ln-app-go">Coming soon</span>
      </span>
    </div>
  )
}
