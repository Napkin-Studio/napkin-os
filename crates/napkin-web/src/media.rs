// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Where Production's pictures live: `NAPKIN_PRODUCTION_MEDIA_BASE`, an https
//! base the tool turns a sha256 into an address with. `GET /api/session`
//! carries it as `media_base`; no secret ever rides with it.

/// The variable that names the base.
pub const ENV: &str = "NAPKIN_PRODUCTION_MEDIA_BASE";

/// Clean up a configured base: trimmed, no trailing slash, and https (plain
/// http only for a loopback host, the local relay). Anything else is no base.
pub fn parse(raw: &str) -> Option<String> {
    let base = raw.trim().trim_end_matches('/');
    let rest = base.strip_prefix("https://").or_else(|| {
        base.strip_prefix("http://").filter(|r| {
            let host = r.split(['/', ':']).next().unwrap_or("");
            host == "localhost" || host == "127.0.0.1"
        })
    })?;
    (!rest.is_empty()).then(|| base.to_string())
}

/// The base from the environment, when set and acceptable.
pub fn from_env() -> Option<String> {
    std::env::var(ENV).ok().and_then(|v| parse(&v))
}

/// The variable that names where the browser PUTs upload bytes: the bucket's S3 origin the relay's
/// presigned links point at (owner, 2026-11-23: bytes go straight to S3 on short-lived links bound
/// to their hash; the page's CSP connect-src names this origin beside the media base).
pub const UPLOAD_ENV: &str = "NAPKIN_PRODUCTION_UPLOAD_ORIGIN";

/// The scheme and host of an acceptable base or origin (the same https-or-loopback rule as
/// `parse`), with any path dropped: what a CSP source names.
pub fn origin(raw: &str) -> Option<String> {
    let base = parse(raw)?;
    let (scheme, rest) = base.split_once("://")?;
    Some(format!("{scheme}://{}", rest.split('/').next()?))
}

/// The upload origin from the environment, when set and acceptable.
pub fn upload_origin_from_env() -> Option<String> {
    std::env::var(UPLOAD_ENV).ok().and_then(|v| origin(&v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_https_base_or_a_loopback_one_is_taken() {
        assert_eq!(
            parse(" https://cdn.example.com/m/ ").as_deref(),
            Some("https://cdn.example.com/m")
        );
        assert_eq!(
            parse("http://127.0.0.1:20431/blobs").as_deref(),
            Some("http://127.0.0.1:20431/blobs")
        );
        for bad in [
            "",
            "https://",
            "http://cdn.example.com",
            "ftp://x",
            "cdn.example.com",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn an_upload_origin_is_scheme_and_host_only() {
        assert_eq!(
            origin("https://napkin-hackathon-1.s3.eu-west-1.amazonaws.com/in/").as_deref(),
            Some("https://napkin-hackathon-1.s3.eu-west-1.amazonaws.com")
        );
        assert_eq!(
            origin("http://localhost:20431").as_deref(),
            Some("http://localhost:20431")
        );
        assert_eq!(origin("http://s3.example.com"), None);
        assert_eq!(origin(""), None);
    }
}
