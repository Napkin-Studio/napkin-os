// No price or cost anywhere in the UI (Shrey, 2026-10-13; features/runway-sheet-sync.clan): not on
// the model menu, job buttons, the update and send trays, cards, asks or toasts. Each job's cost is
// recorded and shown in one place only, the Decisions drawer (ui/historyItems.ts jobCost; features/production-new-ui.clan).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)
const ALLOWED = new Set(['ui/historyItems.ts'])
// A dollar sign before a number or a template value, "about $", "~$", or a flat estimate field.
const MONEY = /\$\$\{|about \$(\d|\$\{)|~\$|≈ ?\$|'\$' \+|\$\d+\.\d|estimateUsd|planCost|costWords/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('no prices in the UI', () => {
  it('only History formats money', () => {
    const found = files(SRC)
      .map((p) => relative(SRC, p).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .flatMap((rel) => readFileSync(join(SRC, rel), 'utf8').split('\n')
        .map((line, i) => ({ rel, line, n: i + 1 }))
        .filter(({ line }) => MONEY.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')))
      .map(({ rel, n, line }) => `${rel}:${n}: ${line.trim()}`)
    expect(found).toEqual([])
  })
})

// UAT round 4 S2-4: the Resize confirm still said "What each costs is in History", and trays said "Crop · free",
// "(paid)", "(cost in Decisions)". Outside the Decisions panel no tray, confirm or sheet speaks of cost at all.
const COST_WORDS = [
  /\bcosts? (?:is |are )?(?:in|shown in) (?:History|Decisions)/i,
  /\(cost in /i,
  /· (?:free|paid)\b/,
  /\((?:free|paid)\)(?! [\w{(])/,
  /: 'free'\}/,
  /\bFree, /,
  /\bnothing (?:was |has been )?paid\b/i,
  /' · paid'/,
  // Round 4 film (R4-F8): the same rule from the film side.
  /\bcost in (?:History|Decisions)\b/,
  /what each job cost/,
]
const COST_ALLOWED = new Set(['ui/historyItems.ts', 'ui/History.tsx', 'ui/HistoryList.tsx', 'noPrices.test.ts'])

describe('no cost words outside Decisions', () => {
  it('no tray, confirm or sheet mentions cost, free or paid', () => {
    const found = files(SRC)
      .map((p) => relative(SRC, p).split('\\').join('/'))
      .filter((rel) => !COST_ALLOWED.has(rel))
      .flatMap((rel) => readFileSync(join(SRC, rel), 'utf8').split('\n')
        .map((line, i) => ({ rel, line, n: i + 1 }))
        .filter(({ line }) => !/^(\/\/|\/\*|\*)/.test(line.trim()) && COST_WORDS.some((re) => re.test(line))))
      .map(({ rel, n, line }) => `${rel}:${n}: ${line.trim()}`)
    expect(found).toEqual([])
  })
})
