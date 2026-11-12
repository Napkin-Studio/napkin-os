// The Script editor's seed documents (features/script-editor.clan, contracts): a radio script and a TV script of Client A, an Irish
// whiskey, written to app/templates/script-editor/schema.json. RADIO_SCRIPT is what a copywriter starts a test from: no mark-up yet, no
// hand-off, one mandatory line missing on purpose (test 53) and one banned word in it. FULL_SCRIPT holds every key of the schema, so a
// unit test can check the seed and the schema stay in step.
export const SCRIPT_EDITOR_APP = 'ie.napkin.script-editor'

const beat = (id, kind, text, extra = {}) => ({ id, kind, text, ...extra })
export const RADIO_SCRIPT = {
  format: 'radio', slot_s: 30,
  proposition: 'The whiskey that waits for you.',
  cast: 'duo',
  script: {
    beats: [
      beat('b1', 'voice', 'Tonight, try something new.', { role: 'FVO' }),
      beat('b2', 'sfx', 'A bar goes quiet for one song.'),
      beat('b3', 'voice', 'The first pour is easy. Triple distilled. Smooth enough to drink neat or long.', { role: 'MVO' }),
    ],
    proposals: [],
    seq: 3,
  },
  // the mandatory line is missing from the beats on purpose (test 53), and one banned word is in them
  checks: {
    mandatory: [{ text: 'Drink responsibly', source: 'document' }, { text: 'Age 18 plus only', source: 'document' }],
    banned: [{ text: 'smooth', source: 'document' }],
  },
  handoffs: {},
}

export const TV_SCRIPT = {
  ...RADIO_SCRIPT, format: 'tv', slot_s: 30,
  script: {
    beats: [
      beat('b1', 'voice', 'The room goes quiet.', { role: 'VO', visual_action: 'A bar, late. The door half shut.' }),
      beat('b2', 'music', 'One song, low.', { visual_action: 'Close on the glass.' }),
      beat('b3', 'voice', 'Client A waits.', { role: 'VO', visual_action: 'The bottle, label forward.' }),
    ],
    proposals: [],
    seq: 3,
  },
}

/** Every key of the schema, with a value, for the test that holds the seed to the schema. */
export const FULL_SCRIPT = {
  ...RADIO_SCRIPT,
  script: {
    beats: [
      beat('b1', 'voice', 'Tonight, try something new.', { role: 'FVO', visual_action: '', voiceover: 'Tonight, try something new.', dialogue: '', on_screen_text: '', sound_intention: 'bar room, low', duration_s: 1.5 }),
    ],
    proposals: [{
      id: 'p1', beat: 'b1', was: 'Tonight, try something new.', text: 'Tonight, pour the first one.', kind: 'markup', note: 'Shorter.',
      by: 'human:dara@wk', at: '2026-11-12T11:00:00Z', status: 'accepted', answered_by: 'human:maeve@wk', answered_at: '2026-11-12T12:00:00Z', different_thought: false,
    }],
    seq: 1,
  },
  handoffs: {
    radio: { kind: 'script', id: 'script', revision: '1', content_hash: 'ab12' },
    film: { kind: 'script', id: 'script', revision: '1', content_hash: 'ab12' },
    judge: { kind: 'script', id: 'script', revision: '1', content_hash: 'ab12' },
  },
  film: { script: { current: 'r1', revisions: [] } },
}
