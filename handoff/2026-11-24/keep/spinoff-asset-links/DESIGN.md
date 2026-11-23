# Spin-offs carry assets as links (feature spinoff-asset-links)

Status: design only, awaiting owner approval. Record: features/spinoff-asset-links.clan on branch feat/spinoff-asset-links (base feat/production-spinoff).

## What changes
Today every spin-off copies the source's files into the new document. A Brief with client PDFs and pictures becomes a Production project, then a Deck, each holding its own copy of the bytes. After this feature a file is stored once per agency, and a document holds only its sha256 (a link). One rule for all assets: pictures, video, audio, and also client PDFs/Word/decks (their text already travels as facts/findings).

## Chosen approach (A): a workspace file store beside the documents
- Files live in <data root>/<agency>/blobs/<sha256>, written once, hash checked, never overwritten. Same disk and mount as the documents: no Terraform, no new setting.
- A document records a link (manifest file entry with the sha256, flagged linked, no bytes inside). Upload and spin-off make links; they never copy bytes.
- Reading a link only works inside the same agency (the folder is the agency's), like Production's pictures.
- Deleting the source document never touches the file, so the copy keeps working.
- Download of a .clan, and the PDF/HTML exports, put the bytes back in, so a file taken away works alone. A missing file is named in the refusal; the document itself still opens.
- Clearing unused files is a manual sweep (dry-run first): it removes only files no document references and older than 7 days, so a spin-off in flight is never broken.
- Desktop and the browser host have no such store and keep embedding, because their files get moved and emailed.

## Rejected
- (B) link to (source doc, file): breaks when the source is deleted, which you ruled out.
- (C) dedupe on write only: saves some disk but not the copying, the big saves or the size limits, and gives no link.
- Refcounting: counters drift, a wrong zero deletes a client's file.

## Cost
Build about 3-4 days: store half + tenant implementation, link mode in the spin-off code, serving links, upload, "inline on the way out", a small spec addition (a linked flag on a manifest file entry), tests. Run: one extra file read per asset view, one hash per upload, and no more per-spin-off byte copies (a 12 MB pack no longer grows each document in the chain).

## Main risks and how they are covered
Deleted source (files belong to the agency, not the document); sweep racing a spin-off (grace period, manual, dry-run); desktop/browser (store is optional, behaviour unchanged); confidentiality (a link is a hash only resolvable in the agency; the store is never read by RAG/layers/training, which still read text with its marks); signed documents (hash is in the manifest); size limits (upload cap unchanged, documents shrink).

## Questions for you
1. Documents that already hold embedded files: leave them (they are moved into the store only when next spun off, my proposal) or run a one-off migration on UAT/staging? You said no backward compat by default, so I am asking.
2. Keep the extracted-text sidecars (small .txt the model reads) inside the document? I propose yes.
3. Does the Deck engine or relay ever need the bytes of an OS file by hash? If yes, a signed read pass like Production's, as a later feature. Not built now.
4. Sweep grace period (7 days) and any per-agency storage quota or alert?
5. Confirm only the hosted web links; desktop and the browser tab keep embedding.

One-way edge: once links are written, rolling the image back leaves them unresolved; before a rollback run the inline-all step or restore EFS.
