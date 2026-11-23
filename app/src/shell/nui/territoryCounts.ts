// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What an exploration card on the Territories tool page says about its document: how many routes the crew
// brought back and how many are greenlit, read from the document's own data (territories[], greenlit[]).

export interface TerritoryCount { routes: number; greenlit: number }

/** The items of the top-level list `key` in YAML text: the lines that start one entry, and each entry's lines. */
function entries(text: string, key: string): string[][] {
  const lines = text.split('\n')
  const at = lines.findIndex(l => new RegExp(`^"?${key}"?\\s*:`).test(l))
  if (at < 0) return []
  if (/^[^:]+:\s*\[\s*\]\s*$/.test(lines[at])) return []
  const block: string[] = []
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !/^-/.test(lines[i])) break
    block.push(lines[i])
  }
  const dash = block.filter(l => /^\s*-(\s|$)/.test(l))
  if (!dash.length) return []
  const min = Math.min(...dash.map(l => /^\s*/.exec(l)![0].length))
  const out: string[][] = []
  for (const l of block) {
    if (/^\s*-(\s|$)/.test(l) && /^\s*/.exec(l)![0].length === min) out.push([l])
    else if (out.length) out[out.length - 1].push(l)
  }
  return out
}

/** Routes (the ones still in play, not set aside) and greenlit ids in an exploration's data (JSON or YAML text). */
export function territoryCount(text: string): TerritoryCount {
  try {
    const j = JSON.parse(text) as { territories?: { status?: string }[]; greenlit?: unknown[] }
    return {
      routes: (Array.isArray(j.territories) ? j.territories : []).filter(t => t?.status !== 'killed').length,
      greenlit: Array.isArray(j.greenlit) ? j.greenlit.length : 0,
    }
  } catch { /* not JSON: YAML */ }
  return {
    routes: entries(text, 'territories').filter(e => !e.some(l => /^\s*"?status"?\s*:\s*"?killed"?\s*$/.test(l))).length,
    greenlit: entries(text, 'greenlit').length,
  }
}

/** The sublabel of an exploration card: its routes and greenlit count, then when it was edited. A raw id is never shown. */
export function explorationSub(c: TerritoryCount | undefined, when: string): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const what = !c ? '' : c.routes === 0 ? 'No routes yet' : c.greenlit > 0 ? `${plural(c.routes, 'route')} · ${c.greenlit} greenlit` : plural(c.routes, 'route')
  return [what, `edited ${when}`].filter(Boolean).join(' · ')
}
