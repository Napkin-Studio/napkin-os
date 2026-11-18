import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the bar is the shell bar of the new UI (features/production-new-ui.clan)', () => {
  it('where no film is open (All projects, signed out, not confirmed, not on for the agency) the bar is PlaceBar: no old header', () => {
    const shell = readFileSync(new URL('../shell/ShellBar.tsx', import.meta.url), 'utf8')
    const place = shell.slice(shell.indexOf('export function PlaceBar'), shell.indexOf('export function Band'))
    for (const part of ['<Medallion state="awake" />', '<AgencyPill />']) expect(place).toContain(part)
    for (const f of ['../../Root.tsx', '../Home.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src).toContain('<PlaceBar')
      expect(src).not.toMatch(/hm-bar|hm-brand|MarkTile|BetaTag/)
    }
    expect(readFileSync(new URL('../home.css', import.meta.url), 'utf8')).not.toContain('.hm-bar')
  })
  it('the canvas bar and every editor bar are the ShellBar: the medallion, the document slot, Decisions', () => {
    const bars = readFileSync(new URL('./TopBars.tsx', import.meta.url), 'utf8')
    expect(bars.match(/<ShellBar /g)?.length).toBe(2)
    const shell = readFileSync(new URL('../shell/ShellBar.tsx', import.meta.url), 'utf8')
    for (const part of ['className="m1-medallion"', '<AgencyPill />', '<ClientChip />', '<DocSlot menu={menu} />', '<ContinueIn />', '<Share />', '<ThemeButton />', '<DecisionsButton']) expect(shell).toContain(part)
  })
})

// The bars' small fixed set and the one More (features/topbar-declutter.clan).

const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('the document menu holds what More held; secondary actions live there', () => {
  const bars = src('./TopBars.tsx')
  const canvasBar = bars.slice(bars.indexOf('export function CanvasBar'), bars.indexOf('export function EditorBar'))
  it('the canvas bar has no Export button: Export\'s rows and Save now are in its document menu', () => {
    expect(bars).not.toContain('function ExportMenu')
    expect(canvasBar).toContain('menu={(close) => <CanvasMoreItems close={close} share />}')
    expect(canvasBar).not.toMatch(/>\s*Export\s*</)
    const items = bars.slice(bars.indexOf('function CanvasMoreItems'), bars.indexOf('function ExportIcon'))
    for (const row of ['Download all media (zip)', 'Project as .clan + assets', 'Save now', 'Copy link']) expect(items).toContain(row)
  })
  it('every editor bar fills the document menu with its own rows; Script uses the shared EditorBar too', () => {
    const editor = bars.slice(bars.indexOf('export function EditorBar'))
    expect(editor).toContain('{more?.(close)}')
    expect(editor).toContain('<Band ')
    expect(src('../../script/ScriptEditor.tsx')).toContain('<EditorBar className="se-top"')
  })
  it('every editor\'s menu has the document rows, and no dead Copy link to this (live test 2026-11-18)', () => {
    expect(src('../../script/ScriptEditor.tsx')).toMatch(/<MenuItem icon=\{<LinkIcon \/>\} onSelect=\{[^]*?\}>Copy link to this<\/MenuItem>/)
    for (const f of ['Storyboard', 'ImageEditor']) expect(src(`../../stages/${f}.tsx`)).not.toContain('CopyLinkLater')
    expect(src('../../rooms/Rooms.tsx')).not.toContain('CopyLinkLater')
    expect(bars).toContain('<CanvasMoreItems close={close} share={false} />')
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

describe('the name in the bar (re-test N-D)', () => {
  it('keeps the number or copy mark apart, so a narrow bar cuts the start, never " 2"', async () => {
    const { nameParts } = await import('../shell/nameParts')
    expect(nameParts('PW Lumo Gen Z cut-down brief 2')).toEqual(['PW Lumo Gen Z cut-down brief', ' 2'])
    expect(nameParts('Rain (copy 3)')).toEqual(['Rain', ' (copy 3)'])
    expect(nameParts('Lumo 2026 launch')).toEqual(['Lumo 2026 launch', ''])
  })
})
