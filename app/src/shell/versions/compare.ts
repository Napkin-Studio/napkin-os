// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Two versions of a brief, side by side (features/brief-versions-undo.clan): the parts that differ,
// each as the words a person would read.

export interface PartDiff { path: string; label: string; left: string; right: string }

/** `single_minded_proposition` as the words a person says: "Single minded proposition". */
export function labelOf(path: string): string {
  const w = path.replace(/[_.]+/g, ' ').trim()
  return w ? w[0].toUpperCase() + w.slice(1) : path
}

/** Each leaf of the parts, by its path; a list is its items one to a line. */
export function flatten(parts: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>()
  const put = (path: string, v: unknown) => {
    if (v == null || v === '') return
    if (typeof v === 'string') out.set(path, v)
    else if (typeof v === 'number' || typeof v === 'boolean') out.set(path, String(v))
    else if (Array.isArray(v)) {
      out.set(path, v.every(x => typeof x === 'string') ? v.join('\n') : JSON.stringify(v))
    } else if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) put(`${path}.${k}`, x)
    }
  }
  for (const [k, v] of Object.entries(parts)) put(k, v)
  return out
}

/** The parts whose words differ, in the order the left version has them, then the right's new ones. */
export function compareParts(left: Record<string, unknown>, right: Record<string, unknown>): PartDiff[] {
  const l = flatten(left), r = flatten(right)
  const paths = [...l.keys(), ...[...r.keys()].filter(k => !l.has(k))]
  return paths
    .filter(p => (l.get(p) ?? '') !== (r.get(p) ?? ''))
    .map(p => ({ path: p, label: labelOf(p), left: l.get(p) ?? '', right: r.get(p) ?? '' }))
}
