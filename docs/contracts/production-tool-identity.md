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
| `aud` | `"relay"` for the proxy. Other audiences are refused by the relay. |
| `iat`, `exp` | Unix seconds. `exp = iat + 60`. |
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
3. `aud == "relay"`; `iat <= now + 30`; `now <= exp + 30`.
4. `m`, `p` and `bh` match the request the relay actually received.
5. `t == uuid5(NAMESPACE_URL, "napkin:agency:" + a)`, and `u` has a local part.

The person is `{pid, h, t, name, tenant: {id, agency}}`, with
`h` the local part of `u`, `t` the agency, and
`pid = participant_id(a, h)` (`service.py`).

## Rotation

1. Put `new,old` in the relay's secret and wait 5 minutes.
2. Give napkin-web `new` and force a new web deployment (it signs with the
   first key only).
3. Put `new` alone in the relay's secret.
