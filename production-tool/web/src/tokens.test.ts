// The tool follows the Napkin OS shell's palette exactly (features/production-ui.clan): every design
// token the shell defines (app/src/index.css) has the shell's value here, in light and in dark, except
// the owner's approved differences (ui-behaviour 9). The crew colours match the shell's figures.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { storedTheme } from './theme'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const SHELL = read('../../../app/src/index.css')
const OURS = read('./styles.css')

/** The custom properties in the first block whose selector starts with `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`no ${selector}`)
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('\n}', i))
  const out = new Map<string, string>()
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().toLowerCase().replace(/\s+/g, ' '))
  return out
}

/** The shell's legacy aliases (--bg, --text …) are its own compatibility layer, not design tokens. */
const LEGACY = new Set(['bg', 'surface', 'border', 'text', 'muted', 'accent', 'chip-bg', 'sidebar-w', 'toolbar-h'])
/** The owner's approved differences (ui-behaviour 9, 2026-10-14): grey text and green text. */
const APPROVED: Record<'light' | 'dark', Record<string, string>> = {
  light: { ink3: '#6b7180', success: '#166534', 'ok-fg': '#166534' },
  dark: {},
}

describe('the tokens are the shell\'s', () => {
  const cases = [
    ['light', ":root,\n:root[data-theme='light']"],
    ['dark', ":root[data-theme='dark']"],
    ['shared', ':root {\n  --f-display'],
  ] as const
  for (const [name, sel] of cases) {
    it(`${name}: every shell token has the shell's value, or an approved difference`, () => {
      const shell = block(SHELL, sel)
      const ours = name === 'shared' ? block(OURS, ':root {\n  /* The shell') : block(OURS, sel)
      const approved = name === 'shared' ? {} : APPROVED[name]
      const drift: string[] = []
      for (const [k, v] of shell) {
        if (LEGACY.has(k)) continue
        const want = approved[k] ?? v
        if (ours.get(k) !== want) drift.push(`--${k}: shell ${v}, ours ${ours.get(k) ?? 'missing'}`)
      }
      expect(drift).toEqual([])
    })
  }
  it('the approved differences are the ones the owner chose', () => {
    const light = block(OURS, ":root,\n:root[data-theme='light']")
    expect(light.get('action')).toBe('#d63b1f')
    expect(light.get('ink3')).toBe('#6b7180')
    expect(light.get('tool-ink')).toBe('#1e4ed8')
    expect(light.get('success')).toBe('#166534')
  })
  it('the crew colours are the shell figures\'', () => {
    const shell = block(read('../../../app/src/studio/AgentFigure.css'), '.agent-figure,')
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
