// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Phase 1 doors (v2 section 4, the doors table) and what each shows while
// its tool does not exist yet: the Empty state, with a finished J001 example
// and one starting verb, never a blank box (v2 section 8, principle 8).
// A door whose tool comes in a later phase "shows its Empty state".
//
// All example content is de-identified: Client A, an Irish whiskey.

import type { Example } from './words'

export interface Door {
  id: string
  /** On the door. */
  name: string
  /** Which of the four Phase 1 homes lists it. */
  homes: readonly ('planning' | 'creative-director' | 'account-service' | 'management')[]
  /** The installed app that serves it, when there is one at all. */
  appId: string | null
  /** One line on what goes here (the Empty state's first line). */
  line: string
  /** The one starting verb, on the button. */
  verb: string
  example: Example
}

const A = 'Example · Client A, an Irish whiskey'

export const PHASE1_DOORS: readonly Door[] = [
  { id: 'brief', name: 'Brief', homes: ['planning'], appId: 'ie.napkin.brief-maker', line: 'The brief for a job goes here.', verb: 'Start a brief',
    example: { title: A, lines: ['Proposition: The whiskey that waits for you.'] } },
  { id: 'research', name: 'Research', homes: ['planning'], appId: 'ie.napkin.campaign-research', line: 'Research for a job goes here, every fact with its source.', verb: 'Ask a question',
    example: { title: A, lines: ['Question: Who drinks Irish whiskey in the first hour of the evening?'] } },
  { id: 'territories', name: 'Territories', homes: ['planning'], appId: null, line: 'Territories grow from a signed brief.', verb: 'Open the J001 brief',
    example: { title: A, lines: ['Territory: A bar that closes its doors for one song.', 'Reference frame: one still from the bar, door half shut.'] } },
  { id: 'client-brains', name: 'Client brains', homes: ['planning'], appId: null, line: 'What the agency knows about one client goes here.', verb: 'Add what we know',
    example: { title: A, lines: ['Fact: Client A sells to bars first and shops second.', 'Source: the March tracking report, page 4.'] } },
  { id: 'presentations', name: 'Presentations', homes: ['planning', 'account-service'], appId: 'ie.napkin.deck-maker', line: 'Decks for a job go here.', verb: 'Build a deck',
    example: { title: A, lines: ['Deck: Territories for Client A, five slides.'] } },
  { id: 'ideas', name: 'Ideas', homes: ['creative-director'], appId: null, line: 'Ideas for a job go here, the team first.', verb: 'Add an idea',
    example: { title: A, lines: ['Idea: One song of silence, once a night, in every bar that pours it.'] } },
  { id: 'ready-for-review', name: 'Ready for review', homes: ['creative-director'], appId: null, line: 'Work waiting for your eye goes here.', verb: 'Open the first one',
    example: { title: A, lines: ['Waiting: the radio script, version 2, scored 26 of 30.'] } },
  { id: 'judge-scores', name: 'Judge scores', homes: ['creative-director'], appId: null, line: 'Each piece of work and its score out of 30 goes here.', verb: 'Score a piece',
    example: { title: A, lines: ['Radio script, version 2: 26 of 30. Idea 9, craft 7.'] } },
  { id: 'approved-work', name: 'Approved work', homes: ['creative-director'], appId: null, line: 'Work you have approved goes here, each version locked.', verb: 'See the J001 file',
    example: { title: A, lines: ['Approved: the brief, version 3, by the creative director.'] } },
  { id: 'direction-notes', name: 'Direction notes', homes: ['creative-director'], appId: null, line: 'Your notes to the team go here, each tied to the work.', verb: 'Write a note',
    example: { title: A, lines: ['Note: The first line should sound like it is leaving the room.'] } },
  { id: 'clients', name: 'Clients', homes: ['account-service', 'management'], appId: 'ie.napkin.landing', line: 'Your clients go here.', verb: 'Add a client',
    example: { title: A, lines: ['Client A, an Irish whiskey. One live job, J001.'] } },
  { id: 'live-jobs', name: 'Live jobs', homes: ['account-service', 'management'], appId: null, line: 'Every job in flight goes here.', verb: 'Open job J001',
    example: { title: A, lines: ['J001, Client A. Brief signed. Territories next, due Friday.'] } },
  { id: 'approvals', name: 'Approvals', homes: ['account-service'], appId: null, line: 'What is waiting for a client or a senior goes here.', verb: 'Send for approval',
    example: { title: A, lines: ['Waiting for Client A: the brief, version 3. Sent Tuesday.'] } },
  { id: 'scope-estimates', name: 'Scope and estimates', homes: ['account-service'], appId: null, line: 'What a job covers and what it costs goes here.', verb: 'Start an estimate',
    example: { title: A, lines: ['Scope: three territories, two rounds of changes.'] } },
  { id: 'agency-dashboard', name: 'Agency dashboard', homes: ['management'], appId: null, line: 'Six plain numbers about the agency go here.', verb: 'See the J001 numbers',
    example: { title: A, lines: ['Live jobs: 1. Briefs signed this month: 1.'] } },
  { id: 'time-money', name: 'Time and money', homes: ['management'], appId: null, line: 'Hours and spend against each job go here.', verb: 'Open job J001',
    example: { title: A, lines: ['J001: 41 of 60 hours used.'] } },
  { id: 'traffic-board', name: 'Traffic board', homes: ['management'], appId: null, line: 'Who is on what, and when it is due, goes here.', verb: 'Open the board',
    example: { title: A, lines: ['Brief, Aoife, done. Territories, Ciaran, due Friday.'] } },
]

/** The doors the four Phase 1 homes show: each once, in the table's order. */
export const doorById = (id: string): Door | undefined => PHASE1_DOORS.find(d => d.id === id)

/** A door has a tool when its app is installed (or is the shell's own landing). */
export function hasTool(door: Door, installed: readonly string[]): boolean {
  return door.appId !== null && installed.includes(door.appId)
}

/** The Phase 1 doors that have no tool yet: each shows Empty. */
export function doorsWithoutTool(installed: readonly string[]): Door[] {
  return PHASE1_DOORS.filter(d => !hasTool(d, installed))
}
