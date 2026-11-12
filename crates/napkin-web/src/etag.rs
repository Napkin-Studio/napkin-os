// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Revalidation for the lists the shell polls (features/doc-open-speed.clan).
//!
//! While a document is open the shell re-reads `/clients`, `/library` and
//! `/apps` every few seconds, and nearly every answer is the one it already
//! has. Each answer carries a weak `ETag` of its bytes and `Cache-Control:
//! private, no-cache`, so the browser keeps it and asks again with
//! `If-None-Match`; an unchanged list comes back `304` with no body, and the
//! browser hands the page its kept copy. The page's code sees the same `200`
//! and the same JSON either way, and it is never served a stale list: every
//! poll still reaches the server.

use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use sha2::{Digest, Sha256};

/// The largest list worth hashing; anything bigger passes through untouched.
const MAX: usize = 8 * 1024 * 1024;

/// The weak validator of a body: its SHA-256, shortened.
pub fn tag_of(body: &[u8]) -> String {
    let digest = Sha256::digest(body);
    let short = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&digest[..12]);
    format!("W/\"{short}\"")
}

/// Whether `If-None-Match` names `tag` (weak comparison, as RFC 9110 §13.1.2 asks).
pub fn matches(if_none_match: &str, tag: &str) -> bool {
    let opaque = |t: &str| t.trim().trim_start_matches("W/").to_string();
    let want = opaque(tag);
    if_none_match
        .split(',')
        .any(|t| t.trim() == "*" || opaque(t) == want)
}

/// Middleware: tag a successful GET's body, and answer `304` when the browser
/// already holds it.
pub async fn revalidate(request: Request, next: Next) -> Response {
    if request.method() != Method::GET {
        return next.run(request).await;
    }
    let held = request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let response = next.run(request).await;
    if response.status() != StatusCode::OK {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = to_bytes(body, MAX).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let tag = tag_of(&bytes);
    let tag_value = HeaderValue::from_str(&tag).expect("base64 and quotes are a valid header");
    let no_cache = HeaderValue::from_static("private, no-cache");
    if held.as_deref().is_some_and(|h| matches(h, &tag)) {
        let mut not_modified = StatusCode::NOT_MODIFIED.into_response();
        not_modified.headers_mut().insert(header::ETAG, tag_value);
        not_modified
            .headers_mut()
            .insert(header::CACHE_CONTROL, no_cache);
        return not_modified;
    }
    parts.headers.insert(header::ETAG, tag_value);
    parts.headers.insert(header::CACHE_CONTROL, no_cache);
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tag_is_weak_and_stable_and_tells_bodies_apart() {
        let a = tag_of(b"[1,2]");
        assert!(a.starts_with("W/\""));
        assert_eq!(a, tag_of(b"[1,2]"));
        assert_ne!(a, tag_of(b"[1,2,3]"));
    }

    #[test]
    fn if_none_match_compares_weakly_and_takes_lists_and_star() {
        let t = tag_of(b"x");
        let strong = t.trim_start_matches("W/");
        assert!(matches(&t, &t));
        assert!(matches(strong, &t));
        assert!(matches(&format!("\"other\", {t}"), &t));
        assert!(matches("*", &t));
        assert!(!matches("\"other\"", &t));
    }
}
