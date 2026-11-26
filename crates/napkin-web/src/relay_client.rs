// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! napkin-web's one way of calling the Production relay
//! (features/production-jobs-via-host.clan, docs/contracts/production-tool-identity.md).
//!
//! The relay's Function URL is public, so every call carries two things the
//! browser never sees and never supplies:
//!
//! * `Authorization: Bearer <service key>`: napkin-web is the caller.
//! * `X-Napkin-User: <b64url claims>.<b64url HMAC-SHA256(key, input)>`: who is
//!   asking, minted here from the signed-in session (`u` username, `a` agency,
//!   `t` tenant, `n` name, `doc` the library document the call is for, `iat`,
//!   `exp = iat + 60`). The HMAC binds the claim to this one request: `input` is
//!   the lines `napkin-user-v1`, METHOD, path and query, hex SHA-256 of the body
//!   and the b64url claims, joined with LF. A relay that does not know the key
//!   refuses; one that knows it refuses a claim for another agency.
//!
//! No header of the browser's request is copied except the few the relay reads
//! ([`FORWARD`]); a claim or credential the browser sent is dropped. The shared
//! test vector is `production-tool/contracts/examples/service-credential.vector.json`.
//!
//! The relay's refusals come back in plain words ([`plain`]): a person cannot do
//! anything about "401", and a wrong service key is not their account.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::auth::Account;
use crate::tenant::TenantId;

/// The header that names the person.
pub const USER_HEADER: &str = "x-napkin-user";
/// The first line of what the claim's HMAC covers.
pub const USER_DOMAIN: &str = "napkin-user-v1";
/// How long a claim is good for.
pub const USER_TTL_S: u64 = 60;
/// The shortest service key accepted.
pub const MIN_KEY: usize = 32;
/// Request headers the relay is given from the browser's request, and nothing else.
pub const FORWARD: [&str; 3] = ["content-type", "if-match", "x-clan-reason"];
/// Response headers passed back to the tool. `location`: `GET /assets/{sha}`
/// answers 302 to the picture's URL, which the browser follows.
pub const PASS_BACK: [&str; 5] = [
    "content-type",
    "cache-control",
    "etag",
    "x-saved-at",
    "location",
];

/// What the relay is told about the person, in the order the contract writes it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct UserClaims {
    pub u: String,
    pub a: String,
    pub t: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<String>,
    /// The library document this call is for, when it is for one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub iat: u64,
    pub exp: u64,
}

impl UserClaims {
    pub fn of(account: &Account, doc: Option<&str>, now: u64) -> Self {
        Self {
            u: account.username.clone(),
            a: account.agency.clone(),
            t: TenantId::of_agency(&account.agency).to_string(),
            n: account.name.clone(),
            doc: doc.map(str::to_string),
            iat: now,
            exp: now + USER_TTL_S,
        }
    }
}

/// The two headers of one relay call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub authorization: String,
    pub user: String,
}

