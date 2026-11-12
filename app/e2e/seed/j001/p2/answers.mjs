// The fixture-answer table of the stand-in middleware (features/j001-phase2-suite.clan, done_when 4).
// A task with a file in answers/ gets that file's reply; any other task gets the old canned reply, so every
// Phase 1 spec is unchanged. A file is named for its task (`judge_work.json`), and a variant of it
// `judge_work.<variant>.json`, picked with POST /control { variant: { judge_work: 'score22-idea7' } }.
// A file holds the reply's own keys ({ task, handler, result, change, trace }); the stack adds `api` and `job`.
// The owning record adds a middleware pytest that checks its file against its handler's output schema.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ANSWERS_DIR = fileURLToPath(new URL('./answers/', import.meta.url))

/** The tasks that have an answer file (variants not counted). */
export function answeredTasks(dir = ANSWERS_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.json') && f.split('.').length === 2).map(f => f.split('.')[0]).sort()
}

/** The reply body for `task` (and `variant`, when one is picked), or null when the task has no file. */
export function answerFor(task, variant = null, dir = ANSWERS_DIR) {
  if (!/^[a-z_]+$/.test(task ?? '')) return null
  const file = join(dir, variant && /^[a-z0-9-]+$/.test(variant) ? `${task}.${variant}.json` : `${task}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}
