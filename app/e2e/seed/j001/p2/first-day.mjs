// First day's fixtures (features/first-day.clan): a copywriter an admin of the agency adds and invites, and the pointers' count.
// The admin is the agency's own (ann@napkin), so the person is in the agency `napkin`; each test names its own person, because the
// stack keeps its People store for the whole run and one person is invited once.
export const INVITED = { name: 'Newcomer Test', roles: ['copywriter'] }
export const invitedFor = (tag, test) => ({ ...INVITED, username: `new${tag}${test}@napkin` })
export const POINTERS = 3
