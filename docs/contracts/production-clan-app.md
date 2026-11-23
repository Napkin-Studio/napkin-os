# Production as a CLAN app: the contract

Normative for features `production-as-clan-app` (stages 0 to 3). Source: BUILD-PLAN section 2. Vectors: `docs/contracts/examples/production-clan-app/*.json` (regenerate with `make_vectors.py`; the host tests and `production-tool/web/src/test/hostStub.ts` both read them). A change here is a recorded decision first.

Notation: `{t}` the tenant id (`GET /api/session` `tenant`); `{doc}` the library document id (the string in `/t/{t}/d/{doc}`); `V` a version, `sha256:<64 hex>`, the sha256 of the archive bytes. Every route is under `/api` and needs the session cookie (none: 401). Another tenant's document: 404.

## 1. Save: `PUT /api/t/{t}/d/{doc}/save`

- Request: `Content-Type: application/vnd.clan+zip`; `If-Match: "V"` (required); `X-Clan-Reason: interval|accept|manual|handoff|export|landing` (default `interval`); body the `.clan` bytes, at most 32 MiB.
- 200: `{"version":"V2","saved_at":"<RFC 3339>","snapshot":true|false}` and `ETag: "V2"`. `V2` is the sha256 of the bytes sent.
- 409: `{"error":{"code":"conflict","message":"This project was saved from somewhere else since you opened it."},"latest":"V3"}`; the store is untouched.
- 428 no `If-Match`. 422 the document is not an instance of `ie.napkin.production` (another app, or a template), or the archive's document identity is not this document's. 400 unreadable archive. 413 over 32 MiB. 404 missing or another tenant's. 401 no session.
- Document identity is `manifest.document_id`, falling back to `manifest.id` for older files. `manifest.id` is per revision and is never compared. (Clarified 2026-11-23 with the lead.)
- The manifest's `client` and `title` in the saved bytes are taken as sent.
- Error bodies other than 409 are `{"error":"<text>"}`; the status is the contract, the text is not.

## 2. Read: `GET /api/t/{t}/d/{doc}/download`

Also returns `ETag: "V"` and `X-Saved-At`. The version is also in `GET .../data`.

## 3. Base check (every writer)

`PartStore::apply(Change{doc,bytes,base})`: `Base::At(V)` with a different stored version is `HostError::conflict` (HTTP 409, body of section 1 with `latest`); `Base::Absent` over an existing document is 409. Check and write are one critical section per document. A write is a temp file in the same directory, fsync, rename, fsync of the directory; a leftover `*.tmp` is ignored. Implemented only in `crates/napkin-web/src/store.rs`; `napkin-host` stays wasm32-clean.

## 4. Snapshots (host-internal)

`<store root>/<tenant>/snapshots/<doc-slug>/<unix-ms>-<reason>-<hex12>.clan`. Taken for reasons `accept`, `handoff`, `export`, and for `interval`/`manual`/`landing` when the newest is 10 minutes or older. Keep the newest 50, never delete the newest, never list them in the library. Restore is a documented copy.

## 5. Page and open path

Stage 1: `/production/?doc=<doc>`; the page reads the tenant from `/api/session`. No `doc`: the project list is `GET /api/t/{t}/library` filtered to `app_id == "ie.napkin.production"`. New project: `POST /api/t/{t}/documents {"app_id":"ie.napkin.production","title":"<name>","client_id":"<id>"?}` answering the OpenView (`path` is the doc id), then navigate to `?doc=<path>`. No Delete in stage 1. Stage 2 moves the path to `/production/d/<doc>` (alias kept one release).

## 6. Spin-off: `POST /api/t/{t}/d/{doc}/spinoff`

`{"app_id":"<target>","title":"<opt>","map":"<opt>"}` answers the OpenView. Targets from `GET .../spinoff-targets`. Production is a target for brief, research and territory sources and a source for Deck. Not installed: 422 `{"error":"app not installed: <app id>"}`. The new document's `source_uri` is `doc:<source doc id>@<source version>`; `data.upstream.<source doc id>` holds the source's data and decisions; pictures are links by sha256. The source's client is the new document's client. `POST /t/{t}/spinoff/production` and `POST /t/{t}/production/{project}/spinoff` are removed (404).

## 7. Library item

`GET /api/t/{t}/library` lists Production documents as any other: `{path, title, app_id:"ie.napkin.production", client:{id,name}|null, ...}`. No new field.

## 8. Session

`GET /api/session` gains `"media_base": "<https base>"|null`, never a secret. A picture with sha `h` is `${media_base}/<prefix>/<hex>`, prefix by origin (`in` uploads, `out` generated, `ads` renders), the keys `production-tool/relay/blobs.py` writes. No address is stored in the document.

## 9. Document (contract 3)

`assets[].locations` is not written and never trusted when read; `client_id` unchanged; nothing else changes.

## 10. Relay (T3)

`GET|POST|PUT /clan*` and `/projects*` answer 410 `{"error":{"code":"gone","message":"Reload the page: projects now live in the library."}}`; napkin-web's `/production/api` proxy answers 404 for those prefixes. Jobs, uploads, assets, library, config and me are unchanged.

## Vector format

`{vector, tenant, now, session_cookie, documents[], installed_apps?, steps[]}` (`session.json` has `variants[]` of `{media_base, steps}`). A step is a request and the response to assert: `status`, exact `headers`, and one of `body` (exact JSON), `body_base64` (exact bytes) or `body_subset` (each listed field must match). A request body is `body_base64`, `body` (JSON) or `body_size` (that many zero bytes). A document has `tenant, id, app_id, identity, template, title, bytes_base64, version, saved_at, client?`. Steps run in order against one store; a refused step leaves it unchanged.
