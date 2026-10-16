// @vitest-environment happy-dom
// A text on the canvas links to nodes (owner, 2026-10-16: "yes, text should link to nodes too";
// features/canvas-text.clan). Its words live in texts[id] (contracts README item 20), kept in step with
// the canvas; linked into a Script, Storyboard, Video or sketch area it is a note: an input chip
// "Text: <first words>", and its words are the node's input words. A text feeds no text. Deleting the
// text takes its links; the canvas's undo brings both back.

import { describe, expect, it } from 'vitest'
import type { JobInput, Link, ProductionDocument } from '../../../contracts/types'
import { updateDoc } from '../../../doc/store'
import { linkedTexts, withLinkedText } from '../../../jobs/linkedText'
import { firstWords, inputChips, scopeOf } from '../../../model/scope'
import { MAYA, modelStore } from '../../../test/model'
import { cardOf, elementOfEnd, endOf, linkCheck, linkNodes, seedNodes } from '../../nodes/nodes'
import { CanvasDocSync } from '../../sync'
import { OwnAdapter } from './adapter'
import { mountTextEditor } from './textEditor'

const measure = (line: string, size: number) => line.length * size * 0.5

async function setup() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const doc = () => s.get() as unknown as ProductionDocument
  const a = new OwnAdapter(null, { measure })
  a.transact((els) => [...els, ...seedNodes(a, doc())], { undoable: false })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = mountTextEditor(host, a)
  a.onChange(() => editor.sync())
  const sync = new CanvasDocSync({ doc: s, cancel: () => {} })
  const settle = () => sync.texts(a.elements({ includeDeleted: true }) as never)
  await settle()
  /** Write a text with the Text tool, as a person does: T, a click, words, Esc. */
  const write = async (words: string, x: number, y: number) => {
    a.setActiveTool({ type: 'native', id: 'text' })
    a.release({ x, y })
    const f = editor.field()!
    f.value = words
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    return a.elements().find((e) => e.type === 'text' && (e as { text?: string }).text === words)!
  }
  const node = (kind: string) => a.elements().find((e) => cardOf(e)?.kind === kind)!
  const save = (l: Link) => updateDoc(s, (d) => { d.links[l.id] = l }, `link ${l.from.kind} to ${l.to.kind}`).then(() => {})
  return { s, a, doc, write, node, save, settle }
}

