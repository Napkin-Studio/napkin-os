import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The working sign (the Deep O) turns only in the top bar's job chip (owner, 2026-10-15 "only with the mouse
// and on top bar"; Shrey 2026-11-17, features/production-new-ui.clan: the Deep O and the bar's job chip replace
// the quadrant loader and the busy pointer, so the pointer is gone; ui-behaviour 6.5). Everywhere else a job runs, the
// crew member doing it shows in AgentFigure's working state. This test fails when the loader, or its
// SVG class, shows up in any other source file.

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWED = new Set(['ui/loader/NapkinLoader.tsx', 'ui/JobTray.tsx'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('where the Napkin loader turns', () => {
  it('only the top bar job chip renders it; there is no busy pointer any more', () => {
    expect(sources(SRC).some((p) => /BusyPointer/.test(p))).toBe(false)
    const offenders = sources(SRC)
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /\bNapkinLoader\b|napkin-loader/.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(offenders).toEqual([])
  })
  it('the top bars get it through the one job button: the canvas bar, the editor bar, the script editor\'s bar, the phone bar', () => {
    const bars = readFileSync(join(SRC, 'ui/chrome/TopBars.tsx'), 'utf8')
    expect(bars.match(/<JobTray \/>/g)?.length).toBeGreaterThanOrEqual(2)
    // Script is on the shared EditorBar (features/topbar-declutter.clan), so it gets the button from there.
    expect(readFileSync(join(SRC, 'script/ScriptEditor.tsx'), 'utf8')).toContain('<EditorBar')
    expect(readFileSync(join(SRC, 'stages/PhoneReview.tsx'), 'utf8')).toContain('<CanvasBar phone />')
    expect(bars).toContain('<JobTray phone />')
  })
})
