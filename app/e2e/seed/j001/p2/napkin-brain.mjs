// The Napkin Brain's seed (features/napkin-brain.clan, brain-page-model): a client brain, a second client's brain, an agency brain, in
// the page format the host checks and keeps append-only. A derived line holds no words (an id, a rule, a cite, slots that are ids, enums,
// dates and numbers); a curated line holds a person's own words and who approved it. Every key of a page and a line, the verified mark
// off (an idea is not accepted work), and one superseded line that names the line that replaced it. The client brain's vault names a
// client by its registry id: `seedPhase2` puts the job's client id there (the placeholder below stands in until then), and makes the
// agency's brain with no client.
export const BRAIN_APP = 'ie.napkin.agency-brain'
const cites = [{ doc: 'brief', decision: 'dec_fixture_1' }]
const curated = (id, text, extra = {}) => ({ id, kind: 'curated', rule: 'curated', text, approved_by: 'planning', cites, slots: {}, state: 'current', superseded_by: null, at: '2026-11-12T12:00:00Z', ...extra })
const derived = (id, rule, slots, extra = {}) => ({ id, kind: 'derived', rule, cites, slots, state: 'current', superseded_by: null, at: '2026-11-12T12:00:00Z', ...extra })
export const PLACEHOLDER_CLIENT = 'cli_0a1b2c3d'
export const CLIENT_BRAIN = {
  vault: { kind: 'client', client: PLACEHOLDER_CLIENT },
  pages: {
    'client-a-positioning': { type: 'client', title: 'Positioning', summary: 'Client A sells to bars first and shops second.', owner_role: 'planning', links: [], lines: [curated('ln_1', 'Client A sells to bars first and shops second.'), curated('ln_2', 'Shops first.', { state: 'superseded', superseded_by: 'ln_1' })] },
    'client-a-route': { type: 'idea', title: 'Chosen route', summary: 'A bar that closes its doors for one song.', owner_role: 'creative-director', links: ['client-a-positioning'], lines: [derived('ln_3', 'pick_route.v1', { route: 'route_one_song' })] },
  },
  sources: { brief: { head: 'v1' } },
  proposals: [],
}
export const OTHER_CLIENT_BRAIN = { ...CLIENT_BRAIN, vault: { kind: 'client', client: 'cli_0a1b2c3e' } }
export const AGENCY_BRAIN = { ...CLIENT_BRAIN, vault: { kind: 'agency', client: null }, pages: { 'agency-house-style': { type: 'lesson', title: 'House style', summary: 'How the agency writes.', owner_role: 'planning', links: [], lines: [curated('ln_9', 'Short lines, one thought.', { approved_by: 'laurence' })] } } }
