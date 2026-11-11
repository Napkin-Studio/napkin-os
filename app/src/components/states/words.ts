// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Every word the nine screen states say, in one file, so Laurence can judge
// the wording without reading components (features/screen-states.clan).
//
// Rules (v2 section 8): short sentences, plain words, no em dashes, no words
// like magic or effortless. Glossary words as written: Needs you, Run,
// Credits, Job file. Content is de-identified: "Client A, an Irish whiskey".
// A test refuses an em dash anywhere in this file's output.

/** The nine, in the order v2 section 4 lists them. */
export const STATES = [
  'normal', 'empty', 'loading', 'failed-save', 'missing-access', 'changed-brief', 'run-failed', 'not-right', 'long-run',
] as const
export type StateName = (typeof STATES)[number]

/** What each is called, for the gallery's labels and for a screen reader. */
export const STATE_NAMES: Record<StateName, string> = {
  'normal': 'Normal',
  'empty': 'Empty',
  'loading': 'Loading',
  'failed-save': 'Failed save',
  'missing-access': 'Missing access',
  'changed-brief': 'Changed brief',
  'run-failed': 'Run failed',
  'not-right': 'Not right',
  'long-run': 'Long run',
}

// ── Failed save ─────────────────────────────────────────────────────────────
export const FAILED_SAVE = {
  line: 'This change did not save. What you typed is still here.',
  retry: 'Try again',
  /** After a Try again that worked, said once where the line was. */
  saved: 'Saved.',
} as const

// ── Run failed ──────────────────────────────────────────────────────────────
/** What stopped a run, in the relay's own classes (production-tool/relay harness-errors, harness-refusals). */
export type RunFailure = 'provider' | 'refused' | 'timeout' | 'other'

export const RUN_FAILED = {
  because: {
    provider: 'The model did not answer, so the run stopped.',
    refused: 'The model would not do this as asked, so the run stopped.',
    timeout: 'The run took too long, so it stopped.',
    other: 'The run stopped.',
  } satisfies Record<RunFailure, string>,
  /** No credit unit exists yet (record screen-states, open question 1): the run's reserved estimate is released and said so. */
  returned: 'The reserved estimate is returned and your inputs are kept.',
  retry: 'Try again',
} as const

/** The one plain line for a failed run. */
export function runFailedLine(why: RunFailure): string {
  return `${RUN_FAILED.because[why]} ${RUN_FAILED.returned}`
}

// ── Missing access ──────────────────────────────────────────────────────────
export const MISSING_ACCESS = {
  line: (what: string, who: string) => `You cannot open ${what} yet. ${who} can give you access.`,
  ask: (who: string) => `Ask ${who}`,
  asked: (who: string) => `Asked ${who}. They will see it in Needs you.`,
} as const

// ── Changed brief ───────────────────────────────────────────────────────────
export const CHANGED_BRIEF = {
  first: (to: string, from: string) => `The brief changed to ${to}. This work was made from ${from}.`,
  /** The host refused a save because the document moved on while the person typed (HTTP 409). */
  moved: 'The brief changed while you were typing.',
  update: (to?: string) => (to ? `Update to brief ${to}` : 'Update to the new brief'),
} as const

// ── Not right ───────────────────────────────────────────────────────────────
export const NOT_RIGHT = {
  ask: 'What is wrong with it?',
  fixes: ['Make it shorter', 'Change the tone', 'Check the facts'] as readonly string[],
} as const

// ── Long run ────────────────────────────────────────────────────────────────
export const LONG_RUN = {
  left: (minutes: number) => minutes <= 1 ? 'About a minute left.' : `About ${minutes} minutes left.`,
  needsYou: 'Needs you tells you when it is done. You can leave this page.',
} as const

// ── Loading ─────────────────────────────────────────────────────────────────
export const LOADING = { what: (what: string) => `Loading ${what}` } as const

// ── Empty ───────────────────────────────────────────────────────────────────
/** A finished example, de-identified: the J001 brief for Client A, an Irish whiskey. */
export interface Example {
  /** What the example is, in a label: "Example · Client A, an Irish whiskey". */
  title: string
  lines: readonly string[]
}

export const J001_BRIEF_EXAMPLE: Example = {
  title: 'Example · Client A, an Irish whiskey',
  lines: [
    'Proposition: The whiskey that waits for you.',
    'Insight: People do not want more time. They want permission to stop.',
    'Measure: Consideration among 25 to 40, tracked monthly, against the March baseline.',
  ],
}

/** The three modes every screen reads in (v2 section 8). */
export const MODES = ['white', 'grey', 'black'] as const
export type Mode = (typeof MODES)[number]

/** The ids the shell sends the app (clan:bar-action) when a state's button is pressed. */
export const STATE_ACTIONS = { retry: 'state-retry', update: 'state-update', ask: 'state-ask', fix: 'state-fix-' } as const
