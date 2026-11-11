// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where the shell shows the state of the open document, between the bar and the
// work: the failed save (from the save queue) or the state the app reported
// (`clan:bar`, kind state). Normal shows nothing here, because the work is the
// screen. The strip's buttons are never primary: the app's own primary keeps
// that place (one primary per screen).

import type { AppState } from '../../shell/appBar'
import { ChangedBrief, FailedSave, Loading, LongRun, MissingAccess, NotRight, RunFailed } from './ScreenStates'
import type { SaveQueue } from './saveQueue'
import { useSaveState } from './useSaveState'
import { NOT_RIGHT, STATE_ACTIONS } from './words'

export function StateStrip({ queue, app, onAction, onRefresh }: { queue: SaveQueue; app: AppState | null; onAction: (id: string) => void; onRefresh: () => void }) {
  const saving = useSaveState(queue)
  if (saving === 'changed') {
    // The host said the document moved on (409): never overwrite it; show what changed and take the new version.
    return <ChangedBrief compact primary={false}
      changes="What you typed stays on the page until you update." onUpdate={onRefresh} />
  }
  if (saving === 'failed') return <FailedSave compact primary={false} onRetry={() => queue.retry()} />
  if (!app) return null
  switch (app.name) {
    case 'loading': return <Loading what={app.what} />
    case 'run-failed': return <RunFailed compact primary={false} why={app.why} onRetry={() => onAction(STATE_ACTIONS.retry)} />
    case 'long-run': return <LongRun minutes={app.minutes} step={app.step || undefined} />
    case 'changed-brief': return <ChangedBrief compact primary={false} from={app.from} to={app.to} changes={app.changes} onUpdate={() => onAction(STATE_ACTIONS.update)} />
    case 'missing-access': return <MissingAccess what={app.what} who={app.who} onAsk={() => onAction(STATE_ACTIONS.ask)} />
    case 'not-right': return <NotRight onFix={fix => onAction(`${STATE_ACTIONS.fix}${NOT_RIGHT_FIXES.indexOf(fix) + 1}`)} />
  }
}
const NOT_RIGHT_FIXES: readonly string[] = NOT_RIGHT.fixes
