// Placeholder people for the role tests, one per live Phase 1 role, plus the extra shapes the role
// features need. Names only; no real person. The roster server of the e2e stack (stack.mjs) signs
// them in, with the roles on the roster line (features/roles-and-homes.clan). Shared as plain .mjs so
// the stack, which runs under Node alone, and the specs read one list.
export const PEOPLE = {
  planning: { username: 'aoife@wk', name: 'Aoife Test', roles: ['planning'] },
  creativeDirector: { username: 'dara@wk', name: 'Dara Test', roles: ['creative-director'] },
  accountService: { username: 'cian@wk', name: 'Cian Test', roles: ['account-service'] },
  management: { username: 'niamh@wk', name: 'Niamh Test', roles: ['management'] },
  // two roles, one merged home of five
  planningAndCreative: { username: 'tadhg@wk', name: 'Tadhg Test', roles: ['planning', 'creative-director'] },
  // an admin: every department, and the role switcher
  admin: { username: 'ann@napkin', name: 'Ann Test', roles: ['admin'] },
  // no role at all: every door, as before roles existed
  noRole: { username: 'sam@wk', name: 'Sam Test', roles: [] },
  // Phase 2 (features/j001-phase2-suite.clan): the five roles whose homes come with remaining-homes, appended
  // after the Phase 1 people so no Phase 1 test sees a change. All in the agency wk.
  artDirector: { username: 'oisin@wk', name: 'Oisin Test', roles: ['art-director'] },
  copywriter: { username: 'maeve@wk', name: 'Maeve Test', roles: ['copywriter'] },
  producer: { username: 'ruairi@wk', name: 'Ruairi Test', roles: ['producer'] },
  agencyBrain: { username: 'sinead@wk', name: 'Sinead Test', roles: ['agency-brain'] },
  traffic: { username: 'fionn@wk', name: 'Fionn Test', roles: ['traffic'] },
  // a second copywriter: the idea room's "a copywriter's pick is refused" and the script's writer-and-marker pair
  copywriter2: { username: 'clodagh@wk', name: 'Clodagh Test', roles: ['copywriter'] },
  // a Phase 1 role and a Phase 2 role: one merged home of five doors (test 20)
  planningAndCopywriter: { username: 'eoin@wk', name: 'Eoin Test', roles: ['planning', 'copywriter'] },
  // a second agency, its own suffix and so its own workspace: the wall tests (27, 38, 40, 62, 67)
  otherAgency: { username: 'bria@bq', name: 'Bria Test', roles: ['planning', 'account-service'] },
  otherAgencyAdmin: { username: 'barra@bq', name: 'Barra Test', roles: ['admin'] },
  // agency-setup: the admin of a new agency, one agency per width so a run at 390 and a run at 1440 each start from nothing.
  // The agency has no directory until its admin imports people; the roster stands in for the control list (stage 4).
  newAgencyAdmin: { username: 'cara@cr', name: 'Cara Test', roles: ['admin'] },
  newAgencyAdmin2: { username: 'cara@cs', name: 'Cara Test', roles: ['admin'] },
  // needs-you-full: a person with nothing waiting, who is on a job (they write one decision in it), so the empty Needs you names a next deadline
  needsQuiet: { username: 'brid@wk', name: 'Brid Test', roles: ['art-director'] },
  // an agency that never has a job, for the Live jobs Empty state (job-page)
  emptyAgency: { username: 'fia@empty', name: 'Fia Test', roles: ['account-service'] },
}

/** The roster file's lines: `user@agency<TAB>Display name<TAB>roles`. */
export const ROSTER_LINES = Object.values(PEOPLE).map(p => `${p.username}\t${p.name}\t${p.roles.join(',')}`)
