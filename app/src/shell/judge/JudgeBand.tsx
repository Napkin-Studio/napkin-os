// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The score card (features/judge.clan), a band above an open script, route or visual brief: what Judge scored it,
// why it is that number (the failed tests first, each with its evidence), where it advises it goes, and the plain
// words that the 24 is advice until Judge has earned trust. The creative director named on the brief may overrule
// with a written reason; Judge's own verdict stays as it was. Nothing here is a person's number: the card is the
// piece of work's. The band reuses the Brief gate band's look (gate.css) and the shell's pill buttons.

import { useId, useState } from 'react'
import type { JudgeCardView } from '../../host/types'
import { DIM_NAME, failedFirst, headline, NOT_TRUSTED, priceLine, staleLine } from './judgeModel'
import type { Judge } from './useJudge'
import '../gate/gate.css'
import './judge.css'

export function JudgeBand({ judge }: { judge: Judge }) {
  const { card } = judge
  if (!card) return null
  return <Band card={card} judge={judge} />
}

function Band({ card, judge }: { card: JudgeCardView; judge: Judge }) {
  const s = card.score
  const [why, setWhy] = useState(false)
  const [passed, setPassed] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const field = useId()
  const stale = s ? staleLine(s) : null
  const next: 'team' | 'cd' | null = s ? (s.route === 'team' ? 'cd' : 'team') : null
  const tests = s ? failedFirst(s.tests) : []
  const failed = tests.filter(t => t.value === 'fail')
  const kept = tests.filter(t => t.value === 'pass')

  return (
    <section className="bg-band jb-band" data-testid="judge-band" aria-label="Judge">
      <div className="bg-bar">
        <span className="bg-tag">Judge</span>
        <span className="bg-sum" data-testid="judge-line">{s ? headline(s) : card.why_not ?? priceLine(card.setup)}</span>
        {s && <button type="button" className="ch-btn jb-btn" aria-expanded={why} data-testid="judge-why" onClick={() => setWhy(o => !o)}>{why ? 'Hide why' : 'See why'}</button>}
      </div>
      {!s && !card.why_not && <p className="jb-note" data-testid="judge-price">{priceLine(card.setup)} Judge advises. The creative director decides.</p>}
      {judge.line && <p className="jb-note jb-warn" role="status" data-testid="judge-refusal">{judge.line}</p>}
      {s && (
        <div className="jb-card" data-testid="score-card" data-route={s.route} data-trust={s.trust}>
          <div className="jb-top">
            <p className="jb-total" aria-label={`${s.total} of 30`}><b>{s.total}</b><span> of 30</span></p>
            <ul className="jb-dims" aria-label="Sub-scores">
              {(['idea', 'craft', 'effect'] as const).map(d => <li key={d}><span>{DIM_NAME[d]}</span><b>{s.sub[d]}</b><span> of 10</span></li>)}
            </ul>
          </div>
          <p className="jb-route" data-testid="judge-route">{s.route_line}</p>
          {s.trust !== 'earned' && <p className="jb-note" data-testid="judge-calibration">{card.setup.calibration}</p>}
          {s.overruled && <p className="jb-note" data-testid="judge-overruled">The creative director overruled Judge: {s.overruled.reason}</p>}
          {stale && <p className="jb-note jb-warn" data-testid="judge-stale">{stale}</p>}
          {why && (
            <div className="jb-why" data-testid="judge-tests">
              <h3 className="bg-h3">{failed.length === 0 ? 'Every test passed' : `Not passed, ${failed.length}`}</h3>
              <ul className="jb-tests">
                {failed.map(t => (
                  <li key={t.id} data-testid="judge-test" data-value="fail">
                    <span className="jb-dim">{DIM_NAME[t.dim]}</span>
                    <span className="jb-q">{t.question ?? t.id}</span>
                    <span className="jb-ev">{t.evidence}</span>
                  </li>
                ))}
              </ul>
              {kept.length > 0 && (
                <>
                  <button type="button" className="ch-btn jb-btn" aria-expanded={passed} onClick={() => setPassed(o => !o)}>{passed ? 'Hide the passed tests' : `Show the ${kept.length} passed`}</button>
                  {passed && (
                    <ul className="jb-tests jb-passed">
                      {kept.map(t => (
                        <li key={t.id} data-testid="judge-test" data-value="pass">
                          <span className="jb-dim">{DIM_NAME[t.dim]}</span>
                          <span className="jb-q">{t.question ?? t.id}</span>
                          <span className="jb-ev">{t.evidence}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {card.older.length > 0 && <p className="jb-note">Earlier versions scored {card.older.map(o => o.total).join(', ')}.</p>}
              <p className="jb-note">{s.trust === 'earned' ? 'Judge is trusted for this version.' : NOT_TRUSTED}</p>
            </div>
          )}
          <div className="jb-acts">
            {(stale || card.can_score) && (
              <button type="button" className="ch-btn jb-btn" data-testid="judge-again" data-primary={stale ? '' : undefined} disabled={judge.busy || !card.can_score} onClick={() => { void judge.send() }}>Score again</button>
            )}
            {card.can_overrule && !s.overruled && next && !asking && (
              <button type="button" className="ch-btn jb-btn" data-testid="judge-overrule" onClick={() => setAsking(true)}>Overrule</button>
            )}
          </div>
          {asking && next && (
            <form className="jb-form" data-testid="judge-overrule-form" onSubmit={e => {
              e.preventDefault()
              if (!reason.trim()) return
              void judge.overrule(reason.trim(), next).then(ok => { if (ok) { setAsking(false); setReason('') } })
            }}>
              <label htmlFor={field}>{next === 'cd' ? 'Keep it with you. Why does Judge have this wrong?' : 'Send it back to the team. Why does Judge have this wrong?'}</label>
              <textarea id={field} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="A written reason is needed. It is kept in the file." />
              <div className="jb-acts">
                <button type="submit" className="ch-btn jb-btn" data-primary data-testid="judge-overrule-send" disabled={!reason.trim()}>{next === 'cd' ? 'Overrule: keep it' : 'Overrule: send it back'}</button>
                <button type="button" className="ch-btn jb-btn" onClick={() => { setAsking(false); setReason('') }}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
