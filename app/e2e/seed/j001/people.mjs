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
}

/** The roster file's lines: `user@agency<TAB>Display name<TAB>roles`. */
export const ROSTER_LINES = Object.values(PEOPLE).map(p => `${p.username}\t${p.name}\t${p.roles.join(',')}`)
