// What the page does once it knows who is signed in: open the project the link names (or Home), then tidy blank drafts.
// It runs after the first render (UAT 2026-11-23: opening Production sat on "Opening Napkin Studio…" for about 15 s,
// because the render waited for every round trip below: the library, the .clan and its pictures). The tidy-up runs last,
// so it never holds the opening, and it leaves the project that was just opened alone.

import type { Shell } from '../projects/shell'
import type { Router } from './route'
import { openRouteProject } from './routeOpen'

export async function startUp(shell: Pick<Shell, 'goHome' | 'pruneDrafts'>, router: Router, open: typeof openRouteProject = (s, r) => openRouteProject(s as Shell, r)): Promise<void> {
  // A link or a reload that names a film opens that film. With none the page shows the library's Production list
  // (contract section 2.5): the page never makes a project the person did not ask for.
  const opened = await open(shell as Shell, router).catch((e) => {
    console.error('could not open the linked project', e)
    return false
  })
  if (!opened) await shell.goHome()
  // Blank films nothing was added to are not kept (owner 2026-11-18): those an earlier visit left go.
  await shell.pruneDrafts().catch((e) => console.warn('could not tidy blank films', e))
}
