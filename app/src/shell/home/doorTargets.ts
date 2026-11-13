// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Which page doors have a page: one line per door, and nothing else to edit. A door that opens a document of
// a client is a tool and lives in landing/tools.ts (one table); a door here opens an agency-wide page of the
// shell, once it exists (built: false until then). A door with no line, or not built, opens the SoonCard with
// its own example line (components/states/doors.ts, shell/SoonCard.tsx).

export type DoorTarget = { page: string; built: boolean }

export const DOOR_TARGETS: Readonly<Record<string, DoorTarget>> = {
  'agency-dashboard': { page: 'agency-dashboard', built: true },
  // Who approves each stage and by when (record approval-route).
  'approvals': { page: 'approvals', built: true },
  // Every live job, each opening its page (record job-page).
  'live-jobs': { page: 'live-jobs', built: true },
  // Each piece of work with its score out of 30, read from the job index (record judge).
  'judge-scores': { page: 'judge-scores', built: true },
}

export const doorTarget = (id: string): DoorTarget | null => DOOR_TARGETS[id] ?? null

/** A page door is live when its page is built. */
export const doorIsLive = (id: string, _apps?: readonly string[]): boolean => doorTarget(id)?.built === true
