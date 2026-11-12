// The open document's running jobs reach its page (features/brief-resumes-running-job.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { jobsMessage, openDocJobs } from '../src/shell/openJobs.ts'
import type { LibraryItem } from '../src/host/index.ts'

const item = (path: string, jobs?: string[]) => ({ path, jobs }) as unknown as LibraryItem

test('the open document’s unsettled job ids, and only its, go in clan:jobs', () => {
  const lib = [item('a.clan', ['job_1', 'job_2', 'job_1', '']), item('b.clan', ['job_9']), item('c.clan')]
  assert.deepEqual(openDocJobs(lib, 'a.clan'), ['job_1', 'job_2'], 'its own, once each')
  assert.deepEqual(openDocJobs(lib, 'c.clan'), [])
  assert.deepEqual(openDocJobs(lib, 'gone.clan'), [])
  assert.deepEqual(openDocJobs(null, 'a.clan'), [], 'no listing yet: nothing')
  assert.deepEqual(jobsMessage(['job_1']), { type: 'clan:jobs', jobs: ['job_1'] })
})

test('the frame is told its document’s jobs on every load and whenever they change', () => {
  let root = new URL('.', import.meta.url)
  while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
  const rt = readFileSync(new URL('src/shell/AppRuntime.tsx', root), 'utf8')
  const hostSrc = readFileSync(new URL('src/shell/AppHost.tsx', root), 'utf8')
  assert.match(rt, /contentWindow\?\.postMessage\(jobsMessage\(jobsRef\.current\), '\*'\)/)
  assert.match(rt, /useEffect\(\(\) => \{ jobsRef\.current = jobs \?\? \[\]; postJobs\(\) \}, \[jobs, postJobs\]\)/)
  assert.match(rt, /onLoad=\{\(\) => \{[\s\S]*postJobs\(\)[\s\S]*DOC_LOADED/)
  // AppHost hands it the open path's jobs from the listing, a new array only when the ids change
  assert.match(hostSrc, /const jobsKey = openDocJobs\(library, docPath\)\.join\('\\n'\)/)
  assert.match(hostSrc, /useMemo\(\(\) => \(jobsKey \? jobsKey\.split\('\\n'\) : \[\]\), \[jobsKey\]\)/)
  assert.match(hostSrc, /jobs=\{openJobs\}/)
  // the landing settler still skips the open document: its page polls
  const settle = readFileSync(new URL('src/shell/landing/settle.ts', root), 'utf8')
  assert.match(settle, /if \(open && item\.path === open\) continue/)
})
