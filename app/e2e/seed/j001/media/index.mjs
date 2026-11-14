// J001's media fixtures (features/j001-phase3-suite.clan, done_when 3): one product photo, one scamp, a 30 second radio script,
// a 10 second TV script with beat ids, one approved layout and two site placeholders with known corners. Drawn by make_media.py,
// owned by Napkin, hash-proved by verify.mjs. READ ONLY: a spec imports this list and the files' bytes; it never edits them.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Next to this file; a bundle (app/tests/run.mjs) moves import.meta.url, so the folder is also looked for under the app's working directory.
const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
export const MEDIA_DIR = existsSync(join(here, 'manifest.json')) ? here : resolve(process.cwd(), 'e2e/seed/j001/media')
const manifest = JSON.parse(readFileSync(join(MEDIA_DIR, 'manifest.json'), 'utf8'))

/** Every fixture file: { name, kind, bytes, sha256, owner, drawn_by, ...}. */
export const MEDIA_FILES = manifest.files

const byName = name => {
  const f = MEDIA_FILES.find(x => x.name === name)
  if (!f) throw new Error(`${name} is not in media/manifest.json`)
  return { ...f, path: join(MEDIA_DIR, name) }
}

export const MEDIA = {
  bottle: byName('bottle.png'),
  scamp: byName('scamp.png'),
  radio: byName('radio-30s.json'),
  tv: byName('tv-10s.json'),
  layout: byName('layout.json'),
  sheet48: byName('site-48-sheet.png'),
  shelter: byName('site-bus-shelter.png'),
}

/** The five site placeholders (48 sheet, 6 sheet, bus shelter, station panel, digital screen), each with its four corners. */
export const SITES = MEDIA_FILES.filter(f => f.kind === 'site').map(f => byName(f.name))

/** The bytes of a fixture file. */
export const mediaBytes = name => readFileSync(join(MEDIA_DIR, name))
/** A fixture JSON file, parsed (the scripts and the layout). */
export const mediaJson = name => JSON.parse(readFileSync(join(MEDIA_DIR, name), 'utf8'))
