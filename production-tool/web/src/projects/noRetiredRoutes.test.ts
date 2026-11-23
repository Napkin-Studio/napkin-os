// S1-22 (features/production-in-library.clan): nothing reads the relay's retired document routes. They answer 410 on
// the relay and 404 on napkin-web's proxy; a caller left in the shell, the OS shell or the deck engine would break
// quietly. A path counts when it opens a string (' " `), follows a template `}` or `/api`, and is `/clan` or
// `/projects` ending there or continuing with `/` or `?`. Prose, `clan-store`, `clan://` and the host's `/t/{t}/d/{doc}`
// routes do not match.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../..')
const ROOTS = ['production-tool/web/src', 'app/src', 'engine/deck']
const SKIP_DIRS = new Set(['node_modules', 'dist', '__pycache__', '.venv'])
const TEXT = /\.(ts|tsx|js|jsx|mjs|py|json|html)$/

const RETIRED = /(?:['"`]|\}|\/api)\/(?:clan|projects)(?:\/|\?|['"`]|$)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : TEXT.test(name) ? [p] : []
  })
}

describe('the retired relay routes', () => {
  it('the pattern catches the callers it is for and spares the rest', () => {
    for (const bad of ["fetch('/clan')", 'fetch(`${base}/clan/x`)', "get('/projects/' + id)", 'url = "/projects?x=1"', 'fetch(`/production/api/clan`)', "'/api/projects/p1'"])
      expect(RETIRED.test(bad), bad).toBe(true)
    for (const ok of ['clan://doc/1', "import x from '@napkin/clan-store'", '`/t/${t}/d/${doc}/save`', 'Your projects live in the library', '"projects"', "from '../projects/server'", 'the /clan format', 'Clan projects/'])
      expect(RETIRED.test(ok), ok).toBe(false)
  })

  it('no caller in the shell, the OS shell or the deck engine uses them', () => {
    const hits: string[] = []
    for (const root of ROOTS) {
      for (const f of files(join(REPO, root))) {
        if (f === fileURLToPath(import.meta.url)) continue
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (RETIRED.test(line)) hits.push(`${relative(REPO, f)}:${i + 1}: ${line.trim().slice(0, 120)}`)
        })
      }
    }
    expect(hits).toEqual([])
  })
})
