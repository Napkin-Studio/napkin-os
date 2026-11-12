// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The route of one job as a strip: each stage with who approves it, by when, and what has happened to
// it, read from the documents' own decisions (features/approval-route.clan). The Approvals page draws
// it, and the job page embeds it. It shows who holds the job and for how long, a fact about the job;
// it holds no total and no ordering of people. Its states are plain: approved (a solid dot), waiting
// (the ring, with the days if it is late), not started (a dashed ring). With no route it is nothing at
// all: the page around it says so.

import type { RouteStepState } from '../../host/types'
import { heldLine, roleWords, stepLine } from './approvalsModel'
import './approvals.css'

export function RouteStrip({ route, label = 'Approval route' }: { route: readonly RouteStepState[]; label?: string }) {
  if (route.length === 0) return null
  return (
    <ol className="rs" aria-label={label} data-testid="route-strip">
      {route.map((s, i) => {
        const late = s.state === 'waiting' && (s.days_late ?? 0) > 0
        const held = heldLine(s)
        return (
          <li key={`${s.stage}-${s.role ?? i}`} className="rs-step" data-state={s.state} data-late={late || undefined} data-testid="route-step" data-stage={s.stage}>
            <i className="rs-dot" aria-hidden />
            <b className="rs-stage">{s.label}</b>
            <span className="rs-who">{s.approver}{s.role ? <small>{roleWords(s.role)}</small> : null}</span>
            <span className="rs-state" data-testid="route-step-state">{stepLine(s)}</span>
            {held && <span className="rs-held">{held}</span>}
            <span className="rs-sr">{s.state === 'approved' ? 'Approved.' : s.state === 'waiting' ? 'Waiting.' : 'Not started.'}</span>
          </li>
        )
      })}
    </ol>
  )
}
