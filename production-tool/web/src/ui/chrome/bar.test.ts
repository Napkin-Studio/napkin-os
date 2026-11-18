import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeMark, MarkTile } from './Bar'
import { StudioMark } from '../Mark'

const TRIANGLE = 'M2 11 L7 3 L12 11 Z'

describe('the bar is the shell bar of the new UI (features/production-new-ui.clan)', () => {
  it('HomeMark and MarkTile still draw the logo where no bar is (signed out)', () => {
    expect(renderToStaticMarkup(createElement(HomeMark, { onClick: () => {} }))).toContain('aria-label="Home: your projects"')
    expect(renderToStaticMarkup(createElement(MarkTile))).not.toContain(TRIANGLE)
    expect(renderToStaticMarkup(createElement(StudioMark, { size: 20 }))).toContain('viewBox="0 0 22 22"')
  })
  it('the canvas bar and every editor bar are the slim ShellBar: the brand pill, the film, the crumb; the dot, Decisions, you', () => {
    const bars = readFileSync(new URL('./TopBars.tsx', import.meta.url), 'utf8')
    expect(bars.match(/<ShellBar /g)?.length).toBe(2)
    const shell = readFileSync(new URL('../shell/ShellBar.tsx', import.meta.url), 'utf8')
    const bar = shell.slice(shell.indexOf('export function ShellBar'), shell.indexOf('export function PlaceBar'))
    for (const part of ['<BrandPill />', '<DocSlot menu={menu} />', '<Crumbs crumb={crumb} />', '{job}', '<DecisionsButton', '<Account />']) expect(bar).toContain(part)
    // Shrey 2026-11-18/19: no medallion (the sphere ran off), no Production pill, no Continue in / Share / theme
    // button, no BETA or thumbs, and no page action in the bar.
    for (const gone of ['m1-medallion', '<ClientChip', '<ContinueIn', '<Share ', '<ThemeButton', 'BetaTag', 'Thumbs', 'primary', 'tools']) expect(bar).not.toContain(gone)
    expect(bars).not.toContain('BetaTag')
    expect(readFileSync(new URL('../Home.tsx', import.meta.url), 'utf8')).not.toContain('BetaTag')
  })
})

// The bars' small fixed set and the one More (features/topbar-declutter.clan).

const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('the film\'s ▾ menu holds the film\'s actions; each page\'s actions are in its band', () => {
  const bars = src('./TopBars.tsx')
  const menu = src('./DocMenu.tsx')
  it('the menu: New, Open…, All projects, Import/Export; Continue in, Share…, Rename, Duplicate; Data sharing, Light / Dark, Delete…', () => {
    const order = ['>New<', "'Open…'", '>All projects<', '>Import/Export<', '>Continue in<', '>Share…<', '>Rename<', "'Duplicate'", '>Data sharing<', '<ThemeRow />', '>Delete…<']
    const main = menu.slice(menu.indexOf('  return (\n    <>'))
    const at = order.map((o) => main.indexOf(o))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    for (const row of ['Download all media (zip)', 'Project as .clan + assets', 'Save now', 'Copy link', 'Link a brief…', 'New deck from this film']) expect(menu).toContain(row)
    expect(menu).toContain('shell.goHome()')
  })
  it('the canvas and every editor use it; an editor adds its own rows under its title', () => {
    expect(bars).toContain('menu={(close) => <DocMenu close={close} />}')
    expect(bars).toContain('<DocMenu close={close} page={{ title, head: moreHead || undefined, rows: pageRows(close) }} />')
    expect(src('../../script/ScriptEditor.tsx')).toContain('<EditorBar className="se-top"')
    expect(src('../../script/ScriptEditor.tsx')).toMatch(/<MenuItem icon=\{<LinkIcon \/>\} onSelect=\{[^]*?\}>Copy link to this<\/MenuItem>/)
  })
  it('the band: ← Canvas first, the page\'s primary at its right; Escape goes back when nothing else takes it', () => {
    const editor = bars.slice(bars.indexOf('export function EditorBar'))
    expect(editor).toMatch(/<Band [^>]*>\s*<BandBack label=\{back\} onClick=\{onBack\} \/>/)
    expect(editor).toContain('{primary && <span className="band-primary">{primary}</span>}')
    expect(editor).toContain('useEscapeBack(onBack, escapeBack && !holdEscape)')
    expect(src('../../stages/Storyboard.tsx')).toContain('holdEscape={!!selected}')
    expect(src('../../rooms/Rooms.tsx')).toContain('escapeBack={false}')
  })
  it('Script\'s band: Page | Video · Audio, Format, the length, then Plan shots, then Ask', () => {
    const script = src('../../script/ScriptEditor.tsx')
    const band = script.slice(script.indexOf('afterView={!phone && ('))
    expect(band.indexOf('<ScriptLength')).toBeLessThan(band.indexOf('{!tight && planActs}'))
    expect(band.indexOf('{!tight && planActs}')).toBeLessThan(band.indexOf('se-ask'))
  })
  it('Assets is on the canvas\'s + menu', () => {
    expect(src('../../canvas/chrome/CanvasChrome.tsx')).toContain("panels.toggle('assets')")
  })
  it('Storyboard does not repeat the project name, and every title carries its full text for the tooltip', () => {
    expect(src('../../stages/Storyboard.tsx')).not.toContain('<span className="pt-project">{projectName}</span>')
    expect(bars).toContain('<h1 className="pt-title sr-title" title={title}>{title}</h1>')
  })
  it('the Image editor\'s zoom is in the band, on its right (mock production-new-ui-v2 image)', () => {
    const image = src('../../stages/ImageEditor.tsx')
    const right = image.slice(image.indexOf('        right={('), image.indexOf('<Float anchor={versionsBtn}'))
    expect(right).toContain('<div className="ie-zoom" role="group" aria-label="Zoom">')
    expect(image.slice(image.indexOf('<div className="ie-stagewrap">'))).not.toContain('className="ie-zoom"')
  })
})

describe('Escape leaves an editor only when nothing else would take it', () => {
  it('not from text, nor while a menu, popover or dialog is open', async () => {
    const { escapeFree } = await import('./escapeBack')
    const doc = (html: string) => ({ querySelector: (q: string) => (q.split(',').some((x) => html.includes(x.trim().replace(/^\./, 'class="').replace(/^\[role="(.*)"\]$/, 'role="$1"'))) ? {} : null) }) as unknown as Document
    const el = (closest: boolean) => ({ closest: () => (closest ? {} : null) }) as unknown as Element
    expect(escapeFree(el(false), doc('<div></div>'))).toBe(true)
    expect(escapeFree(el(true), doc('<div></div>'))).toBe(false)
    expect(escapeFree(el(false), doc('<div role="menu"></div>'))).toBe(false)
    expect(escapeFree(el(false), doc('<div role="dialog"></div>'))).toBe(false)
  })
})

describe('the name in the bar (re-test N-D)', () => {
  it('keeps the number or copy mark apart, so a narrow bar cuts the start, never " 2"', async () => {
    const { nameParts } = await import('../shell/nameParts')
    expect(nameParts('PW Lumo Gen Z cut-down brief 2')).toEqual(['PW Lumo Gen Z cut-down brief', ' 2'])
    expect(nameParts('Rain (copy 3)')).toEqual(['Rain', ' (copy 3)'])
    expect(nameParts('Lumo 2026 launch')).toEqual(['Lumo 2026 launch', ''])
  })
})
