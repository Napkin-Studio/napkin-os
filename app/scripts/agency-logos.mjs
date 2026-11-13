// Bring an agency's logos into the repo, sanitised (palette.ts AGENCY_COLOURS
// references them; the owner's assets, 2026-11-11):
//
//   src/shell/agency/logos/<id>-logo.svg   the wordmark: shapes and fills only (agency/svgSanitise.ts)
//   src/shell/agency/logos/<id>-icon.png   the square mark: the PNG's image chunks only
//   src/shell/agency/logos/<id>-icon.svg   or a square mark drawn as shapes (sanitised as the wordmark)
//   src/shell/agency/logos.ts              both, inline, for the shell and the documents' frames
//
// Run from app/: node scripts/agency-logos.mjs <dir with the owner's files>
// To add an agency's files, add a line to FILES. tests/agencyLogos.test.ts
// fails when the committed files are not sanitised or logos.ts is out of step.

import { build } from 'esbuild'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Per agency id: its wordmark and icon as the owner sent them (either may be missing). */
const FILES = {
  boysandgirls: { logo: 'Boys+Girls-logo.svg', icon: 'Boys+Girls-icon.png' },
  // Catapult's icon is redrawn from their site's ring "C" (owner's reference, 2026-11-11): a ring, a bold C and its bar.
  catapult: { logo: 'Catapult-logo.svg', icon: 'catapult-icon.svg' },
  pluto: { logo: 'Pluto-logo.svg' },
}

const app = fileURLToPath(new URL('..', import.meta.url))
const dir = join(app, 'src/shell/agency/logos')

/** A PNG with only the chunks that draw it (IHDR, PLTE, tRNS, IDAT, IEND): no text, no metadata. */
export function stripPng(buf) {
  const SIG = '89504e470d0a1a0a'
  if (buf.subarray(0, 8).toString('hex') !== SIG) throw new Error('not a png')
  const keep = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
  const out = [buf.subarray(0, 8)]
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.subarray(i + 4, i + 8).toString('latin1')
    const end = i + 12 + len
    if (keep.has(type)) out.push(buf.subarray(i, end))
    i = end
    if (type === 'IEND') break
  }
  return Buffer.concat(out)
}

/** logos.ts from the committed files in logos/. */
export function logosModule(read) {
  const svg = {}, png = {}, iconSvg = {}
  for (const f of read.list().sort()) {
    const m = /^([a-z0-9]+)-(logo\.svg|icon\.png|icon\.svg)$/.exec(f)
    if (!m) continue
    if (m[2] === 'logo.svg') svg[m[1]] = read.text(f).trim()
    else if (m[2] === 'icon.svg') iconSvg[m[1]] = read.text(f).trim()
    else png[m[1]] = read.bytes(f).toString('base64')
  }
  const obj = o => '{\n' + Object.entries(o).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n') + '\n}'
  return `// Written by scripts/agency-logos.mjs from src/shell/agency/logos/: do not edit by hand.
// The agencies' logos, sanitised, inline: palette.ts AGENCY_COLOURS picks the copy for each ground.

/** Each agency's wordmark as committed in logos/<id>-logo.svg (shapes and fills only). */
export const WORDMARK_SVG: Readonly<Record<string, string>> = ${obj(svg)}

/** Each agency's square icon, logos/<id>-icon.png, as base64. */
export const ICON_PNG: Readonly<Record<string, string>> = ${obj(png)}

/** Each agency's square icon drawn as shapes, logos/<id>-icon.svg. */
export const ICON_SVG: Readonly<Record<string, string>> = ${obj(iconSvg)}
`
}

// Run as a script only (the test imports logosModule and stripPng from here).
if (/agency-logos\.mjs$/.test(process.argv[1] ?? '')) {
  const src = process.argv[2]
  if (src) {
    const tmp = mkdtempSync(join(tmpdir(), 'agency-logos-'))
    try {
      const out = join(tmp, 'svgSanitise.mjs')
      await build({ entryPoints: [join(app, 'src/shell/agency/svgSanitise.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' })
      const { sanitiseSvg } = await import(pathToFileURL(out).href)
      mkdirSync(dir, { recursive: true })
      for (const [id, f] of Object.entries(FILES)) {
        if (f.logo) writeFileSync(join(dir, `${id}-logo.svg`), sanitiseSvg(readFileSync(join(src, f.logo), 'utf8')) + '\n')
        if (f.icon?.endsWith('.svg')) writeFileSync(join(dir, `${id}-icon.svg`), sanitiseSvg(readFileSync(join(src, f.icon), 'utf8')) + '\n')
        else if (f.icon) writeFileSync(join(dir, `${id}-icon.png`), stripPng(readFileSync(join(src, f.icon))))
      }
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  }
  if (!existsSync(dir)) throw new Error('no logos yet: pass the directory with the owner\'s files')
  writeFileSync(join(app, 'src/shell/agency/logos.ts'), logosModule({
    list: () => readdirSync(dir),
    text: f => readFileSync(join(dir, f), 'utf8'),
    bytes: f => readFileSync(join(dir, f)),
  }))
}
