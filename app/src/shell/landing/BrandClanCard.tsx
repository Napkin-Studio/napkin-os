// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client page's Brand Clan card (features/new-ui-shell.clan). It reads the
// client's brand document from the library (app `ie.napkin.brand`); until that
// app exists the card says "No Brand Clan yet" and both ways in (upload the
// brand's files, start a Brand Clan; owner, 9 Nov 2026: "both") stay in their
// place, disabled, with the reason. Never invented content.

import type { LibraryItem } from '../../host'
import { DocList } from './DocList'

/** The Brand Clan app's id (feat/brand-clan). */
export const BRAND_APP = 'ie.napkin.brand'

interface Props {
  client: string
  /** The client's brand documents, if any. */
  docs: LibraryItem[]
  onOpenItem: (path: string) => void
}

const NOT_YET = 'Brand Clan is not in this studio yet; it arrives with the Brand Clan app.'

export function BrandClanCard({ client, docs, onOpenItem }: Props) {
  return (
    <section className="lc-work lc-brand" aria-label={`Brand Clan for ${client}`} data-testid="brand-clan">
      <h2 className="lc-strip-h">Brand Clan</h2>
      {docs.length > 0 ? (
        <DocList items={docs} onOpenItem={onOpenItem} testid="brand-item" />
      ) : (
        <div className="lc-brand-empty">
          <p><b>No Brand Clan yet</b> for {client}. Its logos, colours and voice will live here, and every document for {client} can use them.</p>
          <div className="lc-brand-acts">
            <button className="ch-btn" disabled aria-describedby="lc-brand-why" data-testid="brand-upload">Upload brand files</button>
            <button className="ch-btn" disabled aria-describedby="lc-brand-why" data-testid="brand-start">Start a Brand Clan</button>
          </div>
          <p className="lc-mut" id="lc-brand-why">{NOT_YET}</p>
        </div>
      )}
    </section>
  )
}
