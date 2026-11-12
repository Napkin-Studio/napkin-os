// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Every door and More tools line of the nine homes (v2 section 4, the doors table) and what each shows while
// its tool does not exist yet: the Empty state, with a finished J001 example
// and one starting verb, never a blank box (v2 section 8, principle 8).
// A door whose tool comes in a later phase "shows its Empty state".
//
// All example content is de-identified: Client A, an Irish whiskey.

import type { Example } from './words'

/** The nine role ids of napkin-web/src/roles.rs. */
export type Role = 'planning' | 'creative-director' | 'account-service' | 'management' | 'art-director' | 'copywriter' | 'producer' | 'agency-brain' | 'traffic'
export const ROLES: readonly Role[] = ['planning', 'creative-director', 'account-service', 'management', 'art-director', 'copywriter', 'producer', 'agency-brain', 'traffic']

export interface Door {
  id: string
  /** On the door. */
  name: string
  /** Which of the nine homes lists it as a door (a home that lists it only under More tools is not named). */
  homes: readonly Role[]
  /** The installed app that serves it, when there is one at all. */
  appId: string | null
  /** One line on what goes here (the Empty state's first line). */
  line: string
  /** The one starting verb, on the button. */
  verb: string
  example: Example
}

const A = 'Example · Client A, an Irish whiskey'

