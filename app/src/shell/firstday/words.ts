// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the first-day pointers and the invite say (features/first-day.clan, the owner's wording of 15 Nov 2026).

export const POINTER_WORDS = {
  pages: 'Your pages and your clients. Open one to start.',
  bar: 'This bar is on every screen. Press Cmd K to find anything.',
  needs: 'Needs you. What is waiting for you, soonest first.',
} as const

export const BUTTONS = { next: 'Next', gotIt: 'Got it' } as const

/** The names the pointers answer to when someone points at them to give feedback. */
export const POINTER_NAMES = { pages: 'Your pages', bar: 'The OS bar', needs: 'Needs you' } as const

export const INVITE = {
  open: 'Invite',
  first: 'First thing to open',
  none: 'Nothing in particular',
  make: 'Get the link',
  copy: 'Copy the link',
  copied: 'Copied',
  email: 'Also email it (optional)',
  close: 'Close',
} as const
