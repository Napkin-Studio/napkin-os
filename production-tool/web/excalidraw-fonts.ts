// Excalidraw's fonts, served by us with two replaced (features/licence-gate.clan; owner's
// rulings, Shrey 2026-10-13). Excalidraw 0.18.1 loads each font face from
// window.EXCALIDRAW_ASSET_PATH + "fonts/<Family>/<file>.woff2" (src/excalidrawAssets.ts sets it),
// falling back to esm.sh only when that fails. This plugin puts Excalidraw's dist/prod/fonts
// under excalidraw-assets/ in the build (and serves them in dev), with Liberation Sans 2.1.5 and
// Cascadia Code 2407.24 (both OFL-1.1) in place of the files Excalidraw ships, under the same
// names. Each replacement is checked against its pinned sha256; a mismatch fails the build.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

export const ASSET_DIR = 'excalidraw-assets'
const HERE = dirname(fileURLToPath(import.meta.url))
export const OVERRIDES_DIR = join(HERE, 'fonts', 'excalidraw-overrides')

interface Override {
  family: string
  target: string
  file: string
  sha256: string
  licence_file: string
}

export function excalidrawFontsDir(): string {
  const req = createRequire(join(HERE, 'package.json'))
  // The entry is dist/prod/index.js or dist/dev/index.js (by condition); the package root is two up.
  // The production files are what a build serves, so take dist/prod/fonts either way.
  const root = dirname(dirname(dirname(req.resolve('@excalidraw/excalidraw'))))
  return join(root, 'dist', 'prod', 'fonts')
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** Every file to serve under excalidraw-assets/: path (e.g. "fonts/Liberation/LiberationSans-Regular.woff2")
 *  -> bytes. Throws when a replacement's hash or target is wrong, so a build never ships the old file. */
export function excalidrawFontAssets(fontsDir = excalidrawFontsDir(), overridesDir = OVERRIDES_DIR): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  for (const p of walk(fontsDir)) {
    out.set(['fonts', ...relative(fontsDir, p).split(sep)].join('/'), readFileSync(p))
  }
  const { overrides } = JSON.parse(readFileSync(join(overridesDir, 'overrides.json'), 'utf8')) as { overrides: Override[] }
  for (const o of overrides) {
    if (!out.has(o.target)) throw new Error(`excalidraw-fonts: ${o.target} is not in Excalidraw's fonts; the override for ${o.family} would not apply`)
    const bytes = readFileSync(join(overridesDir, o.file))
    if (sha256(bytes) !== o.sha256) throw new Error(`excalidraw-fonts: ${o.file} has sha256 ${sha256(bytes)}, not the pinned ${o.sha256}`)
    out.set(o.target, bytes)
    out.set(`fonts/${o.licence_file}`, readFileSync(join(overridesDir, o.licence_file)))
  }
  return out
}

export function excalidrawFonts(): Plugin {
  let assets: Map<string, Buffer> | undefined
  const get = () => (assets ??= excalidrawFontAssets())
  return {
    name: 'excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const base = server.config.base.replace(/\/?$/, '/')
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith(`${base}${ASSET_DIR}/`)) return next()
        const body = get().get(decodeURIComponent(url.slice(`${base}${ASSET_DIR}/`.length)))
        if (!body) return next()
        res.setHeader('Content-Type', url.endsWith('.woff2') ? 'font/woff2' : 'text/plain; charset=utf-8')
        res.end(body)
      })
    },
    generateBundle() {
      for (const [path, source] of get()) this.emitFile({ type: 'asset', fileName: `${ASSET_DIR}/${path}`, source })
    },
  }
}
