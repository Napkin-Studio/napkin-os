// The scene as the engine's own file: canvas.excalidraw in the export zip.

import { serializeAsJSON } from '@excalidraw/excalidraw'
import type { FileMap, SceneElement } from './types'

export function serializeScene(elements: readonly SceneElement[], files: FileMap): string {
  return serializeAsJSON(elements, {}, files, 'local')
}
