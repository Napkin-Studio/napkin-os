"""Where a member entry came from, as the source card says it (`origin_kind`, OS-layer contract §8.3).

`origin` on a pin is already the layer row's fact:// address, and on a field envelope it is
extracted/proposed/confirmed/stated, so the marker has its own name. The middleware writes it on each
new pin and finding:

- `research`: found by a research lens, or derived from such pins (a synthesised finding).
- `layer`: a row the knowledge layers already held, pinned as it was (a reused row, a roster row).
- `client`, `person`: a client's material and a typed prompt need no marker; the card reads them from
  the material's kind.
- `brand`: written by the Brand Clan's copy (feat/brand-clan), not here.
"""

RESEARCH = "research"
LAYER = "layer"
CLIENT = "client"
BRAND = "brand"
PERSON = "person"

KEY = "origin_kind"
