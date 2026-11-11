// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Should Napkin OS draft your timesheet?" (docs/design/timesheet-consent.html). Asked once, at the
// person's first sign-in, on their home; nothing is captured until they say yes, and no is as good
// an answer: they fill the day in by hand and nothing else changes. Their answer is a dated,
// attributed record on the server. The card sits in the page's flow and covers nothing.

import { useState } from 'react'
import { answer } from './consent'
import './timesheet.css'

const ASK_TITLE = 'Should Napkin OS draft your timesheet?'
const ASK_LINE = 'If you say yes, it notes which job you have open and for how long. That is all. It drafts your day from that, and you confirm it.'
const ASK_POINTS = [
  'Nothing is captured until you say yes.',
  'No keystrokes, no screen capture, no hidden tracking.',
  'Your manager never sees your corrections.',
  'If you say no, you fill in your day by hand. Nothing else changes.',
]

export function Ask({ variant, onTimesheet }: { variant: 'card' | 'page'; onTimesheet?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const say = async (yes: boolean) => {
    setBusy(true); setFailed(false)
    try { await answer(yes) } catch { setFailed(true); setBusy(false) }
  }
  return (
    <section className="ts-ask" data-variant={variant} data-testid="timesheet-ask" aria-labelledby={`ts-ask-${variant}`}>
      <div className="ts-ask-text">
        <h2 className="ts-ask-title" id={`ts-ask-${variant}`}>{ASK_TITLE}</h2>
        <p className="ts-ask-line">{ASK_LINE}</p>
        {variant === 'page' && <ul className="ts-points">{ASK_POINTS.map(p => <li key={p}>{p}</li>)}</ul>}
        {failed && <p className="ts-note" role="alert">Your answer was not saved. Try again.</p>}
      </div>
      <div className="ts-ask-btns">
        <button type="button" className="ch-btn ch-btn-primary ts-btn" disabled={busy} onClick={() => void say(true)}>Yes, draft my day</button>
        <button type="button" className="ch-btn ts-btn" disabled={busy} onClick={() => void say(false)}>No, I will fill it in</button>
        {variant === 'card' && onTimesheet && <button type="button" className="side-link" onClick={onTimesheet}>What is captured</button>}
      </div>
    </section>
  )
}
