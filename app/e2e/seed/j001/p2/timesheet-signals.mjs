// Timesheet signals' fixtures (features/timesheet-signals.clan): a fixture meeting the fake calendar returns, and nothing else.
// The meeting's title holds a canary so a telemetry or manager view that leaks a title would show.
export const FIXTURE_MEETING = { id: 'evt_fixture_1', title: 'J001 brief check with Client A', start: '2026-11-12T10:00:00Z', end: '2026-11-12T10:30:00Z', attendees: 2 }
export const FIXTURE_SIGNALS = { calendar: [FIXTURE_MEETING], slack: [], email: [] }
