// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The slim row above an open script (features/script-editor.clan): Undo, Redo and Version history, the shell's
// own undo stack and version list that Brief Maker uses (features/brief-versions-undo.clan), so Ask Nap's Keep
// can use the same stack later. The script itself is the app's page; this row is the shell's.

import { useState } from 'react'
import VersionPanel from './VersionPanel'
import type { BriefUndo } from './useBriefUndo'
import '../gate/gate.css'

interface Props {
  undo: BriefUndo
  docPath: string
  /** After a write: the app reads the document again. */
  onChanged: () => void
}

export default function VersionBand({ undo, docPath, onChanged }: Props) {
  const [versions, setVersions] = useState(false)
  return (
    <section className="bg-band" data-testid="version-band" aria-label="Versions">
      <div className="bg-bar">
        <span className="bg-tag">Versions</span>
        <span className="bg-sum" />
        <div className="bg-tools">
          <button type="button" className="ch-btn" data-testid="undo" disabled={!undo.canUndo} onClick={undo.undo}>Undo</button>
          <button type="button" className="ch-btn" data-testid="redo" disabled={!undo.canRedo} onClick={undo.redo}>Redo</button>
          <button type="button" className="ch-btn" aria-expanded={versions} onClick={() => setVersions(o => !o)}>Version history</button>
        </div>
        {undo.note && <p className="bg-note-line" role="status" data-testid="undo-note">{undo.note}</p>}
      </div>
      {versions && <VersionPanel key={docPath} undo={undo} onChanged={onChanged} noun="script" />}
    </section>
  )
}
