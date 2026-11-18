import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeMark, MarkTile } from './Bar'
import { StudioMark } from '../Mark'
import { CopyLinkLater } from './MoreMenu'
import { NOT_YET } from './panels'

const TRIANGLE = 'M2 11 L7 3 L12 11 Z'

describe('the bar is the shell bar of the new UI (features/production-new-ui.clan)', () => {
  it('HomeMark and MarkTile still draw the logo where no bar is (signed out)', () => {
    expect(renderToStaticMarkup(createElement(HomeMark, { onClick: () => {} }))).toContain('aria-label="Home: your projects"')
    expect(renderToStaticMarkup(createElement(MarkTile))).not.toContain(TRIANGLE)
    expect(renderToStaticMarkup(createElement(StudioMark, { size: 20 }))).toContain('viewBox="0 0 22 22"')
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
  it('Copy link to this: enabled in Script (it has a route), off with the reason in Storyboard, Video and Image', () => {
    expect(src('../../script/ScriptEditor.tsx')).toMatch(/<MenuItem icon=\{<LinkIcon \/>\} onSelect=\{[^]*?\}>Copy link to this<\/MenuItem>/)
    for (const f of ['Storyboard', 'Video', 'ImageEditor']) expect(src(`../../stages/${f}.tsx`)).toContain('more={() => <CopyLinkLater />}')
    const html = renderToStaticMarkup(createElement(CopyLinkLater))
    expect(html).toContain('disabled=""')
    expect(html).toContain(NOT_YET)
    expect(html).toContain('Copy link to this')
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
