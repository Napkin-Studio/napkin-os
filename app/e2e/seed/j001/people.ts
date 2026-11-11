// Placeholder people for the role tests, one per live Phase 1 role. Names only; no real
// person. They join the roster the stack signs people in from (roles-and-homes adds the roles).
export const PEOPLE = {
  planning: { username: 'aoife@wk', name: 'Aoife Test' },
  creativeDirector: { username: 'dara@wk', name: 'Dara Test' },
  accountService: { username: 'cian@wk', name: 'Cian Test' },
  management: { username: 'niamh@wk', name: 'Niamh Test' },
} as const

export const ROSTER_LINES = Object.values(PEOPLE).map(p => `${p.username}\t${p.name}`)
