// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Spin-offs to and from Production (`features/production-spinoff.clan`).
//!
//! Production is an OS app (`ie.napkin.production`), but its projects are not
//! library documents: they live in the relay (S3) and open at `/production`.
//! These two routes bridge the two, and do nothing else. The spin-off itself
//! (what is carried, the decisions, the tenant check) is the host's:
//! `napkin_host::library::spinoff_change_as` and `spinoff_change_from`.
//!
//! * `POST /api/t/{tenant}/spinoff/production`, body `{doc, title?}`: a brief
//!   of the library becomes a new Production project. The new `.clan` is not
//!   written to the library; its bytes go to the relay's `POST /clan` under a
//!   fresh project id, through the caller's signed identity.
//! * `POST /api/t/{tenant}/production/{project}/spinoff`, body
//!   `{target_app_id, title?}`: a saved Production project becomes a new
//!   document of another app (the Deck Maker). It is read from the relay
//!   through the caller's signed identity (a project of another agency is not
//!   found there), its canvas checkpoint is dropped, and the result is written
//!   to the library with the source named `production:<project>@<etag>`.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::routing::post;
use axum::{Extension, Json, Router};
use clan_sdk::{ClanBuilder, ClanFile};
use napkin_host::{library, DocId, Document, HostError};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::Account;
use crate::error::{ApiError, ApiResult};
use crate::production::{Relay, Unreached};
use crate::state::AppCtx;
use crate::tenant::{Acting, Tenant};

/// The Production app's id: the target of a brief's Continue in, the source of a deck's.
pub const PRODUCTION_APP_ID: &str = "ie.napkin.production";
/// The canvas checkpoint (features/engine-store.clan): the scene of one project, not something to carry.
const CHECKPOINT: &str = "human/assets/canvas.ybin.zst";
/// The relay's project id (`PROJECT_ID`, production-tool/relay/service.py).
const ID_PREFIX: &str = "prj";

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/t/{tenant}/spinoff/production", post(brief_to_production))
        .route(
            "/t/{tenant}/production/{project}/spinoff",
            post(production_to_app),
        )
}

#[derive(Deserialize)]
struct ToProduction {
    /// The library document to spin off (a brief): its id, as `path` in the library.
    doc: String,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize)]
struct FromProduction {
    target_app_id: String,
    #[serde(default)]
    title: Option<String>,
}

/// The relay and who is asking, or why neither is here: the tool is mounted
/// only with accounts and `NAPKIN_PRODUCTION_RELAY_URL`.
fn bridge(
    relay: Option<Extension<Arc<Relay>>>,
    account: Option<Extension<Account>>,
) -> ApiResult<(Arc<Relay>, Account)> {
    match (relay, account) {
        (Some(Extension(r)), Some(Extension(a))) => Ok((r, a)),
        _ => Err(ApiError::new(
            404,
            "Production is not served here: it needs sign-in and a relay.",
        )),
    }
}

fn unreached(e: Unreached) -> ApiError {
    match e {
        Unreached::Timeout => ApiError::new(504, "The Production Tool took too long to answer."),
        Unreached::Down => ApiError::new(502, "The Production Tool could not be reached."),
    }
}

/// A brief becomes a Production project in the relay.
async fn brief_to_production(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    relay: Option<Extension<Arc<Relay>>>,
    account: Option<Extension<Account>>,
    Json(body): Json<ToProduction>,
) -> ApiResult<Json<Value>> {
    let (relay, account) = bridge(relay, account)?;
    let ws = ctx.workspace(&tenant);
    let id = DocId::new(body.doc);
    let source = Document::from_bytes(id.clone(), ws.store.read(&id)?)
        .map_err(|e| HostError::new(e.status, format!("source document: {e}")))?;
    // The host builds it: what is carried, the decisions, a source in another workspace refused (403).
    let change = library::spinoff_change_as(
        &*ws.store,
        &acting,
        &source,
        PRODUCTION_APP_ID,
        body.title,
        None,
    )?;
    // Whose it is, said in the document itself: the relay keeps tenants apart by where it stores a
    // project, and a project that is later spun off again is checked against this too.
    let bytes = library::stamp_tenant(&acting, change.bytes)?;
    let clan = ClanFile::from_bytes(bytes.clone()).map_err(HostError::from)?;
    // The project is kept in the relay, outside the library the sweep reads:
    // pin the files it links to, so clearing unused ones never takes them.
    if let Some(blobs) = ws.store.blobs() {
        for f in clan.manifest().files.iter().filter(|f| f.linked) {
            if let Some(sha) = &f.sha256 {
                blobs.pin(sha)?;
            }
        }
    }
    let name = clan.manifest().title.clone();
    let project = new_project_id();
    let answer = relay
        .call(
            &account,
            Method::POST,
            "/clan",
            &[
                ("content-type", "application/vnd.clan+zip".into()),
                ("x-clan-reason", "manual".into()),
                ("x-project-id", project.clone()),
                ("x-project-name", percent_encode(&name)),
            ],
            bytes,
        )
        .await
        .map_err(unreached)?;
    if !answer.status.is_success() {
        return Err(relay_refused(answer.status, "keep the project"));
    }
    Ok(Json(json!({
        "ok": true,
        "project": project,
        "title": name,
        // where the shell opens it: the tool's own route, not a library document
        "path": format!("/production/p/{project}"),
        "etag": answer.etag,
    })))
}

