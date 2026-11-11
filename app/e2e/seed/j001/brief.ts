// The J001 pilot job, de-identified: Client A, an Irish whiskey. Every line here is invented.
// No real brand, client, person or place. Nothing from client_briefs/ is read or copied.
// The brief comes in two forms: the messy one a planner pastes in, and the one that passes the Brief gate.

export const JOB = { number: 'J001', client: 'Client A', title: 'J001 brief' } as const

/** The first draft as it arrives: notes, no objective, no baseline. */
export const MESSY_BRIEF = {
  project_name: 'J001 Client A Irish whiskey',
  client: 'Client A',
  brief_input:
    'Client A makes an Irish whiskey. Wants it to feel more modern for younger drinkers without losing the heritage. '
    + 'Competitors are louder. Launch is the autumn. Budget not yet agreed. Something for bars and a shopper stand. '
    + 'Hero it on social. Maybe film. Needs to be famous.',
  background: 'A long-established Irish whiskey with a loyal older drinker and little pull with under 35s.',
  audience: 'Drinkers aged 25 to 34 who choose a whiskey for the occasion, not the label.',
  single_minded_proposition: 'The easy way into Irish whiskey.',
  tone_and_world: ['Warm', 'Dry humour', 'Unhurried'],
  open_questions: ['What does success look like?', 'Who signs off?'],
}

/** The brief once the gate's six items are answered: what a planner would hand on. */
export const READY_BRIEF = {
  ...MESSY_BRIEF,
  insight: 'Younger drinkers think Irish whiskey is for someone else, and nobody has ever shown them how to start.',
  single_minded_proposition: 'The easy way into Irish whiskey.',
  objectives: {
    commercial: 'Grow bar and shopper-stand sales by 8% in the autumn quarter against last autumn.',
    behavioural: 'Get 25 to 34s to order the whiskey as their first Irish pour.',
    attitudinal: 'Move it from a drink for someone else to a drink for me.',
  },
  desired_response: { think: 'This is easy to start with.', feel: 'Welcome.', do: 'Order a first pour.' },
  famous: 'A bar that closes its doors for one song.',
  reasons_to_believe: ['Triple distilled', 'Smooth enough to drink neat or in a long drink'],
  measurement: ['Baseline: 6% of bar orders in the target age band this autumn. Target: 14% by December, from till data.'],
  budget_and_scope: 'Production budget agreed in hours on the job record. Social, bars, shopper stand.',
  mandatories: ['Drink responsibly line', 'Age 18 plus only'],
  open_questions: [],
  // Who signs this brief: the planner first, then the creative director (the people in people.ts).
  signers: [{ role: 'planner', person: 'aoife@wk' }, { role: 'creative_director', person: 'dara@wk' }],
}

export const RESEARCH_TITLE = 'J001 research'
export const DECK_TITLE = 'J001 pitch deck'
