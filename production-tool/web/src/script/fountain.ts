// Fountain import (features/script-editor.clan; open question 11: our own parser, grown
// from the contract-v3 spike's parsePaste, rather than fountain-js). Pure.
//
// What it keeps: the title page's Title; each scene heading (INT., EXT., INT./EXT., I/E,
// EST., or forced with a leading '.') as one scene; character, parenthetical and dialogue
// blocks (a forced '@NAME' loses its '@', dual dialogue's '^' becomes two plain lines);
// action, with transitions and centred text as action lines. What it drops, and counts:
// sections ('#'), synopses ('='), notes ([[…]]) and the boneyard (/* … */).

import { LIMITS, MAX_PROSE_BYTES } from '../../../clan-store/src'

export type FountainBlock = { type: 'action' | 'character' | 'parenthetical' | 'dialogue'; text: string }
export interface FountainScene { heading: string; blocks: FountainBlock[] }
export interface Dropped { sections: number; synopses: number; notes: number; boneyard: number }
export interface FountainScript { title?: string; scenes: FountainScene[]; dropped: Dropped }

const HEADING = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[. ]/i
const TRANSITION = /^[A-Z0-9 .'-]+TO:$/
const CHARACTER = /^(?=.*[A-Z])[A-Z0-9 ._'()-]+(?:\s*\(.*\))?\s*\^?$/

/** The heading a line forces or names, or null. */
export function fountainHeading(line: string): string | null {
  const t = line.trim()
  if (t.startsWith('.') && !t.startsWith('..') && t.length > 1) return t.slice(1).trim()
  if (HEADING.test(t)) return t.replace(/\s+#[^#]*#\s*$/, '').toUpperCase()
  return null
}

export function parseFountain(source: string): FountainScript {
  const dropped: Dropped = { sections: 0, synopses: 0, notes: 0, boneyard: 0 }
  let text = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  // The boneyard, then notes, can span lines.
  text = text.replace(/\/\*[\s\S]*?\*\//g, () => {
    dropped.boneyard++
    return ''
  })
  text = text.replace(/\[\[[\s\S]*?\]\]/g, () => {
    dropped.notes++
    return ''
  })
  let lines = text.split('\n')

  // The title page: Key: value lines at the very top, ended by a blank line.
  let title: string | undefined
  if (/^[A-Za-z][A-Za-z ]*:/.test(lines[0] ?? '')) {
    let i = 0
    let key = ''
    for (; i < lines.length && lines[i].trim(); i++) {
      const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(lines[i])
      if (m) {
        key = m[1].toLowerCase()
        if (key === 'title' && m[2].trim()) title = clean(m[2])
      } else if (key === 'title' && !title) title = clean(lines[i])
    }
    lines = lines.slice(i)
  }

  const scenes: FountainScene[] = []
  const cur = () => scenes.at(-1) ?? (scenes.push({ heading: '', blocks: [] }), scenes.at(-1)!)
  let speaking = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const prevBlank = i === 0 || !lines[i - 1].trim()
    const nextLine = (lines[i + 1] ?? '').trim()
    if (!line) {
      speaking = false
      continue
    }
    if (/^#/.test(line)) {
      dropped.sections++
      continue
    }
    if (/^=(?!==)/.test(line)) {
      dropped.synopses++
      continue
    }
    if (/^={3,}$/.test(line)) continue // a page break
    if (speaking) {
      if (/^\(.*\)$/.test(line)) cur().blocks.push({ type: 'parenthetical', text: clean(line.slice(1, -1)) })
      else cur().blocks.push({ type: 'dialogue', text: clean(line) })
      continue
    }
    const heading = prevBlank || i === 0 ? fountainHeading(line) : null
    if (heading !== null && !line.startsWith('!')) {
      scenes.push({ heading: clean(heading), blocks: [] })
      continue
    }
    if (line.startsWith('!')) {
      cur().blocks.push({ type: 'action', text: clean(line.slice(1)) })
      continue
    }
    if (line.startsWith('@') && nextLine) {
      cur().blocks.push({ type: 'character', text: characterName(line.slice(1)) })
      speaking = true
      continue
    }
    if (line.startsWith('>') && line.endsWith('<')) {
      cur().blocks.push({ type: 'action', text: clean(line.slice(1, -1)) })
      continue
    }
    if (line.startsWith('>') || (prevBlank && TRANSITION.test(line))) {
      cur().blocks.push({ type: 'action', text: clean(line.replace(/^>\s*/, '')) })
      continue
    }
    if (prevBlank && nextLine && CHARACTER.test(line.replace(/\(.*\)/g, '()')) && !/[a-z]/.test(line.replace(/\(.*\)/g, ''))) {
      cur().blocks.push({ type: 'character', text: characterName(line) })
      speaking = true
      continue
    }
    cur().blocks.push({ type: 'action', text: clean(line) })
  }
  return { ...(title ? { title } : {}), scenes: scenes.filter((s) => s.heading || s.blocks.length), dropped }
}

/** A character's name: no forcing '@', no dual-dialogue '^'. */
function characterName(s: string): string {
  return clean(s.replace(/\^\s*$/, '')).trim()
}

/** Emphasis markers and escapes out; the words stay. */
function clean(s: string): string {
  return s.replace(/\\([*_])/g, '$1').replace(/(\*{1,3}|_)(?=\S)([^*_]+?)(?<=\S)\1/g, '$2').trim()
}

/** A count of what was dropped, in words ('Left out 2 sections and 1 note'), or ''. */
export function droppedLine(d: Dropped): string {
  const parts = ([['section', d.sections], ['synopsis', d.synopses], ['note', d.notes], ['boneyard block', d.boneyard]] as const)
    .filter(([, n]) => n > 0)
    .map(([w, n]) => `${n} ${n === 1 ? w : w === 'synopsis' ? 'synopses' : `${w}s`}`)
  if (!parts.length) return ''
  return `Left out ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`
}

export class FountainTooBig extends Error {
  readonly scene: string
  constructor(scene: string, why: string) {
    super(`${scene} is ${why}. Split it into smaller scenes and import again.`)
    this.name = 'FountainTooBig'
    this.scene = scene
  }
}

/** The flat text checkpoint would write for a scene's blocks. */
export function sceneFlat(blocks: FountainBlock[]): string {
  return blocks.map((b) => (b.type === 'character' ? b.text.toUpperCase() : b.type === 'parenthetical' ? `(${b.text})` : b.text)).join('\n')
}

/** Refuse, naming the scene, any scene past 20,000 flat characters or 64 KB of prose. */
export function checkSizes(s: FountainScript, proseBytes: (scene: FountainScene) => number) {
  s.scenes.forEach((sc, i) => {
    const name = sc.heading ? `“${sc.heading}”` : `Scene ${i + 1}`
    const flat = sceneFlat(sc.blocks).length
    if (flat > LIMITS.scene.text) throw new FountainTooBig(name, `${flat.toLocaleString('en')} characters; a scene keeps up to ${LIMITS.scene.text.toLocaleString('en')}`)
    if (proseBytes(sc) > MAX_PROSE_BYTES) throw new FountainTooBig(name, 'over 64 KB')
  })
}
