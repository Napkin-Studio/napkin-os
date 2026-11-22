// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// LESSONS 1, built is not deployed: Deck Maker worked on laptops and was never packed into the server image's seed. Territories must be
// packed everywhere an app is packed (the image, the dev bundle, the e2e stack) and the image's checks must say so, or this fails.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('Cargo.toml', root))) root = new URL('..', root)
const at = (rel: string) => readFileSync(new URL(rel, root), 'utf8')

test('the packer for Territories exists and is the one the image runs', () => {
  assert.ok(existsSync(new URL('crates/clan-sdk/examples/make_territories.rs', root)))
  const docker = at('Dockerfile')
  assert.match(docker, /--example make_territories/)
  assert.match(docker, /\/out\/apps\/territories\.app\.clan/)
  // the image drops every example instance, so no sample Territories document is installed for people
  assert.match(docker, /rm -f \/srv\/napkin\/seed\/\*\.example\.clan/)
})

test('every place that packs the tool apps packs Territories', () => {
  assert.match(at('app/package.json'), /make_territories -- public\/apps\/territories\.app\.clan/)
  assert.match(at('app/e2e/stack.mjs'), /make_territories', join\(seed, 'territories\.app\.clan'\)/)
})

test('CI and the local check both assert territories.app.clan is in the image seed', () => {
  const ci = at('.github/workflows/ci.yml')
  assert.match(ci, /--entrypoint test napkin-web:ci -f \/srv\/napkin\/seed\/territories\.app\.clan/)
  assert.match(ci, /--entrypoint test napkin-web:ci ! -f \/srv\/napkin\/seed\/territories\.example\.clan/)
  assert.match(at('scripts/check.sh'), /napkin-web:check -f \/srv\/napkin\/seed\/territories\.app\.clan/)
})

test('the packed app is the one the contract names, accepting a brief and research', () => {
  const packer = at('crates/clan-sdk/examples/make_territories.rs')
  assert.match(packer, /APP_ID: &str = "ie\.napkin\.territories"/)
  assert.match(packer, /ie\.napkin\.brief-maker/)
  assert.match(packer, /ie\.napkin\.campaign-research/)
  assert.match(packer, /upstream: true/)
})
