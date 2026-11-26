// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one question about a file that looks like a brand bible (mock a1), and the card that says it is being built in the background (mock a2).
// It sits in the strip under the bar, in the flow: it never covers the app and never blocks "Write the brief". One card per file, the
// first that needs the person; the rest wait their turn.

import { useBrandFlow } from './useBrandFlow'
import { BrandCard } from './BrandCard'

interface Props { docPath: string; client: { id: string; name: string } | null }

/** The strip: the first file that needs the person, with the others waiting. */
export default function BrandAsk({ docPath, client }: Props) {
  const { entries, flow } = useBrandFlow(docPath, client)
  const shown = entries.filter(e => e.phase.kind !== 'detecting')
  if (!client || !shown.length) return null
  return (
    <div className="bq-strip" data-testid="brand-strip">
      {shown.map(e => <BrandCard key={e.id} entry={e} client={client.name} flow={flow} />)}
    </div>
  )
}
