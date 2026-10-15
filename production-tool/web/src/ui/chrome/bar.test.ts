import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HomeMark, MarkTile } from './Bar'
import { StudioMark } from '../Mark'
import { CopyLinkLater } from './MoreMenu'
import { NOT_YET } from './panels'

const TRIANGLE = 'M2 11 L7 3 L12 11 Z'

describe('the top bar\'s Home is the Napkin logo, as the shell draws it', () => {
  it('HomeMark is a button with the StudioMark at 20px, never the triangle tile', () => {
    const html = renderToStaticMarkup(createElement(HomeMark, { onClick: () => {} }))
    expect(html).toContain('aria-label="Home: your projects"')
    expect(html).toContain(renderToStaticMarkup(createElement(StudioMark, { size: 20 })).replace(/:r\w*:|«r\w*»|_r_\w*_/g, '').slice(0, 60))
    expect(html).toContain('width="20" height="20" viewBox="0 0 22 22"')
    expect(html).not.toContain(TRIANGLE)
  })
  it('MarkTile (Home, signed out, the phone) draws the logo too', () => {
    const html = renderToStaticMarkup(createElement(MarkTile))
    expect(html).toContain('viewBox="0 0 22 22"')
    expect(html).not.toContain(TRIANGLE)
  })
  it('the canvas bar uses HomeMark, and no source draws the triangle', () => {
    expect(readFileSync(new URL('./TopBars.tsx', import.meta.url), 'utf8')).toContain('<HomeMark')
    expect(readFileSync(new URL('./Bar.tsx', import.meta.url), 'utf8')).not.toContain(TRIANGLE)
  })
})

// The bars' small fixed set and the one More (features/topbar-declutter.clan).

const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('one More on every bar; secondary actions live there', () => {
  const bars = src('./TopBars.tsx')
  const canvasBar = bars.slice(bars.indexOf('export function CanvasBar'), bars.indexOf('export function EditorBar'))
  it('the canvas bar has no Export button: Export\'s rows and Save now are in its More', () => {
    expect(bars).not.toContain('function ExportMenu')
    expect(canvasBar).toContain('<MoreMenu where="canvas"')
    expect(canvasBar).not.toMatch(/>\s*Export\s*</)
    const items = bars.slice(bars.indexOf('function CanvasMoreItems'), bars.indexOf('function ExportIcon'))
    for (const row of ['Download all media (zip)', 'Project as .clan + assets', 'Save now', 'Copy link']) expect(items).toContain(row)
  })
  it('every editor bar renders More; Script uses the shared EditorBar too', () => {
    const editor = bars.slice(bars.indexOf('export function EditorBar'))
    expect(editor).toContain('<MoreMenu where={icon}')
    expect(src('../../script/ScriptEditor.tsx')).toContain('<EditorBar className="se-top"')
    expect(src('../../script/ScriptEditor.tsx')).not.toContain('<header className="ptbar se-top">\n        <BackButton label={backTo} onClick={onBack} />\n        <BarSep />')
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
    expect(bars).toContain('<h1 className="pt-title" title={title}>{title}</h1>')
  })
  it('the Image editor\'s zoom is on the stage, not in the bar', () => {
    const image = src('../../stages/ImageEditor.tsx')
    const bar = image.slice(image.indexOf('<EditorBar'), image.indexOf('<Float anchor={versionsBtn}'))
    expect(bar).not.toContain('ie-zoom')
    expect(image.slice(image.indexOf('<div className="ie-stagewrap">'))).toContain('<div className="ie-zoom" role="group" aria-label="Zoom">')
  })
})
