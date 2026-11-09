// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// An app's version is typed by hand, and a document is told a newer app is
// installed when the app's own entries differ (doc-app-upgrade). So a change
// to an app — its page, schemas, pipeline or app block — must come with a new
// version, or two different apps would go by one name. app/templates/<app>/
// app.lock holds one line per version, oldest first: `<version> <digest>`,
// the digest over every source the app is built from. Change the app and
// this fails until you bump the version in its make_<app>.rs and add the
// line it prints.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** The repo root, found from wherever the runner put this bundle. */
function root(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'app', 'templates', 'shared', 'clan-fields.html'))) return dir
    dir = dirname(dir)
  }
  return join(process.cwd(), '..')
}

/** The apps that ship, and the packer that builds each. */
const APPS: Record<string, string> = {
  'brief-maker': 'make_brief_maker.rs',
  'campaign-research': 'make_campaign_research.rs',
  'deck-maker': 'make_deck_maker.rs',
}

/** Not the app: its example document, tools, notes, the agent's own words, the lock itself. */
const NOT_THE_APP = new Set(['example', 'tools', 'README.md', 'context.md', 'agent', 'app.lock'])

function walk(dir: string, top = true): string[] {
  return readdirSync(dir).flatMap(name => {
    if (top && NOT_THE_APP.has(name)) return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p, false) : [p]
  })
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/** `sha256:<hex>` over every source `app` is built from, by path. */
function appDigest(app: string): string {
  const r = root()
  const files = [
    ...walk(join(r, 'app', 'templates', app)),
    ...walk(join(r, 'app', 'templates', 'shared'), false),
    join(r, 'crates', 'clan-sdk', 'examples', APPS[app]),
    join(r, 'crates', 'clan-sdk', 'examples', 'shared', 'app_ui.rs'),
  ]
  const lines = files
    .map(f => relative(r, f).split('\\').join('/'))
    .sort()
    .map(p => `${p}:${sha(readFileSync(join(r, p)))}\n`)
  return `sha256:${sha(lines.join(''))}`
}

/** The version the packer stamps. */
function versionOf(app: string): string {
  const src = readFileSync(join(root(), 'crates', 'clan-sdk', 'examples', APPS[app]), 'utf8')
  const all = [...src.matchAll(/^\s*version: "([0-9.]+)"\.into\(\)/gm)].map(m => m[1])
  assert.equal(all.length, 1, `${APPS[app]} stamps one version`)
  return all[0]
}

const triple = (v: string) => v.split('.').map(Number).concat([0, 0, 0]).slice(0, 3)
const newer = (a: string, b: string) => {
  const [x, y] = [triple(a), triple(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

function lockOf(app: string): { version: string; digest: string }[] {
  const text = readFileSync(join(root(), 'app', 'templates', app, 'app.lock'), 'utf8')
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const [version, digest] = l.split(/\s+/)
    return { version, digest }
  })
}

for (const app of Object.keys(APPS)) {
  test(`${app}: a change to the app comes with a new version (app.lock)`, () => {
    const lock = lockOf(app)
    assert.ok(lock.length > 0, `${app}/app.lock lists its versions`)
    for (let i = 1; i < lock.length; i++) {
      assert.ok(newer(lock[i].version, lock[i - 1].version), `${app}/app.lock: ${lock[i].version} must be newer than ${lock[i - 1].version}`)
    }
    const last = lock[lock.length - 1]
    const digest = appDigest(app)
    const version = versionOf(app)
    if (digest !== last.digest) {
      assert.fail(`${app} changed since ${last.version}. Bump the version in crates/clan-sdk/examples/${APPS[app]} `
        + `above ${last.version} and add this line to app/templates/${app}/app.lock:\n<new version> ${digest}`)
    }
    assert.equal(version, last.version, `${APPS[app]} stamps ${version}, but app.lock's newest line is ${last.version}`)
  })
}

test('the digest follows the app’s own sources, not its example or notes', () => {
  const r = root()
  const research = walk(join(r, 'app', 'templates', 'campaign-research')).map(f => relative(r, f))
  assert.ok(research.some(p => p.endsWith('index.html')) && research.some(p => p.endsWith('findings.schema.json')))
  assert.ok(!research.some(p => /\/(example|tools|agent)\/|README\.md$|context\.md$/.test(p)), research.join(', '))
  assert.match(appDigest('deck-maker'), /^sha256:[0-9a-f]{64}$/)
})
