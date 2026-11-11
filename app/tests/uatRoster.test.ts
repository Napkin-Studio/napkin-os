// UAT's own sign-in roster (infra/scripts/accounts.uat.tsv; features/uat-environment.clan): the studio's
// accounts, kept in step with accounts.napkin.tsv, and a mock sign-in for every agency look in the registry,
// each opening in that look. Only UAT's image carries it (Dockerfile ROSTER, deploy.yml build-args).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENCY_COLOURS, agencyOfSignInName } from '../src/shell/agency/palette'

// The repository root: the first folder up holding the Dockerfile (the runner compiles tests elsewhere).
function repo(): string { let d = dirname(fileURLToPath(import.meta.url)); while (!existsSync(join(d, 'Dockerfile'))) { const up = dirname(d); if (up === d) throw new Error('no repository root'); d = up } return d }
const root = repo()
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const names = (f: string) => read(f).split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('\t')[0])
const uat = names('infra/scripts/accounts.uat.tsv')
const studio = names('infra/scripts/accounts.napkin.tsv')

test('UAT signs in everyone the studio roster does', () => {
  for (const n of studio) assert.ok(uat.includes(n), `${n} is on accounts.uat.tsv`)
})

test('UAT has a mock sign-in for every agency look, and each opens in that look', () => {
  for (const id of Object.keys(AGENCY_COLOURS)) {
    const who = uat.filter(n => agencyOfSignInName(n) === id)
    assert.ok(who.length > 0, `a sign-in on accounts.uat.tsv opens in the ${id} look`)
  }
  assert.equal(new Set(uat).size, uat.length, 'no one twice')
  for (const n of uat) assert.match(n, /^[a-z0-9._-]+@[a-z0-9.-]+$/, `${n} is user@agency`)
})

test('only UAT builds with its roster; staging and production keep the studio roster', () => {
  const dock = read('Dockerfile')
  assert.match(dock, /ARG ROSTER=accounts\.napkin\.tsv\nCOPY infra\/scripts\/\$\{ROSTER\} \/srv\/napkin\/accounts\.tsv/)
  const wf = read('.github/workflows/deploy.yml')
  assert.match(wf, /build-args: ROSTER=\$\{\{ env\.TARGET == 'uat' && 'accounts\.uat\.tsv' \|\| 'accounts\.napkin\.tsv' \}\}/)
})
