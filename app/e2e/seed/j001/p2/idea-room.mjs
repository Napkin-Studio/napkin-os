// The Idea room's seed document (features/idea-room.clan, contracts): every key of its schema, so a leak or a gate that reads
// a field the seed lacks would show. Cards are team, banned or ai; routes are forks. The app and its schema arrive with idea-room:
// the owning record keeps this in step with app/templates/idea-room/schema.json (a unit test checks it when the schema exists).
const card = (id, text, by, kind, extra = {}) => ({
  id, text, by, kind,
  brief_link: { insight: 'Younger drinkers think Irish whiskey is for someone else.', proposition: 'The easy way into Irish whiskey.' },
  votes: [{ by: 'dara@wk', at: '2026-11-12T10:00:00Z' }],
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
  card('card_1', 'A bar that closes its doors for one song.', 'maeve@wk', 'team'),
  card('card_2', 'A first pour with a friend who has never had one.', 'clodagh@wk', 'team'),
  card('card_3', 'The tasting note written by the bartender, on the coaster.', 'oisin@wk', 'team'),
  card('card_4', 'A neat and a long drink, side by side, same bottle.', 'maeve@wk', 'team'),
  card('card_5', 'The label that says how to start.', 'clodagh@wk', 'team'),
]
export const IDEA_ROOM = {
  title: 'J001 idea room',
  cards: Object.fromEntries(TEAM_CARDS.map(c => [c.id, c])),
  ai_open: { state: 'closed', by: null, decision: null },
  routes: {
    route_1: { name: 'One song', bet: 'A shared ritual makes a first pour feel safe.', cards: ['card_1', 'card_5'], branch: 'route-1', version: 'v1' },
    route_2: { name: 'The first pour', bet: 'Bringing a friend is the easiest way in.', cards: ['card_2', 'card_4'], branch: 'route-2', version: 'v1' },
    route_3: { name: 'The coaster', bet: 'The bartender is the guide, so the bar is the media.', cards: ['card_3'], branch: 'route-3', version: 'v1' },
  },
  chosen: { route: null, version: null, decision: null },
  upstream: { brief: { id: 'brief', version: 'v1' } },
}
/** The AI's three banned ideas, as the ban_default fixture returns them (answers/ban_default.json), for the match test. */
export const BANNED_MATCH_CARD = 'A bar that goes quiet for one song, with a countdown on the till screen.'
/** Own-words precedents (test 49): one that may show and three that never may. */
export const PRECEDENTS = [
  { id: 'prec_1', title: 'A pub that closed for a song', summary: 'An older house campaign.', source_url: 'https://precedents.example/house/1', rights: 'own_words', origin: 'house' },
  { id: 'prec_2', title: 'Not own words', summary: 'A summary kept for reference.', source_url: 'https://precedents.example/other/2', rights: 'summary', origin: 'house' },
  { id: 'prec_3', title: 'An awards entry', summary: 'Never shown.', source_url: 'https://precedents.example/award/3', rights: 'own_words', origin: 'cannes' },
  { id: 'prec_4', title: 'An effectiveness case', summary: 'Never shown.', source_url: 'https://precedents.example/effie/4', rights: 'own_words', origin: 'effie' },
]
