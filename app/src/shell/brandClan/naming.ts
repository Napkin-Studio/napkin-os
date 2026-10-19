// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Making a Brand Clan from a name the agency has none for (Contract 6 §5).
//
//   1. `brand_identify {text}` on the middleware: which brands of this agency
//      does the name match? (Read only; any document may ask.)
//   2. A new, empty Brand Clan (`ie.napkin.brand`) is created without opening
//      it, titled with the brand's name.
//   3. `brand_seed {ref}` (a brand it found) or `{name}` (a new one) runs on
//      that new document and the host applies its change there.
//   4. The new Brand Clan is attached to the open document.
//
// The host is passed in, so the order and the words are tested without a
// network. Nothing here is written to the open document except by step 4.

import type { AttachReply, AttachTarget, BrandCandidate, Host } from '../../host'
import { BRAND_APP, NAMING_UNAVAILABLE, same } from './words'

export type NamingHost = Pick<Host, 'whoAmI' | 'hasMiddleware' | 'middlewareRead' | 'newDocumentQuietly' | 'middlewareRunOn' | 'attachTargets' | 'attach'>

/** `brand_identify`: the brands of this agency a typed name may mean. Rejects where there is no middleware. */
export async function identifyBrand(h: NamingHost, text: string): Promise<BrandCandidate[]> {
  if (!h.hasMiddleware) throw new Error(NAMING_UNAVAILABLE)
  const reply = await h.middlewareRead('brand_identify', { text: text.trim() })
  const list = reply.result?.candidates
  return Array.isArray(list) ? list.filter(c => c && typeof c.ref === 'string' && typeof c.name === 'string') : []
}

/** Candidates that already have a Brand Clan are in the list above; do not offer them twice. */
export function newCandidates(candidates: readonly BrandCandidate[], targets: readonly AttachTarget[]): BrandCandidate[] {
  return candidates.filter(c => !targets.some(t => same(t.title, c.name)))
}

/** What to seed from: a brand the middleware found, or a name typed. */
export type SeedFrom = { ref: string; name: string } | { name: string }

/** The existing brand a duplicate-name refusal names, when it is one. */
export function duplicateRef(e: unknown): string | null {
  const m = /already has .*?\((brand\/[a-z0-9._-]+)\)/i.exec(e instanceof Error ? e.message : String(e))
  return m ? m[1] : null
}

/**
 * Create the Brand Clan, seed it, and attach it. When the seed fails the empty
 * Brand Clan stays in the studio's list (there is no way to delete a document
 * from here), so the words say so.
 */
export async function makeBrandClan(h: NamingHost, from: SeedFrom): Promise<AttachReply> {
  if (!h.hasMiddleware) throw new Error(NAMING_UNAVAILABLE)
  const name = from.name.trim()
  const { path } = await h.newDocumentQuietly(BRAND_APP, name)
  try {
    if ('ref' in from) {
      await h.middlewareRunOn(path, 'brand_seed', { ref: from.ref })
    } else {
      // The request carries no actor: the person is named in the input, or the
      // seed records the name as stated by human:unknown.
      const by = (await h.whoAmI()).actor
      try {
        await h.middlewareRunOn(path, 'brand_seed', { name, by })
      } catch (e) {
        // "the agency already has X (brand/x); seed it with input.ref": the
        // studio knows it after all, so seed this same empty Brand Clan from it.
        const ref = duplicateRef(e)
        if (!ref) throw e
        await h.middlewareRunOn(path, 'brand_seed', { ref })
      }
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(`The Brand Clan for ${name} could not be filled in: ${why}`, { cause: e })
  }
  const made = (await h.attachTargets()).find(t => t.path === path)
  if (!made) throw new Error(`The Brand Clan for ${name} was made, but it is not in the list yet. Find it there in a moment.`)
  try {
    return await h.attach(made.document_id)
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(`The Brand Clan for ${name} was made, but it could not be set here: ${why}`, { cause: e })
  }
}