export const DOORS: readonly Door[] = [
  { id: 'brief', name: 'Brief', homes: ['planning'], appId: 'ie.napkin.brief-maker', line: 'The brief for a job goes here.', verb: 'Start a brief',
    example: { title: A, lines: ['Proposition: The whiskey that waits for you.'] } },
  { id: 'research', name: 'Research', homes: ['planning'], appId: 'ie.napkin.campaign-research', line: 'Research for a job goes here, every fact with its source.', verb: 'Ask a question',
    example: { title: A, lines: ['Question: Who drinks Irish whiskey in the first hour of the evening?'] } },
  { id: 'territories', name: 'Territories', homes: ['planning'], appId: null, line: 'Territories grow from a signed brief.', verb: 'Open the J001 brief',
    example: { title: A, lines: ['Territory: A bar that closes its doors for one song.', 'Reference frame: one still from the bar, door half shut.'] } },
  { id: 'client-brains', name: 'Client brains', homes: ['planning', 'agency-brain'], appId: null, line: 'What the agency knows about one client goes here.', verb: 'Add what we know',
    example: { title: A, lines: ['Fact: Client A sells to bars first and shops second.', 'Source: the March tracking report, page 4.'] } },
  { id: 'presentations', name: 'Presentations', homes: ['planning', 'account-service'], appId: 'ie.napkin.deck-maker', line: 'Decks for a job go here.', verb: 'Build a deck',
    example: { title: A, lines: ['Deck: Territories for Client A, five slides.'] } },
  { id: 'ideas', name: 'Ideas', homes: ['creative-director', 'art-director', 'copywriter'], appId: null, line: 'Ideas for a job go here, the team first.', verb: 'Add an idea',
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
  { id: 'live-jobs', name: 'Live jobs', homes: ['account-service', 'management', 'producer', 'traffic'], appId: null, line: 'Every job in flight goes here.', verb: 'Open job J001',
    example: { title: A, lines: ['J001, Client A. Brief signed. Territories next, due Friday.'] } },
  { id: 'approvals', name: 'Approvals', homes: ['account-service'], appId: null, line: 'What is waiting for a client or a senior goes here.', verb: 'Send for approval',
    example: { title: A, lines: ['Waiting for Client A: the brief, version 3. Sent Tuesday.'] } },
  { id: 'scope-estimates', name: 'Scope and estimates', homes: ['account-service', 'producer'], appId: null, line: 'What a job covers and what it costs goes here.', verb: 'Start an estimate',
    example: { title: A, lines: ['Scope: three territories, two rounds of changes.'] } },
  { id: 'agency-dashboard', name: 'Agency dashboard', homes: ['management'], appId: null, line: 'Six plain numbers about the agency go here.', verb: 'See the J001 numbers',
    example: { title: A, lines: ['Live jobs: 1. Briefs signed this month: 1.'] } },
  { id: 'time-money', name: 'Time and money', homes: ['management'], appId: null, line: 'Hours and spend against each job go here.', verb: 'Open job J001',
    example: { title: A, lines: ['J001: 41 of 60 hours used.'] } },
  { id: 'traffic-board', name: 'Traffic board', homes: ['management', 'traffic'], appId: null, line: 'Who is on what, and when it is due, goes here.', verb: 'Open the board',
    example: { title: A, lines: ['Brief, Aoife, done. Territories, Ciaran, due Friday.'] } },
  { id: 'case-study-builder', name: 'Case study builder', homes: [], appId: null, line: 'A finished job becomes a case study here.', verb: 'Start from J001',
    example: { title: A, lines: ['Case study: The whiskey that waits for you, in one page.'] } },
  { id: 'job-memory', name: 'Job memory', homes: [], appId: null, line: 'What each job taught the agency goes here, in plain notes.', verb: 'Read the J001 notes',
    example: { title: A, lines: ['Learned: Client A asked for fewer words on the pack, twice.'] } },
  { id: 'compliance-watch', name: 'Compliance night watch', homes: [], appId: null, line: 'The overnight check against the Irish alcohol rules reports here.', verb: 'See the J001 check',
    example: { title: A, lines: ['Checked overnight: the radio script, version 2. One line to change before it goes out.'] } },
  { id: 'agency-brain', name: 'Agency Brain', homes: [], appId: null, line: 'What the agency remembers about clients, pitches, awards and case studies goes here.', verb: 'See what it holds',
    example: { title: A, lines: ['Client A, an Irish whiskey: one client brain, one live job, J001.'] } },
  { id: 'stills', name: 'Stills', homes: ['art-director'], appId: null, line: 'Stills for a job go here, each with how it was made.', verb: 'Make a still',
    example: { title: A, lines: ['Still: the bar with its door half shut, version 1, for the first territory.'] } },
  { id: 'video-motion', name: 'Video and motion', homes: ['art-director', 'copywriter', 'producer'], appId: null, line: 'Video and motion for a job go here, each cut beside its script.', verb: 'Start a cut',
    example: { title: A, lines: ['Cut: one song of silence in a bar, 30 seconds, version 1.'] } },
  { id: 'formats-in-situ', name: 'Formats and in situ', homes: ['art-director', 'copywriter'], appId: null, line: 'Each format goes here, with the work placed where it will run.', verb: 'Place a format',
    example: { title: A, lines: ['Format: a poster at a bus stop, the half shut door, one line below it.'] } },
  { id: 'shopper-stands', name: 'Shopper stands', homes: ['art-director'], appId: null, line: 'Shopper stands go here, drawn to the size of the shelf.', verb: 'Start a stand',
    example: { title: A, lines: ['Stand: an end of aisle display, three bottles and one card.'] } },
  { id: 'experiential', name: 'Experiential', homes: [], appId: null, line: 'Live events and pop ups go here, one plan for each.', verb: 'Plan an event',
    example: { title: A, lines: ['Event: a bar that closes its doors for one song, one night in Dublin.'] } },
  { id: 'craft-review', name: 'Craft review', homes: [], appId: null, line: 'Work waiting for a second eye on its craft goes here.', verb: 'Ask for a review',
    example: { title: A, lines: ['Waiting: the half shut door still, version 1. Note: crop closer on the handle.'] } },
  { id: 'script-editor', name: 'Script editor', homes: ['copywriter'], appId: null, line: 'Scripts for a job go here, each line and each version kept.', verb: 'Write a script',
    example: { title: A, lines: ['Script: radio, 30 seconds, version 2. First line: The room goes quiet.'] } },
  { id: 'radio', name: 'Radio', homes: ['copywriter', 'producer'], appId: null, line: 'Radio spots go here, from script to finished audio.', verb: 'Start a spot',
    example: { title: A, lines: ['Spot: 30 seconds, script approved, voice booked for Thursday.'] } },
  { id: 'timetables', name: 'Timetables', homes: ['producer', 'traffic'], appId: null, line: 'The dates for a job go here, from brief to delivery.', verb: 'Plan the dates',
    example: { title: A, lines: ['J001: brief signed, territories due Friday, radio recorded the week after.'] } },
  { id: 'pitches', name: 'Pitches', homes: ['agency-brain'], appId: null, line: 'Pitches the agency has made go here, won or lost.', verb: 'Add a pitch',
    example: { title: A, lines: ['Pitch: Client A, an Irish whiskey. Won. Three territories shown.'] } },
  { id: 'awards', name: 'Awards', homes: ['agency-brain'], appId: null, line: 'Awards and shortlists go here, each with the work it was for.', verb: 'Add an award',
    example: { title: A, lines: ['Shortlist: a radio script for Client A, entered once.'] } },
  { id: 'case-studies', name: 'Case studies', homes: ['agency-brain'], appId: null, line: 'Finished case studies go here, each tied to its job.', verb: 'Add a case study',
    example: { title: A, lines: ['Case study: Client A, an Irish whiskey. One page, signed off by the client.'] } },
  { id: 'proprietary-data', name: 'Proprietary data', homes: ['agency-brain'], appId: null, line: 'The agency\'s own data goes here. Only the Agency Brain opens it.', verb: 'Add a dataset',
    example: { title: A, lines: ['Rates: Irish radio, 30 seconds, updated in March.'] } },
  { id: 'timesheets', name: 'Timesheets', homes: ['traffic'], appId: null, line: 'Confirmed days go here, by job. An unconfirmed day or a correction never shows.', verb: 'See confirmed days',
    example: { title: A, lines: ['J001: 41 hours confirmed this month, across 4 people.'] } },
  { id: 'resources', name: 'Resources', homes: ['traffic'], appId: null, line: 'Who is free and who is booked goes here.', verb: 'Open the week',
    example: { title: A, lines: ['Week 47: Aoife on J001, Ciaran free from Wednesday.'] } },
]

/** Kept so a parallel branch that still imports the Phase 1 name builds. */
export const PHASE1_DOORS = DOORS

/** The content of one door, by id. */
export const doorById = (id: string): Door | undefined => DOORS.find(d => d.id === id)

/** A door has a tool when its app is installed (or is the shell's own landing). */
export function hasTool(door: Door, installed: readonly string[]): boolean {
  return door.appId !== null && installed.includes(door.appId)
}

/** The doors that have no tool yet: each shows Empty. */
export function doorsWithoutTool(installed: readonly string[]): Door[] {
  return DOORS.filter(d => !hasTool(d, installed))
}