/// A saved Production project becomes a document of another app in the library.
async fn production_to_app(
    State(ctx): State<Arc<AppCtx>>,
    Acting(acting): Acting,
    Tenant(tenant): Tenant,
    relay: Option<Extension<Arc<Relay>>>,
    account: Option<Extension<Account>>,
    Path((_t, project)): Path<(String, String)>,
    Json(body): Json<FromProduction>,
) -> ApiResult<Json<Value>> {
    let (relay, account) = bridge(relay, account)?;
    if !is_project_id(&project) {
        return Err(ApiError::new(404, "That is not a Production project."));
    }
    if body.target_app_id == PRODUCTION_APP_ID {
        return Err(ApiError::new(
            422,
            "A project is not spun off into Production again.",
        ));
    }
    let answer = relay
        .call(
            &account,
            Method::GET,
            &format!("/clan/{project}"),
            &[],
            Vec::new(),
        )
        .await
        .map_err(unreached)?;
    // The relay reads under the caller's own workspace: another agency's project is not found there.
    if !answer.status.is_success() {
        return Err(relay_refused(answer.status, "read the project"));
    }
    let etag = answer.etag.unwrap_or_default();
    let source = ClanFile::from_bytes(answer.body.to_vec())
        .map_err(|e| ApiError::new(502, format!("the project is not a readable .clan: {e}")))?;
    let source = without_checkpoint(&source)?;
    let uri = format!("production:{project}@{etag}");
    let source = Document::from_bytes(DocId::new(format!("production-{project}")), source)
        .map_err(|e| HostError::new(e.status, format!("source project: {e}")))?;
    let ws = ctx.workspace(&tenant);
    let change = library::spinoff_change_from(
        &*ws.store,
        &acting,
        &source,
        &body.target_app_id,
        body.title,
        None,
        uri.clone(),
    )?;
    let doc = change.doc.clone();
    ws.store.apply(&change)?;
    Ok(Json(
        json!({ "ok": true, "path": doc.to_string(), "source_uri": uri }),
    ))
}

/// What the relay said when it would not do it, in words a person can use.
fn relay_refused(status: StatusCode, what: &str) -> ApiError {
    match status {
        StatusCode::NOT_FOUND => ApiError::new(404, "That project is not in your workspace."),
        StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED => ApiError::new(
            403,
            format!("Production would not {what}: this account may not use it."),
        ),
        StatusCode::PAYLOAD_TOO_LARGE => {
            ApiError::new(413, format!("The project is too large to {what}."))
        }
        other => ApiError::new(
            502,
            format!("The Production Tool could not {what} (it answered {other})."),
        ),
    }
}

/// The project as a source: its whole archive less the canvas checkpoint (the scene is
/// a binary of one project, 4 to 12 MB, and nothing downstream reads it).
fn without_checkpoint(clan: &ClanFile) -> ApiResult<Vec<u8>> {
    if !clan.has_entry(CHECKPOINT) {
        return Ok(clan.raw_bytes().to_vec());
    }
    let mut manifest = clan.manifest().clone();
    manifest.files.retain(|f| f.path != CHECKPOINT);
    let mut b = ClanBuilder::new(manifest);
    for (path, bytes) in clan.read_all_entries().map_err(HostError::from)? {
        if path == clan_sdk::MANIFEST_PATH || path == CHECKPOINT {
            continue;
        }
        b.add_entry(path, bytes);
    }
    Ok(b.build().map_err(HostError::from)?)
}

/// `^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$`: a prefixed ULID, as the tool makes its own (`newUlidId`).
fn is_project_id(s: &str) -> bool {
    let Some((prefix, tail)) = s.split_once('_') else {
        return false;
    };
    !prefix.is_empty()
        && prefix.bytes().all(|b| b.is_ascii_lowercase())
        && tail.len() == 26
        && tail.bytes().all(|b| CROCKFORD.contains(&b))
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A new project id: 48 bits of time and 80 of randomness, Crockford base32.
fn new_project_id() -> String {
    let mut ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let mut time = [0u8; 10];
    for slot in time.iter_mut().rev() {
        *slot = CROCKFORD[(ms % 32) as usize];
        ms /= 32;
    }
    let random = uuid::Uuid::new_v4();
    let tail: String = random
        .as_bytes()
        .iter()
        .map(|b| CROCKFORD[(*b % 32) as usize] as char)
        .collect();
    format!(
        "{ID_PREFIX}_{}{tail}",
        std::str::from_utf8(&time).expect("ascii")
    )
}

/// `encodeURIComponent` for the relay's `X-Project-Name`.
fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.chars().take(80).collect::<String>().bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_made_project_id_is_one_the_relay_accepts() {
        for _ in 0..50 {
            assert!(is_project_id(&new_project_id()));
        }
        let a = new_project_id();
        assert_ne!(a, new_project_id());
        assert!(!is_project_id("prj_short"));
        assert!(!is_project_id("../etc"));
        assert!(!is_project_id("PRJ_01H00000000000000000000000"));
    }

    #[test]
    fn a_name_travels_percent_encoded() {
        assert_eq!(percent_encode("Lumen Water"), "Lumen%20Water");
        assert_eq!(percent_encode("é"), "%C3%A9");
    }
}
