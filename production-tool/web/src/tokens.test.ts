// The tool wears the new UI's tokens (features/production-new-ui.clan): the shell's own file
// (app/src/shell/nui/tokens.css) is imported before styles.css, which adds only the tool's tokens, in
// terms of the shell's, and redefines none of the shell's but the approved --ink3. The agency layer
// (palette.ts surfaceCss) comes after both (ui/shell/agency.ts).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { storedTheme } from './theme'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const SHELL = read('../../../app/src/shell/nui/tokens.css')
const OURS = read('./styles.css')
const MAIN = read('./main.tsx')

/** The custom properties in the first block whose selector starts with `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`no ${selector}`)
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('\n}', i))
  const out = new Map<string, string>()
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().toLowerCase().replace(/\s+/g, ' '))
  return out
}

/** Every custom property a stylesheet defines anywhere. */
const defined = (css: string) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{\s])--([\w-]+)\s*:/g)].map((m) => m[1]))

describe('the tokens are the new UI\'s', () => {
  it('main.tsx imports the shell\'s tokens before the tool\'s', () => {
    const a = MAIN.indexOf("import '@napkin/app/shell/nui/tokens.css'")
    const b = MAIN.indexOf("import './styles.css'")
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
  })
  it('styles.css redefines no shell token but the approved --ink3', () => {
    const shell = defined(SHELL)
    const clash = [...defined(OURS)].filter((k) => shell.has(k) && k !== 'ink3')
    expect(clash).toEqual([])
    expect(block(OURS, ":root,\n:root[data-theme='light']").get('ink3')).toBe('var(--muted)')
  })
  it('the action, the selection and the agency are the agency\'s act colour; needs are amber, never brand red', () => {
    const light = block(OURS, ":root,\n:root[data-theme='light']")
    expect(light.get('action')).toBe('var(--ag-act)')
    expect(light.get('action-fg')).toBe('var(--ag-act-ink)')
    expect(light.get('tool')).toBe('var(--ag-act)')
    expect(light.get('agency')).toBe('var(--ag-act)')
    expect(light.get('create')).toBe('var(--needs, var(--warn))')
    expect(OURS).not.toMatch(/#d63b1f|#ff4f2e/i)
  })
  it('the crew colours are the shell figures\'', () => {
    // The shell moved to role spheres (#151); the tool keeps its crew until its own rework, so its colours
    // are checked against the shell's sheet as it was, frozen in agents/house-sheet.fixture.html (2026-11-11).
    const shell = block(read('./ui/agents/house-sheet.fixture.html'), '.agent-figure,')
    const ours = block(read('./ui/agents/AgentFigure.css'), '.agent-figure,')
    for (const k of ['af-cobalt', 'af-coral', 'af-marigold', 'af-iris', 'af-mint', 'af-mark']) expect(ours.get(k)).toBe(shell.get(k))
  })
  it('no theme follows the OS alone: dark is chosen by data-theme', () => {
    expect(OURS).not.toMatch(/prefers-color-scheme/)
  })
})

describe('the theme switch is the shell\'s', () => {
  it('reads the shell\'s stored choice, and nothing else', () => {
    expect(storedTheme(() => 'dark')).toBe('dark')
    expect(storedTheme(() => 'light')).toBe('light')
    expect(storedTheme(() => 'sepia')).toBeNull()
    expect(storedTheme(() => { throw new Error('locked down') })).toBeNull()
  })
})
