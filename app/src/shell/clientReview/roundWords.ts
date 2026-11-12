// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The words of the agency's round view, as plain functions.

import type { ClientRoundView, RoundComment } from '../../host/types'

export const roundTitle = (r: Pick<ClientRoundView, 'round' | 'rounds_in_scope'>): string =>
  r.rounds_in_scope && r.rounds_in_scope >= r.round ? `Round ${r.round} of ${r.rounds_in_scope}` : `Round ${r.round}`

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export const whereWords = (c: Pick<RoundComment, 'pin'>): string =>
  !c.pin ? 'whole piece' : c.pin.t_ms !== undefined ? `at ${clock(c.pin.t_ms)}` : c.pin.x !== undefined ? `at ${Math.round(c.pin.x * 100)}%, ${Math.round((c.pin.y ?? 0) * 100)}%` : 'whole piece'

