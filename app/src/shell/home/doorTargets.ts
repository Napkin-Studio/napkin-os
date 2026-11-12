// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Which doors have somewhere to go: one line per door, and nothing else to edit.
// A door has one of three things behind it:
//   { app: '<app id>' }               an installed app (a tool of the landing opens it for a client);
//   { page: '<name>', built: true }   a page of the shell itself, once it exists (built: false until then);
//   no line at all                    nothing yet: the door opens its Empty state (components/states/doors.ts).
// A tool's own record adds its one line here when it lands, for example
//   'script-editor': { app: 'ie.napkin.script-editor' },
// The door's words, one line, verb and example stay in components/states/doors.ts.

export type DoorTarget = { app: string } | { page: string; built: boolean }

export const DOOR_TARGETS: Readonly<Record<string, DoorTarget>> = {
  'brief': { app: 'ie.napkin.brief-maker' },
  'research': { app: 'ie.napkin.campaign-research' },
  'presentations': { app: 'ie.napkin.deck-maker' },
  'ideas': { app: 'ie.napkin.idea-room' },
  'clients': { page: 'clients', built: true },
  'agency-dashboard': { page: 'agency-dashboard', built: true },
  // The job page (record job-page) turns built on.
  'live-jobs': { page: 'live-jobs', built: false },
}

export const doorTarget = (id: string): DoorTarget | null => DOOR_TARGETS[id] ?? null
