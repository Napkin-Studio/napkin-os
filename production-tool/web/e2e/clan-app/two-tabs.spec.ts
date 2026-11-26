// S1-10: two tabs saving one project never overwrite each other; the loser is told; the loser's edits stay
// in that browser. Two real browser contexts on one library document.
import { addNode, at, createProject, dataOf, download, expect, nodeKinds, signIn, toolUrl, waitSavedKind } from './support'

at(1)('S1-10 a second tab saving over the first gets the conflict box and overwrites nothing', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  const tenant = await signIn(a.request)
  await signIn(b.request)
  const doc = await createProject(a.request, tenant, 'Two tabs')
  await a.goto(toolUrl(doc))
  await b.goto(toolUrl(doc))
  await expect(a.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(b.locator('canvas').first()).toBeVisible({ timeout: 60_000 })

  await addNode(a, 'Script')
  await a.keyboard.press('Control+s')
  await waitSavedKind(a.request, tenant, doc, 'scripts')
  const winner = await download(a.request, tenant, doc)

  await addNode(b, 'Storyboard')
  await b.keyboard.press('Control+s')
  await expect(b.getByRole('alertdialog', { name: /saved somewhere else/ })).toBeVisible({ timeout: 30_000 })

  const after = await download(a.request, tenant, doc)
  expect(after.version, "the host still holds A's save").toBe(winner.version)
  expect(nodeKinds(await dataOf(a.request, tenant, doc)), "B's storyboard never reached the host").not.toContain('storyboards')
  // B's edit is still in B's browser: its editor is still the Storyboard, and the box still offers the choice
  await expect(b.getByRole('button', { name: /Keep theirs as a copy/ })).toBeVisible()
  await expect(b.getByText('Storyboard').first()).toBeVisible()
})
