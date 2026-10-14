// The engine loader (features/engine-adapter.clan): the one door into
// src/canvas/adapter/ from the rest of the app. It picks the engine (Excalidraw
// by default; the own engine with config flags.ownCanvas or a per-person
// ?engine=own) and loads it by dynamic import, so each engine is its own chunk.
// eslint.config.js refuses any import of src/canvas/adapter/<engine>/ from outside
// this folder.

import type { CanvasEngine, CanvasExportFile, CanvasSnapshot, EngineId } from '../core/canvasAdapter'

const REMEMBER = 'napkin.canvasEngine'

/** This browser's storage for the per-person choice; null where storage is blocked. */
function local(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * ?engine=own or ?engine=excalidraw for one person (remembered in this browser, since the app's
 * routes drop the query), else the remote config's ownCanvas, else Excalidraw.
 */
export function engineChoice(search: string, flags?: { ownCanvas?: boolean } | null, store = local()): EngineId {
  const asked = new URLSearchParams(search).get('engine')
  if (asked === 'own' || asked === 'excalidraw') {
    try {
      store?.setItem(REMEMBER, asked)
    } catch {
      // not remembered
    }
    return asked
  }
  let kept: string | null
  try {
    kept = store?.getItem(REMEMBER) ?? null
  } catch {
    kept = null
  }
  if (kept === 'own' || kept === 'excalidraw') return kept
  return flags?.ownCanvas ? 'own' : 'excalidraw'
}

// Read the query when the app loads, before its router replaces the URL.
engineChoice(globalThis.location?.search ?? '', null)

export async function loadEngine(id: EngineId): Promise<CanvasEngine> {
  if (id === 'own') return (await import('./own/engine')).ownEngine
  return (await import('./excalidraw/engine')).excalidrawEngine
}

/** The engine a saved snapshot belongs to (one saved before the own engine is Excalidraw's). */
export function engineOf(snapshot: CanvasSnapshot | null | undefined): EngineId {
  return snapshot?.engine === 'own' ? 'own' : 'excalidraw'
}

/**
 * The engine to mount: a saved scene opens in the engine that made it, so neither engine ever
 * writes over the other's scene (an Excalidraw project reaches the own engine only as a converted
 * copy, engine-import). The choice applies to a project with nothing drawn yet.
 */
export function engineToMount(choice: EngineId, initial: CanvasSnapshot | null | undefined): EngineId {
  return initial?.elements?.length ? engineOf(initial) : choice
}

/** The scene as a file for the export zip, from the saved snapshot, without mounting an engine. */
export async function canvasExportFile(snapshot: CanvasSnapshot | undefined): Promise<CanvasExportFile> {
  if (engineOf(snapshot) === 'own') return (await import('./own/file')).ownExportFile(snapshot)
  const { serializeScene } = await import('./excalidraw/serialize')
  const json = serializeScene((snapshot?.elements ?? []) as never, (snapshot?.files ?? {}) as never)
  return { name: 'canvas.excalidraw', bytes: new TextEncoder().encode(json) }
}
