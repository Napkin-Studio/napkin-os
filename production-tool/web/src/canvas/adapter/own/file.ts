// The own engine's scene inside an export (features/engine-adapter.clan): a
// read-only JSON projection, canvas.napkin.json, never read back. engine-store
// replaces the browser snapshot with the live store and the .clan checkpoint
// (human/assets/canvas.ybin.zst); this projection stays an export-only file.

import type { CanvasExportFile, CanvasSnapshot } from '../../core/canvasAdapter'

export function ownExportFile(snapshot: CanvasSnapshot | undefined): CanvasExportFile {
  const body = { type: 'napkin-canvas', format: 'napkin/1', elements: (snapshot?.elements ?? []).filter((e) => !e.isDeleted) }
  return { name: 'canvas.napkin.json', bytes: new TextEncoder().encode(JSON.stringify(body)) }
}
