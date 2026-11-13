// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The gallery: all nine screen states in light and dark, with the words
// Laurence judges (features/screen-states.clan). Served as /states.html. The
// states are drawn with sample content only, de-identified (Client A, an Irish
// whiskey); nothing here calls a host.

import {
  ChangedBrief, Empty, FailedSave, Loading, LongRun, MissingAccess, Normal, NotRight, RunFailed,
} from './ScreenStates'
import { RECTS_AFTER_MS } from './loading'
import { MODES, STATES, STATE_NAMES, type Mode, type StateName } from './words'
const MODE_NAMES: Record<Mode, string> = { light: 'Light', dark: 'Dark' }

/** One state with its sample content. */
export function Sample({ name }: { name: StateName }) {
  switch (name) {
    case 'normal':
      return <Normal title="J001 brief, Client A" next={{ label: 'Save as PDF' }} work={<>
        <p className="ns-line">The whiskey that waits for you.</p>
        <p>People do not want more time. They want permission to stop.</p>
      </>} />
    case 'empty':
      return <Empty line="The brief for a job goes here." verb="Start a brief" />
    case 'loading':
      return <Loading what="the J001 brief" after={RECTS_AFTER_MS} />
    case 'failed-save':
      return <FailedSave />
    case 'missing-access':
      return <MissingAccess what="the J001 scope" who="Account service" />
    case 'changed-brief':
      return <ChangedBrief from="v3" to="v4" changes="The measure now has a number and a date." />
    case 'run-failed':
      return <RunFailed why="provider" />
    case 'not-right':
      return <NotRight />
    case 'long-run':
      return <LongRun minutes={4} step="Step 2 of 4: the territories" />
  }
}

/** The gallery page. `modes` limits it to one of the two (a screenshot of one). */
export function Gallery({ modes = MODES }: { modes?: readonly Mode[] }) {
  return (
    <main className="ns-gallery" data-tone={modes.length === 1 ? modes[0] : 'light'}>
      <header className="ns-head">
        <p className="eyebrow">Napkin OS · Screen states</p>
        <h1>The nine screen states</h1>
        <p className="ns-small">Every tool has all nine. Each is shown here in light and dark, with sample content for Client A, an Irish whiskey.</p>
      </header>
      {modes.map(mode => (
        <section key={mode} className="ns-mode" data-tone={mode} aria-labelledby={`ns-mode-${mode}`}>
          <h2 id={`ns-mode-${mode}`} className="eyebrow">{MODE_NAMES[mode]}</h2>
          <div className="ns-grid">
            {STATES.map(name => (
              <div key={name} className="ns-cell">
                <h3 className="eyebrow">{STATE_NAMES[name]}</h3>
                <Sample name={name} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