describe('a text links to nodes (owner, 2026-10-16)', () => {
  it('each text on the canvas gets its texts[id] row, and an edit rewrites its words', async () => {
    const { a, doc, write, settle } = await setup()
    const t = await write('Rain on the window', 2000, 0)
    const [row] = Object.values(doc().texts!)
    expect(row).toMatchObject({ node: t.id, words: 'Rain on the window' })
    expect(row.id).toMatch(/^text_[0-9A-HJKMNP-TV-Z]{26}$/)
    a.editText(t.id)
    a.commitText('Rain on the glass')
    await settle()
    expect(doc().texts![row.id].words).toBe('Rain on the glass')
  })

  it('a text is a link end: into the Script as a note; never into a text', async () => {
    const { a, doc, write, node } = await setup()
    const t = await write('A girl at the window', 2000, 0)
    const u = await write('Second thought', 2000, 300)
    expect(endOf(t, doc())).toMatchObject({ doc: { kind: 'text' }, core: { kind: 'note' } })
    expect(linkCheck(a.elements(), doc(), t, node('script'))).toMatchObject({ ok: true, docRole: 'note' })
    expect(linkCheck(a.elements(), doc(), t, node('storyboard'))).toMatchObject({ ok: true })
    // Two non-node things do not link today (a picture into a sketch area's picture, …): a text into a text neither.
    expect(linkCheck(a.elements(), doc(), t, u)).toEqual({ ok: false, reason: 'Not a target for a note' })
    // Nothing feeds a text either way round: a script into a text is refused too.
    expect(linkCheck(a.elements(), doc(), node('script'), t).ok).toBe(false)
  })

  it('a text whose row is not written yet says so', async () => {
    const { a, doc } = await setup()
    a.setActiveTool({ type: 'native', id: 'text' })
    a.release({ x: 0, y: 0 })
    a.commitText('Not yet')
    const t = a.elements().find((e) => e.type === 'text')!
    expect(endOf(t, doc())).toEqual({ refuse: 'Type something in this text first, then link it.' })
  })

  it('linked into the Script: the chip "Text: <first words>", its words the Script\'s input words, an edit followed', async () => {
    const { a, s, doc, write, node, save, settle } = await setup()
    const t = await write('A girl at the window, waiting for the tide to turn\nthen she runs', 2000, 0)
    const made = await linkNodes(a, doc(), t, node('script'), save)
    expect(made.ok).toBe(true)
    const link = (made as { link: Link }).link
    expect(link).toMatchObject({ from: { kind: 'text' }, to: { kind: 'script' }, role: 'note' })
    expect(elementOfEnd(a.elements(), doc(), link.from)?.id).toBe(t.id)
    const scriptId = cardOf(node('script'))!.id
    const chip = inputChips(scopeOf(doc(), scriptId)).find((c) => c.kind === 'text')!
    expect(chip.label).toBe('Text: A girl at the window,…')
    // What Skye reads when she writes the script: the person's words, then the text's.
    const input: JobInput = { text: 'Make it moody' }
    const sent = withLinkedText(doc(), 'write', { kind: 'script', id: scriptId }, input)
    expect(sent.input.text).toBe('Make it moody\nA girl at the window, waiting for the tide to turn\nthen she runs')
    expect(sent.rows).toEqual([expect.objectContaining({ kind: 'text', used_as: 'note', link_id: link.id })])
    // Said once: words it already has are not added again; a stitch reads no words.
    expect(withLinkedText(doc(), 'write', { kind: 'script', id: scriptId }, sent.input).input.text).toBe(sent.input.text)
    expect(withLinkedText(doc(), 'stitch', { kind: 'script', id: scriptId }, input).input).toBe(input)
    // Edited on the canvas: the node reads the new words.
    a.editText(t.id)
    a.commitText('The tide is out')
    await settle()
    expect(inputChips(scopeOf(doc(), scriptId)).find((c) => c.kind === 'text')!.label).toBe('Text: The tide is out')
    expect(linkedTexts(doc(), { kind: 'script', id: scriptId }).map((x) => x.words)).toEqual(['The tide is out'])
    void s
  })

  it('a shot reads the texts linked into its storyboard', async () => {
    const { a, doc, write, node, save } = await setup()
    const t = await write('Golden hour, always', 2000, 0)
    await linkNodes(a, doc(), t, node('storyboard'), save)
    const sb = cardOf(node('storyboard'))!.id
    const shot = 'shot_01K7A000000000000000000099'
    const d = { ...doc(), shots: { ...doc().shots, [shot]: { id: shot, storyboard_id: sb } } } as unknown as ProductionDocument
    expect(withLinkedText(d, 'frame', { kind: 'shot', id: shot }, {}).input.text).toBe('Golden hour, always')
  })

  it('deleting the text takes its row and its links; the canvas\'s undo brings them back', async () => {
    const { a, doc, write, node, save, settle } = await setup()
    const t = await write('Rain', 2000, 0)
    await linkNodes(a, doc(), t, node('script'), save)
    expect(Object.values(doc().links).filter((l) => l.from.kind === 'text')).toHaveLength(1)
    a.select([t.id])
    a.selector.deleteSelected()
    await settle()
    expect(Object.values(doc().texts ?? {})).toHaveLength(0)
    expect(Object.values(doc().links).filter((l) => l.from.kind === 'text')).toHaveLength(0)
    a.undoScene('undo')
    await settle()
    expect(Object.values(doc().texts ?? {}).map((x) => x.words)).toEqual(['Rain'])
    expect(Object.values(doc().links).filter((l) => l.from.kind === 'text')).toHaveLength(1)
  })

  it('a chip keeps a few words', () => {
    expect(firstWords('Short')).toBe('Short')
    expect(firstWords('  one line\nanother')).toBe('one line')
    expect(firstWords('Supercalifragilisticexpialidocious and more')).toBe('Supercalifragilisticexpialid…')
  })
})
