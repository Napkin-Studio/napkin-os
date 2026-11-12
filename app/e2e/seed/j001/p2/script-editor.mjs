// The Script editor's seed document (features/script-editor.clan, contracts): every key of its schema, a radio script and a TV script.
export const SCRIPT_EDITOR_APP = 'ie.napkin.script-editor'
const beat = (id, kind, text, extra = {}) => ({ id, kind, role: 'voice', text, visual_action: '', voiceover: '', dialogue: '', on_screen_text: '', sound_intention: 'bar room, low', duration_s: 5, ...extra })
export const RADIO_SCRIPT = {
  format: 'radio', slot_s: 30,
  script: {
    beats: [
      beat('beat_1', 'line', 'Tonight, try something new.'),
      beat('beat_2', 'line', 'A bar goes quiet for one song, and the first pour is easy.'),
      beat('beat_3', 'line', 'Triple distilled. Smooth enough to drink neat or long.'),
    ],
    proposals: [{ id: 'prop_1', beat: 'beat_1', was: 'Tonight, try something new.', text: 'Tonight, pour the first one.', kind: 'markup', note: 'Shorter.', by: 'dara@wk', at: '2026-11-12T11:00:00Z', status: 'open', answered_by: null, answered_at: null, different_thought: false }],
  },
  // the brief's mandatory line is missing from the beats on purpose (test 53), and one banned word is in them
  checks: { mandatory: [{ text: 'Drink responsibly', source: 'the J001 brief' }, { text: 'Age 18 plus only', source: 'the J001 brief' }], banned: [{ text: 'smooth', source: 'house style' }] },
  handoffs: { radio: null, film: null, judge: null },
  upstream: { brief: { id: 'brief', version: 'v1' } },
}
export const TV_SCRIPT = {
  ...RADIO_SCRIPT, format: 'tv', slot_s: 30,
  script: { beats: [beat('beat_1', 'scene', 'A bar, late. The room goes quiet.', { visual_action: 'Door half shut.', sound_intention: 'one song' }), beat('beat_2', 'scene', 'A first pour.', { visual_action: 'Close on the glass.' })], proposals: [] },
}
