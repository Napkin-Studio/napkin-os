// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The golden for napkin_host::frame::compose (features/doc-open-direct.clan).
//
// Runs the shell's own frame composition, as it stood before it moved to
// napkin-host: the `prepared` useMemo of src/shell/AppRuntime.tsx (taken out of
// the file as written, not copied), then each host's last pass — the web's
// prepareAppHtml (src/host/http.ts), the desktop's identity and the device's
// prepareFrameHtml (src/host/wasmFrame.ts). Every input under
// crates/napkin-host/tests/fixtures/frame/ is composed for every option, and
// the SHA-256 and length of each page goes to expected.json there.
//
//   node scripts/frame-golden.mjs        (DUMP=<dir> also writes every page there)

import { build, transform } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('..', import.meta.url))
const fixtures = join(app, '../crates/napkin-host/tests/fixtures/frame')
export const ORIGIN_HOST = 'https://napkin.test'

// The useMemo body, exactly as AppRuntime.tsx has it.
const runtime = readFileSync(join(app, 'src/shell/AppRuntime.tsx'), 'utf8')
const start = runtime.indexOf('const prepared = useMemo(() => {')
const end = runtime.indexOf('}, [htmlContent, hasHumanView, renderModel, capture])')
if (start < 0 || end < 0) throw new Error('AppRuntime.tsx no longer has the prepared useMemo')
const body = runtime.slice(start + 'const prepared = useMemo(() => {'.length, end)
const fn = (await transform(
  `export function prepared(htmlContent, hasHumanView, renderModel, capture, getTheme, host, STRUCTURED_EDIT_BRIDGE, LEGACY_EDIT_BRIDGE, frameCapture) {${body}}`,
  { loader: 'ts', format: 'esm' },
)).code

const tmp = mkdtempSync(join(app, '.golden-'))
try {
  writeFileSync(join(tmp, 'prepared.mjs'), fn)
  writeFileSync(join(tmp, 'entry.ts'), `
    ;(globalThis as any).window = { location: { origin: ${JSON.stringify(ORIGIN_HOST)}, search: '' }, navigator: { userAgent: 'node' } }
    export { prepared } from './prepared.mjs'
    export { STRUCTURED_EDIT_BRIDGE } from ${JSON.stringify(join(app, 'src/bridge/structuredEditBridge'))}
    export { LEGACY_EDIT_BRIDGE } from ${JSON.stringify(join(app, 'src/bridge/legacyEditBridge'))}
    export { frameCapture } from ${JSON.stringify(join(app, 'src/dogfood/recorder'))}
    export { prepareFrameHtml } from ${JSON.stringify(join(app, 'src/host/wasmFrame'))}
    export { httpHost } from ${JSON.stringify(join(app, 'src/host/http'))}
  `)
  // Bundled as the unit tests are (tests/run.mjs): not minified.
  await build({
    entryPoints: [join(tmp, 'entry.ts')], outfile: join(tmp, 'entry.mjs'), bundle: true,
    platform: 'node', format: 'esm', target: 'node20', packages: 'external', logLevel: 'warning',
  })
  const m = await import(join(tmp, 'entry.mjs'))
  const origin = m.httpHost.clanOrigin()
  const hosts = {
    web: { prepareAppHtml: html => m.httpHost.prepareAppHtml(html) },
    desktop: { prepareAppHtml: html => html },
    device: { prepareAppHtml: m.prepareFrameHtml },
  }
  const inputs = readdirSync(fixtures).filter(f => /\.html(\.gz)?$/.test(f)).sort()
  const cases = {}
  for (const file of inputs) {
    const raw = readFileSync(join(fixtures, file))
    const html = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
    const name = file.replace(/\.html(\.gz)?$/, '')
    for (const [reach, host] of Object.entries(hosts))
      for (const model of ['authored', 'legacy'])
        for (const capture of [false, true])
          for (const theme of ['light', 'dark']) {
            const page = m.prepared(html, true, model, capture, () => theme, host,
              m.STRUCTURED_EDIT_BRIDGE, m.LEGACY_EDIT_BRIDGE, m.frameCapture)
            const bytes = Buffer.from(page, 'utf8')
            if (process.env.DUMP) writeFileSync(join(process.env.DUMP, `${name}.${reach}.${model}.${capture ? 'capture' : 'plain'}.${theme}.html`), bytes)
            cases[`${name}/${reach}/${model}/${capture ? 'capture' : 'plain'}/${theme}`] =
              { sha256: createHash('sha256').update(bytes).digest('hex'), len: bytes.length }
          }
  }
  writeFileSync(join(fixtures, 'expected.json'), JSON.stringify({ origin, cases }, null, 2) + '\n')
  console.log(`${Object.keys(cases).length} pages, origin ${origin}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
