// The Phase 2 seed documents, one entry each: the record that owns it, the app that makes it, its title, the data written with
// patch-data (agent j001-seed), and the template schema it must fill completely. Every document holds every key its schema
// declares (app/tests/phase2Suite.test.ts fails when one lacks a key). Where the app is not on the branch yet, `seedPhase2`
// skips the document and says so; the owning record installs its app and the document is written from then on.
import { AGENCY_BRAIN, BRAIN_APP, CLIENT_BRAIN } from './napkin-brain.mjs'
import { IDEA_ROOM, IDEA_ROOM_APP } from './idea-room.mjs'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP, TV_SCRIPT } from './script-editor.mjs'

export const P2_DOCS = [
  { slug: 'idea-room', app: IDEA_ROOM_APP, title: 'J001 idea room', schema: 'app/templates/idea-room/schema.json', data: IDEA_ROOM },
  { slug: 'script-editor', app: SCRIPT_EDITOR_APP, title: 'J001 radio script', schema: 'app/templates/script-editor/schema.json', data: RADIO_SCRIPT },
  { slug: 'script-editor', app: SCRIPT_EDITOR_APP, title: 'J001 TV script', schema: 'app/templates/script-editor/schema.json', data: TV_SCRIPT },
  { slug: 'napkin-brain', app: BRAIN_APP, title: 'Client A brain', schema: 'app/templates/agency-brain/schema.json', data: CLIENT_BRAIN },
  { slug: 'napkin-brain', app: BRAIN_APP, title: 'Agency brain', schema: 'app/templates/agency-brain/schema.json', data: AGENCY_BRAIN },
]
