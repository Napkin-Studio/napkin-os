// The Idea room's seed document (features/idea-room.clan, contracts): every key of its schema, so a leak or a gate that reads
// a field the seed lacks would show. Cards are team, banned or ai; routes are forks. The app and its schema arrive with idea-room:
// the owning record keeps this in step with app/templates/idea-room/schema.json (a unit test checks it when the schema exists).
const card = (id, text, by, kind, extra = {}) => ({
  id, text, by, kind, at: '2026-11-12T09:10:00Z',
  brief_link: { insight: 'Younger drinkers think Irish whiskey is for someone else.', proposition: 'The easy way into Irish whiskey.' },
  votes: ['dara@wk'],
  comments: [{ by: 'aoife@wk', at: '2026-11-12T10:05:00Z', text: 'Say who it is for.' }],
  tests: {
    swap: { answer: 'pass', reason: 'Swap the name and the card stops making sense.' },
    fame: { headline: 'The bar that shut for one song.', friend_line: 'Have you heard about the bar that closes for one song?' },
    banned_match: { banned: null, by: null, at: null },
  },
  ...extra,
})

export const IDEA_ROOM_APP = 'ie.napkin.idea-room'
export const TEAM_CARDS = [
  card('c1', 'A bar that closes its doors for one song.', 'maeve@wk', 'team'),
  card('c2', 'A first pour with a friend who has never had one.', 'clodagh@wk', 'team'),
  card('c3', 'The tasting note written by the bartender, on the coaster.', 'oisin@wk', 'team'),
  card('c4', 'A neat and a long drink, side by side, same bottle.', 'maeve@wk', 'team'),
  card('c5', 'The label that says how to start.', 'clodagh@wk', 'team'),
]
const route = (name, bet, cards, branch) => ({
  name, bet, cards, version: 2, started_by: 'dara@wk', branch,
  notes: [{ by: 'maeve@wk', at: '2026-11-12T11:00:00Z', text: 'The film is the pour.' }],
})
/**
 * Every key of the template schema, for the suite's key check (app/tests/phase2Suite.test.ts). The host owns these keys (cards, routes,
 * the pick, the opening): no patch writes them, so `seedPhase2` does not patch this object. It makes the room and writes its team cards
 * through the host's own operation as the signed-in person (`HOST_OWNED`), and the rest is what the idea-room spec makes through the tool.
 */
export const IDEA_ROOM = {
  cards: Object.fromEntries(TEAM_CARDS.map(c => [c.id, c])),
  ai_open: { state: 'early', by: 'dara@wk', decision: 'd_seed', at: '2026-11-12T09:30:00Z', reason: 'The team asked for help.' },
  routes_out: ['route_4'],
  routes: {
    route_1: route('One song', 'A shared ritual makes a first pour feel safe.', ['c1', 'c5'], 'route_1'),
    route_2: route('The first pour', 'Bringing a friend is the easiest way in.', ['c2', 'c4'], 'route_2'),
    route_3: route('The coaster', 'The bartender is the guide, so the bar is the media.', ['c3'], 'route_3'),
  },
  chosen: { route: 'route_1', version: '2', decision: 'd_seed_pick', by: 'dara@wk', at: '2026-11-12T12:00:00Z' },
}
/** The seed writes these keys through the host's operations, never with a patch. */
export const HOST_OWNED = true
/** The AI's three banned ideas, as the ban_default fixture returns them (answers/ban_default.json), for the match test. */
export const BANNED_MATCH_CARD = 'A bar that goes quiet for one song, with a countdown on the till screen.'
/** Own-words precedents (test 49): one that may show and three that never may. */
export const PRECEDENTS = [
  { id: 'prec_1', title: 'A pub that closed for a song', summary: 'An older house campaign.', source_url: 'https://precedents.example/house/1', rights: 'own_words', origin: 'house' },
  { id: 'prec_2', title: 'Not own words', summary: 'A summary kept for reference.', source_url: 'https://precedents.example/other/2', rights: 'summary', origin: 'house' },
  { id: 'prec_3', title: 'An awards entry', summary: 'Never shown.', source_url: 'https://precedents.example/award/3', rights: 'own_words', origin: 'cannes' },
  { id: 'prec_4', title: 'An effectiveness case', summary: 'Never shown.', source_url: 'https://precedents.example/effie/4', rights: 'own_words', origin: 'effie' },
]
