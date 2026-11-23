# Production Tool identity: X-Napkin-Identity v1

napkin-web serves the Production Tool at `/production` and proxies
`/production/api/*` to the relay (features/os-sign-in.clan). The relay's
Function URL is public, so it never trusts a plain header: every proxied call
carries one signed, short-lived statement of who is asking, bound to that one
request.

- **Writer:** `crates/napkin-web/src/production.rs` (the proxy's signer).
- **Readers:** `production-tool/relay/identity.py` (`verify_assertion`, `who`).
  live-sync is the next reader, with `aud: "collab"`.
- **Shared vector:** `production-tool/contracts/examples/identity-assertion.vector.json`.
  A cargo test and a pytest both check it, so the two sides cannot drift.

## The header

```
X-Napkin-Identity: v1.<b64url(claims JSON)>.<b64url(HMAC-SHA256(key, "v1." + b64url(claims JSON)))>
```

`b64url` is URL-safe base64 without padding. The key is the UTF-8 bytes of the
shared secret: `NAPKIN_PRODUCTION_RELAY_SECRET` in napkin-web and
`TOKEN_SECRET` in the relay (the same Secrets Manager entry on AWS, a shared
dev value of 32 bytes or more locally).

## Claims

| Claim | Meaning |
|---|---|
| `u` | The account's username, `handle@agency` (`visionary@napkin`). |
| `a` | The agency: the tenant (`napkin`). |
| `t` | The tenant id: UUIDv5(`NAMESPACE_URL`, `"napkin:agency:" + a`) (`TenantId::of_agency`). |
| `n` | Optional. The person's display name (`Laurance`). |
| `aud` | `"relay"` for the proxy; `"assets"` for the read-only picture pass (below). Other audiences are refused by the relay. |
| `iat`, `exp` | Unix seconds. `exp = iat + 60` for `"relay"`; `exp = iat + 1800` for `"assets"`. |
| `m` | The HTTP method, upper case. |
| `p` | The path plus `?query` exactly as the relay receives it (`/api/jobs?x=1`; no `?` without a query). |
| `bh` | SHA-256 hex of the body bytes the relay receives (of the empty string when there is none). |

napkin-web writes the claims in this order as compact JSON; the relay reads
them as JSON, so order only matters for the vector.

## Verification (the relay)

`who(method, path_and_query, headers, body)` answers the person, or `None`
(401 on every route but `GET /health` and `GET /config`). It answers `None`
unless all of these hold:

1. The header has three dot-separated parts and starts `v1.`.
2. The signature matches, in constant time, under one of the keys in
   `TOKEN_SECRET` (comma-separated, newest first: `new,old` during a rotation).
   The secret is re-read from Secrets Manager at most every 5 minutes.
3. `aud` is `"relay"` or `"assets"`; `iat <= now + 30`; `now <= exp + 30`.
4. For `"relay"`: `m`, `p` and `bh` match the request the relay actually received. For `"assets"`: the
   request is `GET /assets/{sha256}[?w=...]` (or `/api/assets/...`) with no body, and `exp - iat <= 3600`
   (see below).
5. `t == uuid5(NAMESPACE_URL, "napkin:agency:" + a)`, and `u` has a local part.

The person is `{pid, h, t, name, tenant: {id, agency}}`, with
`h` the local part of `u`, `t` the agency, and
`pid = participant_id(a, h)` (`service.py`).

## The assets pass: `aud: "assets"`

The Deck Maker's engine builds a deck in a middleware job that holds no relay key and does not know who is
asking, yet a deck spun off from a Production document (features/production-spinoff.clan; since 2026-11-23 a library document, `os-layer.md` 5.8) names its pictures by
sha256, and the relay holds them. So napkin-web, which knows who is asking, signs one **read-only pass** per
deck build and hands it to the build; the engine reads each picture with `GET /assets/{sha256}?w=2400`.

- **Same key, same format.** The same HMAC under `NAPKIN_PRODUCTION_RELAY_SECRET` / `TOKEN_SECRET`, the same
  `v1.` header. No new secret, no Terraform. Rotation covers it as it covers `"relay"`.
- **Claims.** `u`, `a`, `t`, `n` as above, for the person who started the build; `aud: "assets"`;
  `m: "GET"`, `p: "/api/assets/*"` and `bh` of the empty body are written for the vector's sake and are not
  matched against the request: the pass is good for any picture, not for one path.
- **Where the relay accepts it: only `GET /assets/{sha256}[?w=...]`.** Any other method or path, or a body,
  answers `None` (401), as with no identity. The hold check is today's: the tenant in the claims must hold the
  hash, else the same 404 as an unknown picture.
- **Lifetime: `exp = iat + 1800` (30 minutes).** A deck job's own ceiling is `MAX_WAIT = 3600` s for one
  segment (`server/napkin/deck/job.py`); the pass is only used by the picture step, whose fetches are capped at
  30 s each and 40 pictures a run in the engine, so it needs minutes, not the segment's whole ceiling. 30 minutes
  covers a build's picture step with room, and a stolen pass reads one agency's pictures for at most that long. The relay refuses any pass whose
  `exp - iat` exceeds 3600, so a signer cannot mint a day-long one by mistake. napkin-web signs a fresh pass for
  every `build_deck` it forwards, so a long gate-to-gate wait never outlives one.
- **An `aud: "relay"` assertion keeps its 60 s rule** and its binding to one request; it is not an assets pass.
- **Writer:** `crates/napkin-web/src/production.rs`. **Reader:** `identity.verify_assertion`.
- **Where the pass goes:** into the forwarded `build_deck` body as `production_assets: {base, pass}`, set by
  napkin-web only (a client's value is dropped), and to the engine's picture step only. It is never written
  into the document, a stage file or the report, and never logged. The engine sends it to the relay host
  only, not to the picture CDN the relay redirects to.

## Rotation

1. Put `new,old` in the relay's secret and wait 5 minutes.
2. Give napkin-web `new` and force a new web deployment (it signs with the
   first key only).
3. Put `new` alone in the relay's secret.
