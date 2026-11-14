// Placeholder people for the role tests, one per live Phase 1 role, plus the extra shapes the role
// features need. Names only; no real person. The roster server of the e2e stack (stack.mjs) signs
// them in, with the roles the People store holds for them (features/align-needs-lock-people.clan):
// the Napkin people admin and the people of agencies the People page cannot add to yet come from the
// roster file, as a deployment's store is seeded; everyone else is added through the People store's
// own API (`addPeople`), as an admin adds them in production. Shared as plain .mjs so the stack, which
// runs under Node alone, and the specs read one list.
export const PEOPLE = {
  planning: { username: 'aoife@wk', name: 'Aoife Test', roles: ['planning'] },
  creativeDirector: { username: 'dara@wk', name: 'Dara Test', roles: ['creative-director'] },
  accountService: { username: 'cian@wk', name: 'Cian Test', roles: ['account-service'] },
  management: { username: 'niamh@wk', name: 'Niamh Test', roles: ['management'] },
  // two roles, one merged home of five
  planningAndCreative: { username: 'tadhg@wk', name: 'Tadhg Test', roles: ['planning', 'creative-director'] },
  // an admin: every department, and the role switcher
  admin: { username: 'ann@napkin', name: 'Ann Test', roles: ['admin'] },
  // no role at all: the desk and what is open to everyone signed in, and no role's pages or tools
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
  // needs-you-full: a person with nothing waiting, who is on a job (they write one decision in it), so the empty Needs you names a next deadline.
  // A producer: no Needs you rule addresses that role, so on the shared stack nothing reaches them by role (Judge's notes go to every
  // art director and copywriter when a job has none on it: as an art director, Brid was given the Judge tests' items).
  needsQuiet: { username: 'brid@wk', name: 'Brid Test', roles: ['producer'] },
  // align-landing-look, test 6: one person in each agency whose look is read. The code registry has wk (above) and these two;
  // the next two agencies are added from the People page by the Napkin people admin, which has an account of its own.
  lookCatapult: { username: 'kit@catapult', name: 'Kit Test', roles: ['planning'] },
  lookPluto: { username: 'pia@pluto', name: 'Pia Test', roles: ['planning'] },
  lookAcme: { username: 'ade@acme', name: 'Ade Test', roles: ['planning'] },
  lookKiln: { username: 'kim@kiln', name: 'Kim Test', roles: ['planning'] },
  peopleAdmin: { username: 'engineer@napkin', name: 'Eng Test', roles: ['admin'] },
  // an agency that never has a job, for the Live jobs Empty state (job-page)
  emptyAgency: { username: 'fia@empty', name: 'Fia Test', roles: ['account-service'] },
}

/** The agencies the People page adds a person to today: the shell registry's (people.rs CODE_AGENCIES). Any other is made by its
 *  own test (an agency added on the Agencies tab, or the setup of a new agency), so its people are seeded from the roster file. */
export const PAGE_AGENCIES = ['wk', 'tbwa', 'ogilvy', 'harbour', 'droga', 'napkin', 'boysandgirls', 'catapult', 'pluto', 'acne']

/** The people admin who adds everyone else, through the API. */
export const PEOPLE_ADMIN = 'engineer@napkin'

const fromFile = p => p.username === PEOPLE_ADMIN || !PAGE_AGENCIES.includes(p.username.split('@')[1])

/** The roster file's lines: `user@agency<TAB>Display name<TAB>roles`, for the people the store is seeded with. */
export const ROSTER_LINES = Object.values(PEOPLE).filter(fromFile).map(p => `${p.username}\t${p.name}\t${p.roles.join(',')}`)

/** Everyone else: added with their roles by the people admin through POST /api/admin/people. */
export const API_PEOPLE = Object.values(PEOPLE).filter(p => !fromFile(p))

/** Add API_PEOPLE to the roster server at `base`, signed in as the people admin. Throws on any refusal. */
export async function addPeople(base) {
  const signIn = await fetch(`${base}/api/auth/sign-in`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: PEOPLE_ADMIN }),
  })
  const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]
  if (!signIn.ok || !cookie.startsWith('napkin_session=')) throw new Error(`the people admin could not sign in (${signIn.status})`)
  for (const p of API_PEOPLE) {
    const agency = p.username.split('@')[1]
    const r = await fetch(`${base}/api/admin/people`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: p.name, agency, username: p.username, roles: p.roles }),
    })
    if (r.status !== 201) throw new Error(`${p.username} was not added (${r.status}): ${await r.text()}`)
  }
}
