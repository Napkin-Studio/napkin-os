// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A job that ends after its page closed lands on the landing's next read: the
// watcher polls every unsettled job the listing names, through the host, once
// at a time, and leaves alone a job whose poll keeps failing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LibraryItem } from '../src/host/types.ts'
import { GIVE_UP_AFTER, makeSettler } from '../src/shell/landing/settle.ts'

const item = (path: string, jobs?: string[]): LibraryItem => ({
  path, app_id: 'ie.napkin.campaign-research', title: path, updated_at: '2026-11-09T06:00:00Z', client: null, run: null,
  ...(jobs ? { jobs } : {}),
})

test('every unsettled job is polled through the host, by its document', async () => {
  const calls: string[] = []
  const s = makeSettler({ settleJob: async (path, job) => { calls.push(`${path} ${job}`) } })
  await s.settle([item('a.clan', ['job_1', 'job_2']), item('b.clan'), item('c.clan', [])])
  assert.deepEqual(calls.sort(), ['a.clan job_1', 'a.clan job_2'])
})

test('a job already being polled is not polled again until it answers', async () => {
  let release: () => void = () => {}
  let n = 0
  const s = makeSettler({ settleJob: () => { n += 1; return new Promise<void>(r => { release = r }) } })
  const first = s.settle([item('a.clan', ['job_1'])])
  await s.settle([item('a.clan', ['job_1'])])  // the next 5 s read, while the first poll waits
  assert.equal(n, 1)
  release()
  await first
  const third = s.settle([item('a.clan', ['job_1'])])  // answered: polled again on the next read
  assert.equal(n, 2)
  release()
  await third
})

test('a job whose poll keeps failing is left alone', async () => {
  let n = 0
  const s = makeSettler({ settleJob: async () => { n += 1; throw new Error('502') } })
  for (let i = 0; i < GIVE_UP_AFTER + 2; i++) await s.settle([item('a.clan', ['job_1'])])
  assert.equal(n, GIVE_UP_AFTER)
})

test('a host with one document at a time settles nothing', async () => {
  await makeSettler({}).settle([item('a.clan', ['job_1'])])
})

test('the document open in the shell is left to its own page', async () => {
  const calls: string[] = []
  const s = makeSettler({ settleJob: async (path, job) => { calls.push(`${path} ${job}`) } })
  await s.settle([item('a.clan', ['job_1']), item('b.clan', ['job_2'])], 'a.clan')
  assert.deepEqual(calls, ['b.clan job_2'])
  calls.length = 0
  await s.settle([item('a.clan', ['job_1'])], null)  // back on the desk: nobody else polls it
  assert.deepEqual(calls, ['a.clan job_1'])
})
