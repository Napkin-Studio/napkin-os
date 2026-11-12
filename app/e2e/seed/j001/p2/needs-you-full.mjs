// Needs you's fixtures (features/needs-you-full.clan, v2 section 4, the alerts table): each event and the people it lands with, in
// J001's roster. Used by test 25. Events are named as v2 words them.
export const ALERTS = [
  { event: 'Brief changes version', lands: ['planning', 'creativeDirector', 'accountService'], not: ['management', 'producer'] },
  { event: 'Work scores under 24', lands: ['creativeDirector'], not: ['management', 'accountService'] },
  { event: 'Client comment or change request', lands: ['accountService'], not: ['copywriter', 'management'] },
  { event: 'Request out of scope', lands: ['accountService'], not: ['copywriter'] },
  { event: 'Approval overdue', lands: ['creativeDirector', 'accountService'], not: ['copywriter'] },
  { event: 'Job hours near budget', lands: ['producer', 'accountService', 'management'], not: ['copywriter'] },
]
