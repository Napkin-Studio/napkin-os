// Writes <name>.out.svg beside every <name>.svg here: what the shell's
// sanitiser (src/shell/agency/svgSanitise.ts) makes of it. The server's port
// (crates/napkin-web/src/svg_sanitise.rs) is held to these files byte for
// byte, so the preview and the stored logo never differ
// (features/agency-looks-admin.clan). hostile/*.svg are refused by the server
// before sanitising; their hostile/<name>.found.json is what it reports.
//
// Run from app/ after adding a fixture: node tests/fixtures/svg/write-out.mjs

import { build } from 'esbuild'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'svg-fixtures-'))
try {
  const out = join(tmp, 'svgSanitise.mjs')
  await build({ entryPoints: [join(here, '../../../src/shell/agency/svgSanitise.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' })
  const { sanitiseSvg } = await import(pathToFileURL(out).href)
  for (const f of readdirSync(here).filter(f => f.endsWith('.svg') && !f.endsWith('.out.svg')).sort()) {
    writeFileSync(join(here, f.replace(/\.svg$/, '.out.svg')), sanitiseSvg(readFileSync(join(here, f), 'utf8')))
  }
} finally { rmSync(tmp, { recursive: true, force: true }) }
