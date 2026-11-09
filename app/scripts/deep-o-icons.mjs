// Write every static copy of the Deep O mark from its one source,
// src/brand/deepOSvg.ts, so none of them is a hand-kept copy:
//
//   public/favicon.svg                          the small cut, awake (also the manifest's "any" icon)
//   public/icons/icon-192.png, icon-512.png     the satin mark, awake (the manifest's PNGs)
//   crates/napkin-host/assets/home_app.html     the home CLAN app's loading sign, between its deep-o marks
//
// Run from app/: node scripts/deep-o-icons.mjs   (needs rsvg-convert for the PNGs)
// tests/deepOMark.test.tsx fails when a written copy no longer matches the source.
// The boot splash in index.html needs no copy: vite.config.ts writes it at build.

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const app = fileURLToPath(new URL('..', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'deep-o-'))
try {
  const out = join(tmp, 'deepOSvg.mjs')
  await build({ entryPoints: [join(app, 'src/brand/deepOSvg.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' })
  const O = await import(pathToFileURL(out).href)

  writeFileSync(join(app, 'public/favicon.svg'), O.faviconSvg() + '\n')

  for (const px of [192, 512]) {
    const src = join(tmp, `icon-${px}.svg`)
    writeFileSync(src, O.appIconSvg(px))
    const r = spawnSync('rsvg-convert', ['-w', String(px), '-h', String(px), '-o', join(app, `public/icons/icon-${px}.png`), src], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`rsvg-convert failed for ${px}px`)
  }

  const home = join(app, '../crates/napkin-host/assets/home_app.html')
  const html = readFileSync(home, 'utf8')
  const next = O.homeAppRegions(html)
  writeFileSync(home, next)
  console.log('deep-o: favicon, icons and the home app written')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
