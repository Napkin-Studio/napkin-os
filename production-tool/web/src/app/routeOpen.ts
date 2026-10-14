// Opening the project a link names (features/script-editor.clan): the project id in a route is
// the id Shell.open takes. A project of this browser opens as it is; one only on the relay comes
// down first (Shell.openFromServer, under the same id). The editor then shows over the
// Storyboard stage, which is where '← Storyboard' returns. A link this browser cannot open
// drops its route, saying why on Home.

import type { Shell } from '../projects/shell'
import type { Router } from './route'

/** True when the link's project is open now. */
export async function openRouteProject(shell: Shell, router: Router): Promise<boolean> {
  const r = router.get()
  if (r.kind !== 'script') return false
  try {
    if (shell.index.get(r.projectId)) await shell.open(r.projectId)
    else {
      const saved = (await shell.serverProjects()).find((p) => p.id === r.projectId)
      if (!saved) throw new Error('That link is to a project this browser cannot open.')
      await shell.openFromServer(saved)
    }
  } catch (e) {
    router.replace({ kind: 'none' })
    shell.say(e instanceof Error ? e.message : 'That link could not be opened.')
    return false
  }
  const session = shell.get().session
  session?.services.ui.update((u) => { u.stage = 'storyboard' })
  return true
}
