# Production Tool identity: the service credential and the assets pass

napkin-web is the only caller of the Production relay (features/production-jobs-via-host.clan). The relay's
Function URL is public, so it never trusts a plain header: every call carries napkin-web's **service
credential**, a secret only napkin-web and the relay hold plus one short-lived, signed statement of who is
asking, bound to that one request. The per-user `X-Napkin-Identity` assertion with `aud: "relay"` is retired
(no backward compatibility: the relay refuses it); `X-Napkin-Identity` survives only as the Deck's read-only
assets pass, below.

- **Writer:** `crates/napkin-web/src/production.rs` (lane E1).
- **Reader:** `production-tool/relay/identity.py` (`verify_service`, `who`).
- **Shared vector:** `production-tool/contracts/examples/service-credential.vector.json`. The relay's pytest
  and `production-tool/contracts/check.py` check it (a cargo test checks it on napkin-web's side), so the two
  sides cannot drift.

## The two headers

```
Authorization: Bearer <service key>
X-Napkin-User: <b64url(claims JSON)>.<b64url(HMAC-SHA256(key, mac input))>
```

`b64url` is URL-safe base64 without padding. The service key is `SERVICE_KEY` in the relay (Secrets Manager
`napkin-hackathon/SERVICE_KEY` on AWS; a shared dev value of 32 characters or more locally) and the same
value in napkin-web. A key shorter than 32 characters is no key. The HMAC key is the service key itself (one
secret). The **mac input** is these lines, joined with a single LF and no trailing LF:

```
napkin-user-v1
<METHOD, upper case>
<path plus ?query exactly as the relay receives it; no ? without a query>
<hex SHA-256 of the body bytes the relay receives; of the empty string when there is none>
<the b64url claims, exactly as sent>
```

## Claims

| Claim | Meaning |
|---|---|
| `u` | The account's username, `handle@agency` (`visionary@napkin`). |
| `a` | The agency: the tenant (`napkin`). |
| `t` | The tenant id: UUIDv5(`NAMESPACE_URL`, `"napkin:agency:" + a`) (`TenantId::of_agency`). |
| `n` | Optional. The person's display name (`Laurance`). |
| `doc` | Optional. The library document the call is for; the relay only logs it. |
| `iat`, `exp` | Unix seconds. napkin-web signs `exp = iat + 60`; the relay refuses a claim with `exp - iat > 120`. |

## Verification (the relay)

`who(method, path_and_query, headers, body)` answers the person, or `None` (401 on every route but
`GET /health` and `GET /config`), or raises `Forbidden` (403 `not_allowed`). With an `Authorization` header it
checks, in order:

1. The scheme is `Bearer` and the token equals one of the keys in `SERVICE_KEY` (comma-separated, newest
   first: `new,old` during a rotation), compared in constant time. The secret is re-read from Secrets Manager
   at most every 5 minutes. No `SERVICE_KEY` set means nobody is anyone (fail closed). **401** otherwise.
2. `X-Napkin-User` has two dot-separated parts, and the HMAC matches under the key that matched the bearer, in
   constant time, over the method, path and query, body hash and claims the relay actually received. A claim
   is good for exactly one call. **401** otherwise.
3. `iat <= now + 30`, `now <= exp + 30` and `exp - iat <= 120`; `u` has a local part and `a` is set. **401**
   otherwise.
4. `t == uuid5(NAMESPACE_URL, "napkin:agency:" + a)`. **403** `not_allowed` otherwise: the credential is good,
   the claim is not one the relay will act on.

Without an `Authorization` header only the assets pass below is tried.

There is no nonce: a captured request can be replayed for at most about 90 s (60 s plus the skew), and only
byte for byte. `POST /jobs` is idempotent on its `jobId`, so a replay does not make a second job, and the
tenant checks, caps and the global stop still apply to every call.

The person is `{pid, h, t, name, doc, tenant: {id, agency}}`, with `h` the local part of `u`, `t` the agency
and `pid = participant_id(a, h)` (`service.py`). An agency that is not enabled in the tenants table gets 403
`flag_off` as before; a job is only ever read, answered or cancelled by its own agency (404 otherwise).

## The assets pass: `aud: "assets"`

The Deck Maker's engine builds a deck in a middleware job that holds no relay key and does not know who is
asking, yet a deck spun off from a Production document (features/production-spinoff.clan; since 2026-11-23 a library document, `os-layer.md` 5.8) names its pictures by
sha256, and the relay holds them. So napkin-web, which knows who is asking, signs one **read-only pass** per
deck build and hands it to the build; the engine reads each picture with `GET /assets/{sha256}?w=2400`.

- **Its own key, the old format.** `X-Napkin-Identity: v1.<claims>.<HMAC-SHA256>` under `NAPKIN_PRODUCTION_RELAY_SECRET`
  in napkin-web and `TOKEN_SECRET` in the relay (`napkin-hackathon/TOKEN_SECRET`, unchanged), `"new,old"` during a
  rotation. The header is `v1.<b64url(claims JSON)>.<b64url(HMAC-SHA256(key, "v1." + b64url(claims JSON)))>`.
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
- **An `aud: "relay"` assertion is refused** (retired); only `aud: "assets"` is read.
- **Writer:** `crates/napkin-web/src/production.rs`. **Reader:** `identity.verify_assertion` (assets only).
- **Where the pass goes:** into the forwarded `build_deck` body as `production_assets: {base, pass}`, set by
  napkin-web only (a client's value is dropped), and to the engine's picture step only. It is never written
  into the document, a stage file or the report, and never logged. The engine sends it to the relay host
  only, not to the picture CDN the relay redirects to.

## Rotation

For each key (`SERVICE_KEY`; `TOKEN_SECRET` for the assets pass):

1. Put `new,old` in the relay's secret and wait 5 minutes.
2. Give napkin-web `new` and force a new web deployment (it signs with the first key only).
3. Put `new` alone in the relay's secret.
