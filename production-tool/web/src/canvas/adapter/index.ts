// The engine loader (features/engine-adapter.clan): the one door into
// src/canvas/adapter/ from the rest of the app. It picks the engine (our own by
// default, owner 2026-11-16, features/production-tool-land.clan; Excalidraw only
// as the fallback: a per-person ?engine=excalidraw, or config flags.ownCanvas
// false as the remote kill switch) and loads it by dynamic import, so each
// engine is its own chunk.
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
 * routes drop the query), else the own engine unless the remote config turns it off
 * (flags.ownCanvas false, the kill switch; absent means on).
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
  return flags?.ownCanvas === false ? 'excalidraw' : 'own'
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
 * The engine to mount. On the own engine (the default) every project opens there: an Excalidraw
 * scene opens converted (the OwnAdapter imports it, engine-import) and CanvasMount keeps the
 * Excalidraw original beside it first. On the Excalidraw fallback a scene the own engine made still
 * opens on the own engine, which is the only one that reads it.
 */
export function engineToMount(choice: EngineId, initial: CanvasSnapshot | null | undefined): EngineId {
  if (choice === 'own') return 'own'
  return initial?.elements?.length ? engineOf(initial) : choice
}

/** Is this mount turning an Excalidraw scene into an own-engine one? */
export const converting = (mounted: EngineId, initial: CanvasSnapshot | null | undefined) =>
  mounted === 'own' && !!initial?.elements?.length && engineOf(initial) === 'excalidraw'


/** The scene as a file for the export zip, from the saved snapshot, without mounting an engine. */
export async function canvasExportFile(snapshot: CanvasSnapshot | undefined): Promise<CanvasExportFile> {
  if (engineOf(snapshot) === 'own') return (await import('./own/file')).ownExportFile(snapshot)
  const { serializeScene } = await import('./excalidraw/serialize')
  const json = serializeScene((snapshot?.elements ?? []) as never, (snapshot?.files ?? {}) as never)
  return { name: 'canvas.excalidraw', bytes: new TextEncoder().encode(json) }
}
