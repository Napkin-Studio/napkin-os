// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A reader for the YAML subset the Deck Maker data files use (example/data.yaml and the state
// fixtures). The app has no YAML library among its declared dependencies and this adds none; the
// Deck Maker tests share this one.

import assert from 'node:assert/strict'

export type Y = null | boolean | number | string | Y[] | { [k: string]: Y }

function scalar(raw: string): Y {
  const s = raw.trim()
  if (s.startsWith('"')) return JSON.parse(s) as string
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s === '' || s === '~' || s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return Number(s)
  if (/^-?\d+\.\d+$/.test(s)) return Number(s)
  return s
}

// Flow collections: { a: 1, b: [x, y] }, possibly spread over lines.
function flow(src: string): Y {
  let i = 0
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++ }
  const quoted = (): string => {
    const q = src[i]
    let j = i + 1
    while (j < src.length && src[j] !== q) { if (q === '"' && src[j] === '\\') j++; j++ }
    if (q === "'" && src[j + 1] === "'") { j += 2; while (j < src.length && !(src[j] === "'" && src[j + 1] !== "'")) j++ }
    const text = src.slice(i, j + 1)
    i = j + 1
    return text
  }
  const plain = (stops: string): string => {
    const start = i
    while (i < src.length && !stops.includes(src[i]!) && !(src[i] === ':' && /\s/.test(src[i + 1] ?? ' '))) i++
    return src.slice(start, i)
  }
  const value = (): Y => {
    ws()
    if (src[i] === '{') {
      i++
      const o: { [k: string]: Y } = {}
      ws()
      while (src[i] !== '}') {
        ws()
        const k = src[i] === '"' || src[i] === "'" ? String(scalar(quoted())) : plain(',}:').trim()
        ws()
        assert.equal(src[i], ':', `flow map: expected ':' after ${k}`)
        i++
        o[k] = value()
        ws()
        if (src[i] === ',') i++
        ws()
      }
      i++
      return o
    }
    if (src[i] === '[') {
      i++
      const a: Y[] = []
      ws()
      while (src[i] !== ']') {
        a.push(value())
        ws()
        if (src[i] === ',') i++
        ws()
      }
      i++
      return a
    }
    if (src[i] === '"' || src[i] === "'") return scalar(quoted())
    return scalar(plain(',}]'))
  }
  const v = value()
  ws()
  assert.equal(i, src.length, `flow value has trailing text: ${src.slice(i, i + 30)}`)
  return v
}

function balanced(s: string): boolean {
  let depth = 0
  let q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') i++ } else if (c === '"' || c === "'") q = c
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
  }
  return depth === 0 && !q
}

export function parseYaml(text: string): Y {
  const lines = text.split('\n').filter(l => l.trim() !== '' && !l.trim().startsWith('#'))
  let at = 0
  const indentOf = (l: string) => l.length - l.trimStart().length
  const KEY = /^("[^"]*"|'[^']*'|(?:[^\s'"[{-]|-[^\s])(?:(?!:\s|:$).)*):(?:\s+(.*))?$/

  // The value text after "key:" or "- ", taking continuation lines of an open flow collection.
  function inline(first: string): Y {
    let s = first.trim()
    if (s.startsWith('{') || s.startsWith('[')) {
      while (!balanced(s)) { at++; assert.ok(at < lines.length, 'unclosed flow collection'); s += ' ' + lines[at]!.trim() }
      at++
      return flow(s)
    }
    at++
    return scalar(s)
  }

  function block(indent: number): Y {
    const l = lines[at]!
    if (/^\s*[{[]/.test(l)) return inline(l)
    return l.trimStart().startsWith('- ') || l.trim() === '-' ? seq(indent) : map(indent)
  }

  function seq(indent: number): Y {
    const out: Y[] = []
    while (at < lines.length && indentOf(lines[at]!) === indent && lines[at]!.trimStart().startsWith('-')) {
      const rest = lines[at]!.trimStart().slice(1)
      if (rest.trim() === '') {
        at++
        out.push(block(indentOf(lines[at]!)))
      } else if (KEY.test(rest.trim()) && !/^\s*[{["']/.test(rest)) {
        // "- key: value": the map's own indent is where the key starts.
        lines[at] = ' '.repeat(indent + 1 + (rest.length - rest.trimStart().length)) + rest.trimStart()
        out.push(map(indentOf(lines[at]!)))
      } else out.push(inline(rest))
    }
    return out
  }

  function map(indent: number): Y {
    const out: { [k: string]: Y } = {}
    while (at < lines.length && indentOf(lines[at]!) === indent && !lines[at]!.trimStart().startsWith('- ')) {
      const m = KEY.exec(lines[at]!.trim())
      assert.ok(m, `cannot read line: ${lines[at]}`)
      const key = String(scalar(m[1]!))
      const rest = m[2]
      if (rest === undefined || rest.trim() === '') {
        at++
        const nx = lines[at]
        if (nx && (indentOf(nx) > indent || (indentOf(nx) === indent && nx.trimStart().startsWith('- ')))) out[key] = block(indentOf(nx))
        else out[key] = null
      } else out[key] = inline(rest)
    }
    return out
  }

  const v = block(indentOf(lines[0]!))
  assert.equal(at, lines.length, `unparsed line: ${lines[at]}`)
  return v
}
