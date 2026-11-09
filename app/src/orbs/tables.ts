// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Orbs tables, as the Deck Maker template carries them (the `Orbs` block in
// app/templates/deck-maker/index.html). The values are the clan's and Shrey's;
// app/tests/orbsDrift.test.ts compares every table with the template and fails
// when one differs. The only addition is the `idle` ring style (marked PORT),
// the thin still ring of a client with nothing running.

export interface Mat { base: string; ink: string; gloss: number; metal: number; glass: number }

export const MATS: Record<string, Mat> = {
  pearl:    { base: '#EEECE7', ink: '#16191D', gloss: .70, metal: 0,   glass: 0 },
  graphite: { base: '#242936', ink: '#EEF0F4', gloss: .50, metal: .15, glass: 0 },
  chrome:   { base: '#C9CED8', ink: '#16191D', gloss: 1,   metal: .95, glass: 0 },
  glass:    { base: '#DCE6F2', ink: '#16191D', gloss: 1,   metal: 0,   glass: .85 },
  ceramic:  { base: '#E4DCCF', ink: '#2A2622', gloss: .40, metal: 0,   glass: 0 },
  stone:    { base: '#B9BCC3', ink: '#16191D', gloss: .25, metal: 0,   glass: 0 },
  onyx:     { base: '#12141A', ink: '#F1F2F5', gloss: .95, metal: .25, glass: 0 },
  paper:    { base: '#F7F7F5', ink: '#16191D', gloss: .15, metal: 0,   glass: 0 },
}

export interface Kind { wob: number[]; breath: number }

export const TYPES: Record<string, Kind> = {
  scan: { wob: [0, .006, 0, .004], breath: .004 }, unfold: { wob: [.012, .014, .006, 0], breath: .022 }, sweep: { wob: [0, .008, .012, .006], breath: .006 },
  hold: { wob: [.003, .002, 0, 0], breath: .004 }, align: { wob: [.005, 0, .005, 0], breath: .008 }, pulse: { wob: [.006, 0, .004, 0], breath: .028 },
}

export const TYPE_OF: Record<string, string> = {}
for (const n of ['Research', 'Competitor', 'Culture', 'Audience', 'Knowledge']) TYPE_OF[n] = 'scan'
for (const n of ['Idea', 'Concept', 'Character', 'Strategy', 'Storyboard']) TYPE_OF[n] = 'unfold'
for (const n of ['Video', 'Motion', 'Image', 'Edit', 'Upscale', 'Adapt']) TYPE_OF[n] = 'sweep'
for (const n of ['Review', 'Compliance', 'Approval', 'Asset', 'Client']) TYPE_OF[n] = 'hold'
for (const n of ['Orchestrator', 'Job', 'Performance', 'Art Director']) TYPE_OF[n] = 'align'
for (const n of ['Brief', 'Copy', 'Deck', 'Voice', 'Music']) TYPE_OF[n] = 'pulse'

/** period, duty, breadth, scroll, glow, shimmer, beat, ticks-in, broken, turning speed (deg/s) */
export const STYLE: Record<string, number[]> = {
  work:     [100, 1,   3.5, 0,  0, .35, 0, 0, 0, 70],
  write:    [100, 1,   3.5, 0,  1, 0,   0, 0, 0, 90],
  think:    [7,   .28, 3.2, 6,  0, 0,   0, 0, 0, 40],
  search:   [14,  .57, 3.4, 10, 0, 0,   0, 0, 0, 110],
  read:     [100, 1,   2.2, 0,  0, 0,   0, 1, 0, 60],
  provider: [100, 1,   6.0, 0,  0, .5,  0, 0, 0, 55],
  check:    [100, 1,   2.4, 0,  0, 0,   1, 0, 0, 120],
  human:    [100, 1,   6.5, 0,  0, .6,  0, 0, 0, 25],
  queue:    [24,  .55, 2.4, 4,  0, 0,   0, 0, 0, 18],
  error:    [100, 1,   3.5, 0,  0, 0,   0, 0, 1, 0],
  complete: [100, 1,   4.5, 0,  0, 0,   0, 0, 0, 0],
  idle:     [100, 1,   1.3, 0,  0, 0,   0, 0, 0, 0],   // PORT: client idle, thin and still
}
