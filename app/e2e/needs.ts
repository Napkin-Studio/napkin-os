// Needs you on the desk and in a document, for the specs that read it (features/align-needs-lock-people.clan): the desk's
// Me rows (the documents that hold an item for the signed-in person), the server's per-document facts, and the items a
// document's own decision view holds for the signed-in person. One source: nothing here reads a list of its own.
import { expect, type Page } from '@playwright/test'
import { asMe } from './seed/j001'

export type DocNeeds = { path: string; count: number; notices: number; mine: number; earliest_due: string | null }
export type NeedsFacts = { documents: DocNeeds[]; aside: Record<string, string[]>; next_deadline: { job: string; due: string } | null; timesheet: unknown }
export type Item = { code: string; text: string; blocks_lock: boolean; for?: { person?: string; role?: string }; due?: string; job?: string }

/** The signed-in person's per-document facts, as the server answers them (`GET /needs`). */
export const factsOf = async (page: Page, api: string) => (await (await page.request.get(`${api}/needs`)).json()) as NeedsFacts

/** The items a document holds, as the signed-in person gets them from its own decision view. */
export async function itemsOf(page: Page, api: string, doc: { path: string; id: string }): Promise<Item[]> {
  const t = (await asMe(page, api, doc)).token
  return ((await (await page.request.get(`/s/${t}/decisions`)).json()) as { attention: Item[] }).attention
}

/** The notices on a document for the signed-in person, by kind (`brief-changed`, `approval`, ...). */
export async function noticesOf(page: Page, api: string, doc: { path: string; id: string }, kinds?: string[]): Promise<Item[]> {
  return (await itemsOf(page, api, doc)).filter(i => i.code.startsWith('notice:') && (!kinds || kinds.includes(i.code.slice(7))))
}

/** The desk, on Me: the documents that hold an item for the signed-in person. */
export async function openMe(page: Page) {
  await page.goto('/')
  await page.reload()
  await expect(page.getByTestId('desk')).toBeVisible()
  await page.getByRole('group', { name: 'Whose work' }).getByRole('button', { name: 'Me', exact: true }).click()
}
