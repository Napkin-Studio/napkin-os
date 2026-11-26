// Stage 3 (record production-jobs-via-host), S3-3 against the live local stack (relay in mock mode, napkin-web in front):
// a job that finishes with no tab open waits in the project's inbox exactly once, and settling it again, or racing two
// settlers, changes nothing. The tool's own landing of an inbox entry is the vitest `projects/landing.test.ts`.
import { at, createProject, expect, signIn } from './support'

const ULID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const id = (prefix: string) => `${prefix}_${Array.from({ length: 26 }, () => ULID[Math.floor(Math.random() * ULID.length)]).join('')}`

at(3)('S3-3 a job finished with no tab open lands in the inbox once; settle twice and racing give one', async ({ request }) => {
  const tenant = await signIn(request)
  const doc = await createProject(request, tenant, 'Closed tab')
  const base = `/api/t/${tenant}/d/${doc}`
  const jobId = id('job')
  const made = await request.post(`${base}/production/jobs`, {
    data: { contractVersion: '3', jobId, op: 'generate', projectId: id('proj'), nonce: 'n_closedtab1', node: { kind: 'group', id: jobId }, parentIds: [], input: { text: 'a red fox', chips: [] } },
  })
  expect(made.status(), await made.text()).toBeLessThan(300)
  // no tab, no polling by the tool: the host's registry knows the job is this document's
  const lib = await (await request.get(`/api/t/${tenant}/library`)).json()
  expect(lib.items.find((i: { path: string }) => i.path === doc).jobs).toContain(jobId)

  // the library watcher settles it until the relay has finished it (the mock provider takes a couple of seconds)
  const settle = async () => (await (await request.post(`${base}/jobs/${jobId}/settle`)).json()) as { settled: string; state: string }
  await expect.poll(async () => (await settle()).settled, { timeout: 60_000, intervals: [1000] }).not.toBe('running')
  const inbox = async () => (await (await request.get(`${base}/production/inbox`)).json()).entries as { job: string; state: string; outcome: { outputs?: unknown[] } }[]
  const first = await inbox()
  expect(first.map((e) => e.job)).toEqual([jobId])
  expect(first[0].state).toBe('completed')
  expect(first[0].outcome.outputs?.length).toBeGreaterThan(0)

  // twice, and two settlers at once: the one entry stays the one entry
  expect((await settle()).settled).toBe('already applied')
  const raced = await Promise.all([settle(), settle(), settle(), settle()])
  expect(raced.every((r) => r.settled === 'already applied')).toBe(true)
  expect((await inbox()).length).toBe(1)

  // the tool lands it and says so: gone, and it never comes back
  expect((await request.post(`${base}/production/inbox/${jobId}/ack`)).ok()).toBe(true)
  expect(await inbox()).toEqual([])
  expect((await settle()).settled).toBe('already applied')
  expect(await inbox()).toEqual([])
})
