// The Brand Clan node on the canvas (Brand Clan phase 2, mocks d1-d3): its card element, the client's default placed for
// the person (not linked), a second one beside it to compare, and a link the person makes. Engine-neutral, through
// CanvasAdapter v2 like brief/canvas.ts.

import { useEffect, useRef } from 'react'
import type { Id, LinkEndpoint, Link } from '../contracts/types'
import type { CanvasElement, Pt } from '../canvas/core/canvasAdapter'
import { elementOfEnd, linkInput, type NodeEnv } from '../canvas/nodes/nodes'
import { clearOffset } from '../canvas/boards/fitting'
import { addBrandClan, brandClansList, clientOf, newBrandClan } from './model'
import { pageBrandClanSource, type BrandClanSource } from './os'

/** The card's box (mock d1: header with the picker, the logo, four swatches, the type line, the status line). */
export const BRAND_CLAN_CARD = { w: 220, h: 196 } as const

export function brandClanElement(env: NodeEnv, id: Id): CanvasElement | undefined {
  return elementOfEnd(env.canvas.elements(), env.doc.get(), { kind: 'brand_clan', id })
}

/** The Brand Clan node a canvas element is, if it is one. */
export function brandClanOfElement(e: CanvasElement | undefined): Id | null {
  const c = e?.customData as { kind?: unknown; id?: unknown } | undefined
  return !e?.isDeleted && c?.kind === 'brand_clan' && typeof c.id === 'string' ? c.id : null
}

/** Place a Brand Clan node's card, at `at` or top right of the view, clear of what is there. The node must be in the document. */
export function placeBrandClan(env: NodeEnv, id: Id, at?: Pt, select = false): CanvasElement {
  const { canvas } = env
  const there = brandClanElement(env, id)
  if (there) return there
  const v = canvas.visibleBounds()
  const c = at ?? { x: v.maxX - BRAND_CLAN_CARD.w / 2 - 80, y: v.minY + BRAND_CLAN_CARD.h / 2 + 60 }
  let box = { x: Math.round(c.x - BRAND_CLAN_CARD.w / 2), y: Math.round(c.y - BRAND_CLAN_CARD.h / 2), w: BRAND_CLAN_CARD.w, h: BRAND_CLAN_CARD.h }
  const { dx, dy } = clearOffset(canvas.elements(), [box])
  box = { ...box, x: Math.round(box.x + dx), y: Math.round(box.y + dy) }
  const el = canvas.node({ x: box.x, y: box.y, width: box.w, height: box.h, customData: { kind: 'brand_clan', id } })
  canvas.transact((all) => [...all, el], { undoable: true })
  const placed = canvas.elements().find((e) => e.id === el.id) ?? el
  if (select) canvas.select([placed.id])
  return placed
}

/** Link a Brand Clan node into a Script, Storyboard, Film or the sizes (the person's step); the canvas draws the arrow. */
export async function linkBrandClan(env: NodeEnv, id: Id, to: LinkEndpoint): Promise<{ ok: true; link: Link } | { ok: false; reason: string }> {
  return linkInput(env.doc, env.doc.get(), { kind: 'brand_clan', id }, to)
}

/**
 * The client's default Brand Clan, placed for the person and not linked (mock d1, "Placed for you, not linked"). Once per
 * project: a project that holds a Brand Clan node, or whose history has ever placed or added one (`everHad`, from the
 * decision chain), is left as it is, so a person who removed it keeps it removed. Null when the project has no client, the
 * client has no Brand Clan, or Napkin cannot be read.
 */
export async function placeDefaultBrandClan(env: NodeEnv, everHad: boolean, src: BrandClanSource = pageBrandClanSource(), libraryPath?: string): Promise<{ id: Id; el: CanvasElement } | null> {
  const d = env.doc.get()
  if (everHad || Object.keys(d.brand_clans ?? {}).length) return null
  if (!(await src.available())) return null
  // The project's client: its own record, else the library's (a project the OS made for a client keeps it on the document;
  // `libraryPath` is the project's library id, the page's route id, not the document's own project.id).
  const client = clientOf(d) ?? (libraryPath ? await src.projectClient(libraryPath) : null)
  if (!client) return null
  const dflt = (await src.list(client)).find((i) => i.default)
  if (!dflt || Object.keys(env.doc.get().brand_clans ?? {}).length) return null
  const node = await addBrandClan(env.doc, newBrandClan(await src.read(dflt.path), 'default'))
  return { id: node.id, el: placeBrandClan(env, node.id) }
}

/** Whether a decision chain has ever placed or added a Brand Clan node. */
export const chainHadBrandClan = (actions: readonly string[]): boolean => actions.some((a) => /^(place|add) the Brand Clan /.test(a))

/** A second Brand Clan beside an existing node, to compare two looks (mock d3). */
export async function addBrandClanBeside(env: NodeEnv, besideId: Id, path: string, src: BrandClanSource = pageBrandClanSource()): Promise<Id> {
  const read = await src.read(path)
  const node = await addBrandClan(env.doc, newBrandClan(read, 'pick'))
  const by = brandClanElement(env, besideId)
  placeBrandClan(env, node.id, by ? { x: by.x + by.width / 2, y: by.y + by.height + 40 + BRAND_CLAN_CARD.h / 2 } : undefined, true)
  return node.id
}

/** The project's default Brand Clan, placed once when the canvas opens. No UI of its own. */
export function useDefaultBrandClan(env: NodeEnv | null, clan: { chain(): Promise<{ action: string }[]> } | null, libraryPath?: string): void {
  const done = useRef<unknown>(null)
  useEffect(() => {
    if (!env || !clan || done.current === clan) return
    done.current = clan
    clan.chain()
      .then((chain) => placeDefaultBrandClan(env, chainHadBrandClan(chain.map((e) => e.action)), pageBrandClanSource(), libraryPath))
      .catch((e) => console.warn('the client’s Brand Clan could not be placed', e))
  }, [env, clan, libraryPath])
}

export { brandClansList }
