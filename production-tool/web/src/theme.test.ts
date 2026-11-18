// @vitest-environment happy-dom
// The tool's theme switch (features/theme-and-pencil.clan): Light / Dark / System in the account
// menu keep the shell's key the shell's way (app/src/theme.ts: 'light' or 'dark' stored, nothing
// stored = follow the OS) and apply at once, with no reload.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getTheme, onThemeChange, setThemeChoice, STORAGE_KEY, themeChoice } from './theme'
import { ThemeChoices } from './ui/chrome/Bar'

function memory() {
  const m = new Map<string, string>()
  return { m, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

describe('Light / Dark / System', () => {
  it('Light and Dark store the side under napkin.theme and flip <html> at once', () => {
    const s = memory()
    const seen: string[] = []
    const off = onThemeChange((t) => seen.push(t))
    setThemeChoice('dark', s)
    expect(s.m.get(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(getTheme()).toBe('dark')
    setThemeChoice('light', s)
    expect(s.m.get(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(seen).toEqual(['dark', 'light'])
    off()
  })

  it('System forgets the choice, as the shell reads "follow the OS"', () => {
    const s = memory()
    setThemeChoice('dark', s)
    setThemeChoice('system', s)
    expect(s.m.has(STORAGE_KEY)).toBe(false)
    expect(themeChoice(() => null)).toBe('system')
    expect(themeChoice(() => 'dark')).toBe('dark')
    expect(themeChoice(() => 'purple')).toBe('system')
  })

  it('a store that throws still switches the theme', () => {
    const bad = { setItem: () => { throw new Error('SecurityError') }, removeItem: () => { throw new Error('SecurityError') } }
    setThemeChoice('dark', bad)
    expect(getTheme()).toBe('dark')
    setThemeChoice('light', bad)
    expect(getTheme()).toBe('light')
  })

  it('the account menu offers the three, the current one checked', () => {
    const html = renderToStaticMarkup(createElement(ThemeChoices))
    expect(html).toContain('role="radiogroup"')
    for (const l of ['Light', 'Dark', 'System']) expect(html).toContain(`>${l}<`)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })
})
