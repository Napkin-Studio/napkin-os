// The Excalidraw engine, behind CanvasAdapter (features/canvas-core.clan). Every
// @excalidraw import in the app lives under src/canvas/adapter/; only
// src/canvas/adapter/index.ts reaches this folder (features/engine-adapter.clan).

export { commonBounds, ExcalidrawAdapter, fileIdFor } from './adapter'
export { serializeScene } from './serialize'
export type { FileData, FileId, FileMap, ImageElement, SceneElement } from './types'