/// SHA-256 of the body, lower-case hex.
pub fn body_hash(body: &[u8]) -> String {
    Sha256::digest(body)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Mint the credential for one request. `key` is the service key as the relay
/// holds it (UTF-8 bytes).
pub fn mint(
    key: &[u8],
    claims: &UserClaims,
    method: &str,
    path_and_query: &str,
    body: &[u8],
) -> Credential {
    let json = serde_json::to_vec(claims).expect("claims serialise");
    let c = B64.encode(json);
    let input = [
        USER_DOMAIN,
        &method.to_ascii_uppercase(),
        path_and_query,
        &body_hash(body),
        &c,
    ]
    .join("\n");
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    mac.update(input.as_bytes());
    Credential {
        authorization: format!("Bearer {}", String::from_utf8_lossy(key)),
        user: format!("{c}.{}", B64.encode(mac.finalize().into_bytes())),
    }
}

pub fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// What the relay answered, or what stands in for it.
pub struct Answer {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
}

impl Answer {
    /// The relay's error shape (common.schema.json).
    pub fn error(status: StatusCode, code: &str, message: &str, retryable: bool) -> Self {
        let body = serde_json::json!({"error": {"code": code, "message": message, "retryable": retryable}});
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        Self {
            status,
            headers,
            body: Bytes::from(body.to_string()),
        }
    }

    pub fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// The relay's answer in plain words when it refused napkin-web (401, or a 403
/// that is not the agency being off). `None` leaves the answer as it is.
///
/// * 401: the relay did not accept the service key or the claim. That is
///   napkin-web's setup, not the person's sign-in, so it is a 502 the person is
///   told not to fix, and never the 401 the tool reads as "signed out".
/// * 403 `flag_off`: the agency is not on Production; the tool shows that itself.
/// * any other 403: the relay would not act for the workspace the claim named.
pub fn plain(status: StatusCode, body: &[u8]) -> Option<Answer> {
    match status {
        StatusCode::UNAUTHORIZED => Some(Answer::error(
            StatusCode::BAD_GATEWAY,
            "provider_unavailable",
            "Production could not confirm Napkin Studio's sign-in with it. Nothing is wrong with your account; tell Napkin.",
            false,
        )),
        StatusCode::FORBIDDEN => {
            let code = serde_json::from_slice::<serde_json::Value>(body)
                .ok()
                .and_then(|v| v["error"]["code"].as_str().map(str::to_string));
            if code.as_deref() == Some("flag_off") {
                None
            } else {
                Some(Answer::error(
                    StatusCode::FORBIDDEN,
                    "unauthorised",
                    "Production would not act for this workspace. Open the project from your own agency's library.",
                    false,
                ))
            }
        }
        _ => None,
    }
}

/// The relay, as napkin-web calls it.
pub struct RelayClient {
    pub url: String,
    key: Vec<u8>,
    http: reqwest::Client,
}

impl RelayClient {
    /// `url` without a trailing slash; `key` the service key (the first of a
    /// comma-separated `new,old` list during a rotation).
    pub fn new(url: &str, key: &[u8], timeout: Duration) -> Self {
        Self {
            url: url.trim_end_matches('/').to_string(),
            key: key.to_vec(),
            http: reqwest::Client::builder()
                .timeout(timeout)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("the HTTP client builds"),
        }
    }

    /// The credential this client would send for one request (tests, and the
    /// calls below).
    pub fn credential(
        &self,
        account: &Account,
        doc: Option<&str>,
        method: &str,
        path_and_query: &str,
        body: &[u8],
        now: u64,
    ) -> Credential {
        mint(
            &self.key,
            &UserClaims::of(account, doc, now),
            method,
            path_and_query,
            body,
        )
    }

    /// One call to the relay for `account` about `doc`. `path_and_query` is what
    /// the relay receives (`/api/jobs?x=1`). `headers` is the browser's own set:
    /// only [`FORWARD`] of it is sent, and never a credential.
    pub async fn call(
        &self,
        account: &Account,
        doc: Option<&str>,
        method: Method,
        path_and_query: &str,
        headers: &HeaderMap,
        body: Bytes,
    ) -> Answer {
        let cred = self.credential(
            account,
            doc,
            method.as_str(),
            path_and_query,
            &body,
            now_s(),
        );
        let mut out = self
            .http
            .request(method, format!("{}{path_and_query}", self.url));
        for name in FORWARD {
            for value in headers.get_all(name) {
                out = out.header(name, value.clone());
            }
        }
        out = out
            .header(header::AUTHORIZATION, cred.authorization)
            .header(USER_HEADER, cred.user)
            .body(body);
        let timeout = || {
            Answer::error(
                StatusCode::GATEWAY_TIMEOUT,
                "timeout",
                "The Production Tool took too long to answer. Try again.",
                true,
            )
        };
        let down = || {
            Answer::error(
                StatusCode::BAD_GATEWAY,
                "provider_unavailable",
                "The Production Tool could not be reached. Try again in a moment.",
                true,
            )
        };
        let answer = match out.send().await {
            Ok(r) => r,
            Err(e) if e.is_timeout() => {
                tracing::warn!(target: "napkin_web::production", error = %e, "relay timed out");
                return timeout();
            }
            Err(e) => {
                tracing::warn!(target: "napkin_web::production", error = %e, "relay unreachable");
                return down();
            }
        };
        let status = answer.status();
        let mut passed = HeaderMap::new();
        for name in PASS_BACK {
            if let Some(v) = answer.headers().get(name) {
                passed.insert(HeaderName::from_static(name), v.clone());
            }
        }
        let bytes = match answer.bytes().await {
            Ok(b) => b,
            Err(e) if e.is_timeout() => return timeout(),
            Err(_) => return down(),
        };
        if let Some(words) = plain(status, &bytes) {
            tracing::warn!(target: "napkin_web::production", status = status.as_u16(), "relay refused napkin-web");
            return words;
        }
        Answer {
            status,
            headers: passed,
            body: bytes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn vector() -> serde_json::Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../production-tool/contracts/examples/service-credential.vector.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn laurance() -> Account {
        Account {
            username: "visionary@napkin".into(),
            agency: "napkin".into(),
            name: Some("Laurance".into()),
        }
    }

    #[test]
    fn the_minter_produces_the_shared_vector_exactly() {
        let v = vector();
        let c = &v["claims"];
        let claims = UserClaims::of(
            &laurance(),
            Some(c["doc"].as_str().unwrap()),
            c["iat"].as_u64().unwrap(),
        );
        assert_eq!(
            serde_json::to_string(&claims).unwrap(),
            v["claimsJson"].as_str().unwrap()
        );
        assert_eq!(claims.t, c["t"].as_str().unwrap());
        let cred = mint(
            v["key"].as_str().unwrap().as_bytes(),
            &claims,
            v["method"].as_str().unwrap(),
            v["pathAndQuery"].as_str().unwrap(),
            v["body"].as_str().unwrap().as_bytes(),
        );
        assert_eq!(cred.authorization, v["authorization"].as_str().unwrap());
        assert_eq!(cred.user, v["userHeader"].as_str().unwrap());
    }

    #[test]
    fn a_claim_lives_a_minute_and_names_the_document_only_when_there_is_one() {
        let c = UserClaims::of(&laurance(), None, 1000);
        assert_eq!((c.iat, c.exp), (1000, 1060));
        assert!(!serde_json::to_string(&c).unwrap().contains("doc"));
        let nameless = Account {
            name: None,
            ..laurance()
        };
        assert!(
            !serde_json::to_string(&UserClaims::of(&nameless, Some("d"), 1))
                .unwrap()
                .contains("\"n\"")
        );
    }

    #[test]
    fn the_signature_binds_the_method_the_path_the_body_and_the_key() {
        let c = UserClaims::of(&laurance(), Some("d"), 1);
        let k = [7u8; 32];
        let base = mint(&k, &c, "POST", "/api/jobs", b"{}").user;
        assert_ne!(base, mint(&k, &c, "GET", "/api/jobs", b"{}").user);
        assert_ne!(base, mint(&k, &c, "POST", "/api/jobs?x=1", b"{}").user);
        assert_ne!(base, mint(&k, &c, "POST", "/api/jobs", b"{ }").user);
        assert_ne!(base, mint(&[8u8; 32], &c, "POST", "/api/jobs", b"{}").user);
        // method case does not matter, the key is the bearer
        assert_eq!(base, mint(&k, &c, "post", "/api/jobs", b"{}").user);
        assert_eq!(
            mint(&k, &c, "GET", "/", b"").authorization,
            format!("Bearer {}", String::from_utf8_lossy(&k))
        );
    }

    #[test]
    fn a_refusal_is_said_in_plain_words_and_never_reads_as_signed_out() {
        let a = plain(StatusCode::UNAUTHORIZED, b"{}").unwrap();
        assert_eq!(a.status, StatusCode::BAD_GATEWAY);
        let m = a.json().unwrap()["error"]["message"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(m.contains("not your account") || m.contains("Nothing is wrong with your account"));
        assert!(!m.contains("401"));
        let a = plain(StatusCode::FORBIDDEN, br#"{"error":{"code":"forbidden"}}"#).unwrap();
        assert_eq!(a.status, StatusCode::FORBIDDEN);
        assert_eq!(a.json().unwrap()["error"]["code"], "unauthorised");
        // the agency being off is the tool's own message
        assert!(plain(StatusCode::FORBIDDEN, br#"{"error":{"code":"flag_off"}}"#).is_none());
        assert!(plain(StatusCode::OK, b"").is_none());
        assert!(plain(StatusCode::NOT_FOUND, b"").is_none());
    }
}
