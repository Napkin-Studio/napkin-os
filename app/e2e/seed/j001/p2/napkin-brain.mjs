// The Napkin Brain's seed (features/napkin-brain.clan, contracts): a client brain, a second client's brain, an agency brain.
// Every key of a page and a line, the verified mark off (an idea is not accepted work), and one superseded line.
export const BRAIN_APP = 'ie.napkin.agency-brain'
const line = (id, kind, text, extra = {}) => ({ id, kind, text, cites: [{ doc: 'brief', decision: 'dec_fixture_1' }], state: 'current', superseded_by: null, at: '2026-11-12T12:00:00Z', rule: 'brief.approved', ...extra })
export const CLIENT_BRAIN = {
  vault: { kind: 'client', client: 'Client A' },
  pages: {
    'client-a/positioning': { type: 'client', title: 'Positioning', summary: 'Client A sells to bars first and shops second.', owner_role: 'planning', links: [], lines: [line('ln_1', 'derived', 'Client A sells to bars first and shops second.'), line('ln_2', 'derived', 'Shops first.', { state: 'superseded', superseded_by: 'ln_1' })] },
    'client-a/route': { type: 'idea', title: 'Chosen route', summary: 'A bar that closes its doors for one song.', owner_role: 'creative-director', links: ['client-a/positioning'], lines: [line('ln_3', 'derived', 'Route one song chosen, not yet accepted by the client.', { rule: 'route.chosen' })] },
  },
  sources: { brief: { head: 'v1' } },
  proposals: [],
}
export const OTHER_CLIENT_BRAIN = { ...CLIENT_BRAIN, vault: { kind: 'client', client: 'Client B' } }
export const AGENCY_BRAIN = { ...CLIENT_BRAIN, vault: { kind: 'agency', client: null }, pages: { 'agency/house-style': { type: 'agency', title: 'House style', summary: 'How the agency writes.', owner_role: 'agency-brain', links: [], lines: [line('ln_9', 'curated', 'Short lines, one thought.', { rule: 'curated' })] } } }
