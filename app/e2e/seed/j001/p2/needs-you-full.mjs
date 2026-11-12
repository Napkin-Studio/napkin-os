// Needs you's fixtures (features/needs-you-full.clan, v2 section 4, the alerts table). Each live row of the table: the event, how a
// test causes it through the documents' own writes (or the stack's test clock), and who it lands with, by the kind of need it makes:
// `lands` is [person, kind], `not` the people who have no need of any of the event's kinds on that job. Used by test 25.
// The rows still waiting on a record (WAITING) land nothing yet: the Rust table test holds them, there is nothing to cause here.
export const ALERTS = [
  // an edit after the lock: everyone on the job (its owner, its brief's signers, anyone who wrote a decision in it)
  { event: 'Brief changes version', cause: 'edit-after-lock', kinds: ['brief-changed'], lands: [['planning', 'brief-changed'], ['creativeDirector', 'brief-changed']], not: ['accountService', 'management', 'copywriter'] },
  // the client's answer asks for changes: account service first
  { event: 'Client comment or change request', cause: 'client-asks-changes', kinds: ['client-change'], lands: [['accountService', 'client-change']], not: ['copywriter', 'management', 'planning'] },
  // a step two days past its date: the approver, then the person who set the route
  { event: 'Approval overdue', cause: 'approval-two-days-late', kinds: ['approval', 'approval-chase'], lands: [['planning', 'approval'], ['accountService', 'approval-chase']], not: ['copywriter', 'management'] },
  // the day before the job's date: the job owner alone
  { event: 'Deadline within 48 hours', cause: 'day-before-deadline', kinds: ['deadline'], lands: [['planning', 'deadline']], not: ['creativeDirector', 'accountService', 'copywriter'] },
]
export const WAITING = [
  { event: 'Work scores under 24', record: 'judge' },
  { event: 'Request out of scope', record: 'scope (Phase 3)' },
  { event: 'Job hours near budget', record: 'confirmed hours (Phase 3)' },
]
