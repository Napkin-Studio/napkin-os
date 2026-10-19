// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the Brand Clan chip opens: the agency's Brand Clans to pick from, the
// one that is set (Update, Detach), a box to find or name a brand. A small
// popover, not a conversation. Every refusal is shown here, in the host's own
// words, next to what was tried. This file only draws what it is given
// (`BrandClanChip` holds the state), so each state can be rendered in a test.

import type { AttachTarget, BrandCandidate } from '../../host'
import { canOfferMake, detachSentence, findTargets, NAMING_UNAVAILABLE } from './words'
import type { ChipState } from './words'

export type Naming =
  | { step: 'none' }
  | { step: 'looking'; typed: string }
  /** "Is it one of these?" */
  | { step: 'choose'; typed: string; candidates: BrandCandidate[] }
  | { step: 'making'; name: string }

export interface PopoverHandlers {
  onQuery: (q: string) => void
  onPick: (t: AttachTarget) => void
  onUpdate: () => void
  onDetachAsk: () => void
  onDetachConfirm: () => void
  onDetachCancel: () => void
  onMake: (typed: string) => void
  onCandidate: (c: BrandCandidate) => void
  onNewBrand: (typed: string) => void
  onNamingCancel: () => void
}

export interface PopoverProps {
  state: ChipState
  /** The agency's Brand Clans; null while they are on the way. */
  targets: AttachTarget[] | null
  query: string
  /** What is in flight: `attach:<document id>`, `update`, `detach`, `naming`. */
  busy: string | null
  /** A refusal, in the host's words. */
  error: string | null
  confirmDetach: boolean
  naming: Naming
  /** This build can make a Brand Clan from a name (it has a middleware). */
  canName: boolean
  on: PopoverHandlers
  /** Ties the box's label to it. */
  id?: string
}

export default function BrandClanPopover({ state, targets, query, busy, error, confirmDetach, naming, canName, on, id = 'bc' }: PopoverProps) {
  const locked = state.readOnly
  const working = busy !== null
  const shown = targets ? findTargets(targets, query) : []
  const typed = query.trim()
  const offerMake = !!targets && canOfferMake(targets, query)
  const hasOther = state.entry !== null

  return (
    <div className="bc-pop" role="dialog" aria-label="Brand Clan" id={`${id}-pop`}>
      <h2 className="bc-h">Brand Clan</h2>

      {locked && <p className="bc-note" data-bc="locked">This document is locked, so its Brand Clan can’t change.</p>}

      {state.entry && (
        <div className="bc-current" data-bc="current">
          <div className="bc-current-name">
            <b>{state.brand}</b>
            <span>{state.version}</span>
          </div>
          {state.kind === 'behind' && (
            <p className="bc-note">{state.versionNow ? `${state.versionNow} is in the Brand Clan.` : 'The Brand Clan has changed.'} This document has {state.version || 'an older copy'}.</p>
          )}
          {state.kind === 'missing' && <p className="bc-note">This Brand Clan isn’t in your studio any more. Its copy here is kept.</p>}
          {!locked && !confirmDetach && (
            <div className="bc-row">
              {state.kind === 'behind' && (
                <button type="button" className="ch-btn ch-btn-primary" disabled={working} onClick={on.onUpdate}>
                  {busy === 'update' ? 'Updating…' : 'Update'}
                </button>
              )}
              <button type="button" className="ch-btn ch-btn-quiet" disabled={working} onClick={on.onDetachAsk}>Detach</button>
            </div>
          )}
          {!locked && confirmDetach && (
            <div data-bc="confirm">
              <p className="bc-note">{detachSentence(state.brand)}</p>
              <div className="bc-row">
                <button type="button" className="ch-btn ch-btn-danger" disabled={working} onClick={on.onDetachConfirm}>
                  {busy === 'detach' ? 'Detaching…' : 'Detach'}
                </button>
                <button type="button" className="ch-btn ch-btn-quiet" disabled={working} onClick={on.onDetachCancel}>Keep it</button>
              </div>
            </div>
          )}
        </div>
      )}

      {naming.step === 'none' || naming.step === 'looking' ? (
        <>
          <label className="bc-label" htmlFor={`${id}-q`}>Find or name a brand</label>
          <input
            id={`${id}-q`}
            className="ch-input bc-q"
            type="text"
            value={query}
            placeholder="Lumen Water"
            autoComplete="off"
            disabled={locked || working}
            onChange={e => on.onQuery(e.target.value)}
          />

          {!targets && <p className="bc-note" data-bc="loading">Looking at your Brand Clans…</p>}
          {targets && (
            <ul className="bc-list" aria-label="Your Brand Clans">
              {shown.map(t => (
                <li key={t.document_id}>
                  <button
                    type="button"
                    className="bc-item"
                    data-attached={t.attached || undefined}
                    disabled={locked || working || t.attached}
                    onClick={() => on.onPick(t)}
                  >
                    <span className="bc-item-name">{t.title}</span>
                    {typeof t.version === 'number' && <span className="bc-item-v">v{t.version}</span>}
                    {t.attached
                      ? <span className="bc-tick" aria-label="attached">✓ attached</span>
                      : <span className="bc-act">{busy === `attach:${t.document_id}` ? 'Setting…' : hasOther ? 'Replace' : 'Use'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {targets && !shown.length && !typed && (
            <p className="bc-note" data-bc="none">Your studio has no Brand Clans yet. Type a brand’s name to make one.</p>
          )}
          {targets && !shown.length && typed && <p className="bc-note" data-bc="nomatch">No Brand Clan has that name.</p>}

          {offerMake && !locked && (
            canName ? (
              <button
                type="button"
                className="ch-btn bc-make"
                disabled={working}
                onClick={() => on.onMake(typed)}
              >
                {naming.step === 'looking' ? 'Looking…' : `Make a Brand Clan for ${typed}`}
              </button>
            ) : (
              <p className="bc-note" data-bc="unavailable">{NAMING_UNAVAILABLE}</p>
            )
          )}
        </>
      ) : naming.step === 'choose' ? (
        <div data-bc="choose">
          <p className="bc-q-text">Is it one of these?</p>
          <ul className="bc-list" aria-label="Brands your studio knows">
            {naming.candidates.map(c => (
              <li key={c.ref}>
                <button type="button" className="bc-item" disabled={working} onClick={() => on.onCandidate(c)}>
                  <span className="bc-item-name">{c.name}</span>
                  {c.categories.length > 0 && <span className="bc-item-v">{c.categories.join(', ')}</span>}
                  <span className="bc-act">Make its Brand Clan</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="bc-row">
            <button type="button" className="ch-btn" disabled={working} onClick={() => on.onNewBrand(naming.typed)}>
              None of these, make a new one
            </button>
            <button type="button" className="ch-btn ch-btn-quiet" disabled={working} onClick={on.onNamingCancel}>Back</button>
          </div>
        </div>
      ) : (
        <p className="bc-note" data-bc="making" aria-live="polite">Making the Brand Clan for {naming.name}…</p>
      )}

      {error && <p className="bc-err" role="alert" data-bc="error">{error}</p>}
    </div>
  )
}
