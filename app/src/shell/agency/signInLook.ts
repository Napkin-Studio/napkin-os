// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The sign-in card's look (shell/SignIn.tsx): Napkin's, or the registry
// agency the typed sign-in name points at (palette.ts agencyOfSignInName).
// Pure, and read from the registry alone: no roster, no server.

import { agencyOfSignInName, coloursOf, markOf } from './palette'

/** The card's look: Napkin's (id null), or a registry agency's name and medallion colours. */
export interface SignInLook { id: string | null; lede: string; mark: { base: string; accent: string } }

/** The look for what has been typed in the sign-in name so far; Napkin's until it names a registry agency. */
export function signInLookOf(typed: string): SignInLook {
  const id = agencyOfSignInName(typed)
  const name = id && id !== 'napkin' ? coloursOf(id)?.name : null
  return {
    id,
    lede: name ? `Sign in to ${name} on Napkin Studio.` : 'Sign in to Napkin Studio.',
    mark: markOf(id ? `_@${id}` : null),
  }
}

/** How long typing rests before the card changes look, so it does not flicker key by key. */
export const LOOK_DELAY_MS = 150
