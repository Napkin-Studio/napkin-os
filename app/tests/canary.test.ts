// ADR-004 (features/client-wall.clan): a key the server holds never reaches the
// browser. The shell is built with canary values in every variable a server
// key lives in, and the canary must be in no file of the bundle. The network
// half (no server response carries it) is crates/napkin-web/tests/canary.rs and
// server/tests/test_client_wall.py.

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { build } from 'vite'

const CANARY = 'canary-key-7f3a9c1e5b2d4086-DO-NOT-LEAK'
const SERVER_KEYS = [
  'NAPKIN_MODEL_API_KEY',
  'NAPKIN_TAVILY_API_KEY',
  'NAPKIN_JEV_API_KEY',
  'NAPKIN_RESEARCH_TOKEN',
  'NAPKIN_RETRIEVAL_TOKEN',
  'NAPKIN_LAYERS_TOKEN',
  'NAPKIN_TOKEN',
  'NAPKIN_SESSION_SECRET',
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

test('a canary key set on the server is not in the built bundle', { timeout: 600_000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out = mkdtempSync(join(tmpdir(), 'napkin-canary-'))
  const saved: Record<string, string | undefined> = {}
  for (const k of SERVER_KEYS) {
    saved[k] = process.env[k]
    process.env[k] = CANARY
  }
  try {
    await build({ root, logLevel: 'silent', build: { outDir: out, emptyOutDir: true, write: true } })
    const built = files(out)
    assert.ok(built.length > 0, 'the shell built')
    assert.ok(built.some(f => f.endsWith('.js')), 'a bundle was written')
    const leaks = built.filter(f => readFileSync(f).includes(CANARY))
    assert.deepEqual(leaks, [], 'the canary is in no file of the bundle')
  } finally {
    for (const k of SERVER_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    rmSync(out, { recursive: true, force: true })
  }
})
