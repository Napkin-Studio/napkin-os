// The engine's own types, as the rest of the tool names them. Exact aliases, so
// tsc sees the same shapes it saw before the adapter (features/canvas-core.clan).

import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, ExcalidrawImageElement, FileId as EngineFileId } from '@excalidraw/excalidraw/element/types'

export type SceneElement = ExcalidrawElement
export type ImageElement = ExcalidrawImageElement
export type FileMap = BinaryFiles
export type FileData = BinaryFileData
export type FileId = EngineFileId
