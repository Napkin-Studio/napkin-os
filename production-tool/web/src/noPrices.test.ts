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

// Nor a cost word (owner rule; UAT round 4, R4-F8: "Crop · free", "(free)", "(paid)", "cost in History"): what a person
// sees never says a thing is free, paid or what it cost. Code names (a `paid` list, the `free` page class) are fine.
const COST_WORDS = /['"`>][^'"`<>]*(?:·\s*free\b|\((?:free|paid)\)|\bcost in (?:History|Decisions)\b|\bNothing paid\b|\bFree, and\b|what each job cost)[^'"`<>]*['"`<]/

describe('no cost words in the UI', () => {
  it('never "· free", "(free)", "(paid)" or "cost in History"', () => {
    const found = files(SRC)
      .map((p) => relative(SRC, p).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .flatMap((rel) => readFileSync(join(SRC, rel), 'utf8').split('\n')
        .map((line, i) => ({ rel, line, n: i + 1 }))
        .filter(({ line }) => COST_WORDS.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')))
      .map(({ rel, n, line }) => `${rel}:${n}: ${line.trim()}`)
    expect(found).toEqual([])
  })
})
