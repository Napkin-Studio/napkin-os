// A route for J001 with every field of every step set, including a client contact, so a leak would show (features/approval-route.clan).
// `stage` ids are the job's own; the approver is a person, the date is YYYY-MM-DD.
export const ROUTE = [
  { stage: 'brief-check', role: 'creative-director', approver: 'dara@wk', due: '2026-11-20', client_contact: null },
  { stage: 'client-confirm', role: 'client', approver: null, due: '2026-11-25', client_contact: { name: 'Client A approver', email: 'approver@client-a.example' } },
  { stage: 'territories', role: 'account-service', approver: 'cian@wk', due: '2026-12-02', client_contact: null },
]
/** The test clock the stack gives approval-route: two days past the brief-check due date. */
export const TWO_DAYS_LATE = '2026-11-22T09:00:00Z'
