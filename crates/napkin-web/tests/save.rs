// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Stage 0 of production-in-library: the version check on every write, the
//! whole-document save, the trash, `media_base` (TEST-PLAN S0-1 to S0-4, S0-6,
//! S0-8 (unit half), S0-9, S0-11). The store is the real `TenantStore` on a
//! temp directory, never one that cannot refuse a write.

mod support;

use axum::http::StatusCode;
use napkin_host::{Base, Change, DocId, HostError, PartStore, Version};
use napkin_web::store::{doc_id, TenantStore};
use support::big_doc::{self, PRODUCTION};
use support::server::*;

fn prod_bytes(s: &Server, p: &Person, doc: &str) -> Vec<u8> {
    let ws = s.ctx.workspace(&p.tenant);
    ws.store.read(&DocId::new(doc)).unwrap()
}

// ── S0-1 ─────────────────────────────────────────────────────────────────────

#[test]
fn s0_1_the_second_writer_from_one_version_is_refused_and_the_first_stands() {
    let dir = tempfile::tempdir().unwrap();
    let s = TenantStore::new(dir.path().join("t"));
    let id = doc_id("x");
    let v1 = s
        .apply(&Change::create(id.clone(), b"v1".to_vec()))
        .unwrap();
    assert_eq!(v1, Version::of_archive(b"v1"));

    let a = s
        .apply(&Change::replace(id.clone(), v1.clone(), b"first".to_vec()))
        .unwrap();
    let e: HostError = s
        .apply(&Change::replace(id.clone(), v1.clone(), b"second".to_vec()))
        .unwrap_err();
    assert_eq!(e.status, 409);
    assert_eq!(
        e.latest.as_deref(),
        Some(a.as_str()),
        "the loser is told the winner"
    );
    assert_eq!(s.read(&id).unwrap(), b"first");

    // creating over an existing document is a conflict too
    let e = s
        .apply(&Change::create(id.clone(), b"again".to_vec()))
        .unwrap_err();
    assert_eq!(e.status, 409);
    assert_eq!(s.read(&id).unwrap(), b"first");
    // updating what does not exist never creates it
    let e = s
        .apply(&Change::replace(doc_id("nope"), v1, b"z".to_vec()))
        .unwrap_err();
    assert_eq!(e.status, 404);
    assert!(!s.exists(&doc_id("nope")));
}

#[test]
fn s0_1_racing_writers_from_one_version_have_exactly_one_winner() {
    let dir = tempfile::tempdir().unwrap();
    let s = std::sync::Arc::new(TenantStore::new(dir.path().join("t")));
    let id = doc_id("race");
    let v1 = s
        .apply(&Change::create(id.clone(), b"v1".to_vec()))
        .unwrap();
    let wins: usize = (0..16)
        .map(|i| {
            let (s, id, v1) = (s.clone(), id.clone(), v1.clone());
            std::thread::spawn(move || {
                s.apply(&Change {
                    base: Base::At(v1),
                    ..Change::create(id, format!("w{i}").into_bytes())
                })
                .is_ok()
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|h| usize::from(h.join().unwrap()))
        .sum();
    assert_eq!(wins, 1);
}

// ── S0-8 (unit half) ─────────────────────────────────────────────────────────

#[test]
fn s0_8_a_write_leaves_no_temp_file_and_a_leftover_one_is_never_listed() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("t");
    let s = TenantStore::new(root.clone());
    let id = doc_id("a");
    s.apply(&Change::create(id.clone(), b"bytes".to_vec()))
        .unwrap();
    let docs = root.join("documents");
    let names = |d: &std::path::Path| {
        let mut v: Vec<String> = std::fs::read_dir(d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        v.sort();
        v
    };
    assert_eq!(
        names(&docs),
        vec!["a.clan"],
        "the temp file was renamed away"
    );

    // what a crash between create and rename leaves
    std::fs::write(docs.join(".b.clan.1-1.tmp"), b"half").unwrap();
    std::fs::write(docs.join("c.clan.tmp"), b"half").unwrap();
    use napkin_host::Library;
    assert_eq!(s.documents(), vec![id.clone()]);
    // and it does not stop the next write
    let v = s.version(&id).unwrap();
    s.apply(&Change::replace(id, v, b"next".to_vec())).unwrap();
}

// ── S0-2, S0-3 ───────────────────────────────────────────────────────────────

/// A Production project in `p`'s library, and its current bytes and version.
fn project(s: &Server, p: &Person) -> (String, Vec<u8>, String) {
    let doc = instance(s, p, PRODUCTION, "Hollow Oak");
    let bytes = prod_bytes(s, p, &doc);
    let v = version_of(&bytes);
    (doc, bytes, v)
}

#[tokio::test]
async fn s0_2_a_whole_save_names_the_sha256_and_the_download_agrees() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let (doc, bytes, v0) = project(&s, &me);
    let (_, etag) = me.download(&s, &doc).await;
    assert_eq!(etag.as_deref(), Some(format!("\"{v0}\"").as_str()));

    let edited = big_doc::with_entry(&bytes, "shared/data.yaml", b"marker: saved\n".to_vec());
    let r = me.save(&s, &doc, &v0, &edited, None).await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    let j = r.json();
    let v1 = version_of(&edited);
    assert_eq!(j["version"], v1);
    assert!(j["snapshot"].is_boolean());
    assert!(chrono::DateTime::parse_from_rfc3339(j["saved_at"].as_str().unwrap()).is_ok());
    assert_eq!(r.header("etag"), Some(format!("\"{v1}\"")));

    let data = me.get(&s, &format!("/d/{doc}/data")).await.json();
    assert_eq!(data["data"]["marker"], "saved");
    let (got, etag) = me.download(&s, &doc).await;
    assert!(got == edited, "download is the saved bytes");
    assert_eq!(etag, Some(format!("\"{v1}\"")));
    let r = me.get(&s, &format!("/d/{doc}/download")).await;
    assert!(r.header("x-saved-at").is_some());
}

#[tokio::test]
async fn s0_3_two_saves_from_one_version_the_second_loses_and_learns_the_winner() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let (doc, bytes, v0) = project(&s, &me);
    let a = big_doc::with_entry(&bytes, "shared/data.yaml", b"who: a\n".to_vec());
    let b = big_doc::with_entry(&bytes, "shared/data.yaml", b"who: b\n".to_vec());
    assert_eq!(
        me.save(&s, &doc, &v0, &a, None).await.status,
        StatusCode::OK
    );
    let lost = me.save(&s, &doc, &v0, &b, None).await;
    assert_eq!(lost.status, StatusCode::CONFLICT);
    let j = lost.json();
    assert_eq!(j["error"]["code"], "conflict");
    assert_eq!(
        j["error"]["message"],
        "This project was saved from somewhere else since you opened it."
    );
    assert_eq!(j["latest"], version_of(&a));
    assert!(
        me.download(&s, &doc).await.0 == a,
        "nothing was overwritten"
    );
}

// ── S0-4 ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn s0_4_the_save_route_refuses_what_it_must() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let other = sign_in(&s, "planner", "javelin").await;
    let (doc, bytes, v0) = project(&s, &me);
    let ok = big_doc::with_entry(&bytes, "shared/data.yaml", b"a: 1\n".to_vec());

    // no If-Match
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "PUT",
        &format!("/d/{doc}/save"),
        &[],
        ok.clone(),
    )
    .await;
    assert_eq!(r.status.as_u16(), 428);

    // a document of another app
    let brief = instance(&s, &me, "ie.napkin.brief-maker", "A brief");
    let bb = prod_bytes(&s, &me, &brief);
    let r = me.save(&s, &brief, &version_of(&bb), &bb, None).await;
    assert_eq!(r.status.as_u16(), 422, "another app's document");

    // a template is not an instance
    let tpl = "app-ie.napkin.production";
    let tb = prod_bytes(&s, &me, tpl);
    let r = me.save(&s, tpl, &version_of(&tb), &tb, None).await;
    assert_eq!(r.status.as_u16(), 422, "a template");

    // an archive of another project (its identity is not this document's)
    let second = instance(&s, &me, PRODUCTION, "Second");
    let sb = prod_bytes(&s, &me, &second);
    let r = me.save(&s, &doc, &v0, &sb, None).await;
    assert_eq!(r.status.as_u16(), 422, "another project's bytes");

    // unreadable bytes
    let r = me.save(&s, &doc, &v0, b"not a zip", None).await;
    assert_eq!(r.status.as_u16(), 400);

    // an unknown reason
    let r = me.save(&s, &doc, &v0, &ok, Some("whenever")).await;
    assert_eq!(r.status.as_u16(), 400);

    // over 32 MiB
    let huge = vec![0u8; 32 * 1024 * 1024 + 1];
    let r = me.save(&s, &doc, &v0, &huge, None).await;
    assert_eq!(r.status.as_u16(), 413);

    // no session
    let r = call(
        &s,
        None,
        &me.tenant,
        "PUT",
        &format!("/d/{doc}/save"),
        &[("if-match", format!("\"{v0}\""))],
        ok.clone(),
    )
    .await;
    assert_eq!(r.status.as_u16(), 401);

    // another tenant's document: through its own path it does not exist (404);
    // through the owner's path the session does not match (never a write)
    let r = other.save(&s, &doc, &v0, &ok, None).await;
    assert_eq!(r.status.as_u16(), 404);
    let r = call(
        &s,
        Some(&other),
        &me.tenant,
        "PUT",
        &format!("/d/{doc}/save"),
        &[("if-match", format!("\"{v0}\""))],
        ok.clone(),
    )
    .await;
    assert!(r.status.is_client_error() && r.status != StatusCode::OK);

    // a missing document
    let r = me.save(&s, "doc-missing", &v0, &ok, None).await;
    assert_eq!(r.status.as_u16(), 404);

    // none of that changed the stored document
    assert!(me.download(&s, &doc).await.0 == bytes);
}

// ── S0-6 ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn s0_6_an_open_session_sees_the_save_and_the_event_goes_out() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let (doc, bytes, v0) = project(&s, &me);
    // a tab has the document open: its session is cached
    let ws = s.ctx.workspace(&me.tenant);
    let session = ws.open(&DocId::new(doc.clone())).unwrap().0;
    assert_eq!(session.current_version().unwrap().as_str(), v0);
    let mut events = s.ctx.events.subscribe(&me.tenant);

    let edited = big_doc::with_entry(&bytes, "shared/data.yaml", b"marker: fresh\n".to_vec());
    assert_eq!(
        me.save(&s, &doc, &v0, &edited, None).await.status,
        StatusCode::OK
    );

    let data = me.get(&s, &format!("/d/{doc}/data")).await.json();
    assert_eq!(data["data"]["marker"], "fresh", "no stale cache");
    let ev = events.try_recv().expect("clan-data-changed was published");
    assert_eq!(ev.name, "clan-data-changed");
    assert_eq!(ev.data["version"], version_of(&edited));
    assert_eq!(ev.data["path"], doc);

    // and a write through that same session is based on the new version
    session
        .set_title_as(ws_ctx(&me), "Renamed after a save")
        .expect("no 409 after a whole-document save");
}

fn ws_ctx(p: &Person) -> &'static napkin_host::Ctx {
    Box::leak(Box::new(p.tenant.ctx()))
}

// ── S0-9 ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn s0_9_the_session_says_where_pictures_live() {
    let with = server_in(
        tempfile::tempdir().unwrap(),
        Some("https://media.example.com/m/"),
    );
    let me = sign_in(&with, "visionary", "napkin").await;
    let j = call(&with, Some(&me), &me.tenant, "GET", "", &[], vec![]).await;
    let _ = j;
    let r = send(
        &with,
        axum::http::Request::builder()
            .uri("/api/session")
            .header("cookie", &me.cookie)
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(r.json()["media_base"], "https://media.example.com/m/");

    let without = server();
    let me = sign_in(&without, "visionary", "napkin").await;
    let r = send(
        &without,
        axum::http::Request::builder()
            .uri("/api/session")
            .header("cookie", &me.cookie)
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await;
    let j = r.json();
    assert!(j.as_object().unwrap().contains_key("media_base"));
    assert!(j["media_base"].is_null());
}

// ── S0-11 ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn s0_11_two_writes_in_a_row_from_one_session_never_409_in_any_app() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let ws = s.ctx.workspace(&me.tenant);
    for (app, _) in APPS {
        let doc = DocId::new(instance(&s, &me, app, "T"));
        let session = ws.open(&doc).unwrap().0;
        let ctx = me.tenant.ctx();
        session
            .set_title_as(&ctx, "one")
            .unwrap_or_else(|e| panic!("{app}: {e}"));
        session
            .set_title_as(&ctx, "two")
            .unwrap_or_else(|e| panic!("{app}: {e}"));
        // a reopen (another tab) and one more
        let session = ws.open(&doc).unwrap().0;
        session
            .set_title_as(&ctx, "three")
            .unwrap_or_else(|e| panic!("{app}: {e}"));
    }
}

/// Every place the crates write through `PartStore::apply`, and the base it
/// states. A new caller fails this test on purpose: read it, give it the
/// version it read (or `Base::Absent` for a new document), then add it here.
#[test]
fn s0_11_every_apply_caller_is_listed_with_its_base() {
    let crates = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut found: Vec<(String, usize, usize, usize)> = Vec::new();
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    for c in ["napkin-host", "napkin-web", "napkin-wasm"] {
        let mut files = Vec::new();
        walk(&crates.join(c).join("src"), &mut files);
        files.sort();
        for f in files {
            let text = std::fs::read_to_string(&f).unwrap();
            // production code only: stop at the test module
            let code = text.split("#[cfg(test)]").next().unwrap();
            let n = |pat: &str| code.matches(pat).count();
            let (create, replace, at) =
                (n("Change::create("), n("Change::replace("), n("Base::At("));
            if create + replace + at > 0 {
                let name = f.strip_prefix(&crates).unwrap().display().to_string();
                found.push((name, create, replace, at));
            }
        }
    }
    let expect = [
        // (file, Change::create = Base::Absent, Change::replace = Base::At(read version), Base::At)
        ("napkin-host/src/brand_clan/mod.rs", 1, 0, 0),
        ("napkin-host/src/clients.rs", 1, 2, 0),
        ("napkin-host/src/document.rs", 0, 0, 3),
        ("napkin-host/src/library.rs", 4, 1, 0),
        ("napkin-host/src/ops/edit.rs", 1, 0, 0),
        ("napkin-web/src/api.rs", 1, 0, 0),
        ("napkin-web/src/save.rs", 0, 1, 0),
        ("napkin-web/src/store.rs", 0, 0, 3),
        ("napkin-wasm/src/lib.rs", 1, 1, 0),
    ];
    let expect: Vec<_> = expect
        .iter()
        .filter(|e| e.1 + e.2 + e.3 > 0)
        .map(|(f, a, b, c)| (f.to_string(), *a, *b, *c))
        .collect();
    assert_eq!(
        found, expect,
        "a writer was added or changed: check its Base"
    );
}

// ── Trash (owner decision 2026-11-23) ────────────────────────────────────────

#[tokio::test]
async fn delete_hides_the_project_from_the_library_and_restore_brings_it_back() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let (doc, bytes, _) = project(&s, &me);
    let listed = |j: &serde_json::Value| {
        j["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["path"] == doc)
    };
    assert!(listed(&me.get(&s, "/library").await.json()));

    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "DELETE",
        &format!("/d/{doc}"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert_eq!(r.json()["trashed"], true);
    assert!(
        chrono::DateTime::parse_from_rfc3339(r.json()["restorable_until"].as_str().unwrap())
            .is_ok()
    );
    assert!(
        !listed(&me.get(&s, "/library").await.json()),
        "hidden from the library"
    );
    assert_eq!(
        me.get(&s, &format!("/d/{doc}")).await.status,
        StatusCode::NOT_FOUND
    );
    let t = me.get(&s, "/trash").await.json();
    assert_eq!(t[0]["path"], doc);
    // a second delete is a 404, a save into the trash is a 404
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "DELETE",
        &format!("/d/{doc}"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(
        me.save(&s, &doc, &version_of(&bytes), &bytes, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );

    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        &format!("/d/{doc}/restore"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(
        listed(&me.get(&s, "/library").await.json()),
        "back in the library"
    );
    assert!(me.download(&s, &doc).await.0 == bytes, "the same bytes");
    assert!(me
        .get(&s, "/trash")
        .await
        .json()
        .as_array()
        .unwrap()
        .is_empty());
    // nothing to restore twice
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        &format!("/d/{doc}/restore"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_app_template_is_never_deleted() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "DELETE",
        "/d/app-ie.napkin.production",
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn purge_is_a_dry_run_by_default_admin_only_and_keeps_the_last_30_days() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let admin = sign_in(&s, "engineer", "napkin").await;
    let (old, _, _) = project(&s, &me);
    let (fresh, _, _) = project(&s, &me);
    for d in [&old, &fresh] {
        let r = call(
            &s,
            Some(&me),
            &me.tenant,
            "DELETE",
            &format!("/d/{d}"),
            &[],
            vec![],
        )
        .await;
        assert_eq!(r.status, StatusCode::OK);
    }
    // age the first by 31 days: the trashed file's name carries the time
    let trash = s
        .dir
        .path()
        .join("data")
        .join(me.tenant.as_str())
        .join("trash");
    let slug = old.strip_prefix("doc-").unwrap();
    let file = std::fs::read_dir(&trash)
        .unwrap()
        .flatten()
        .find(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with(&format!("-{slug}.clan"))
        })
        .unwrap()
        .path();
    let ms: u128 = file
        .file_name()
        .unwrap()
        .to_string_lossy()
        .split('-')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let aged = ms - 31 * 24 * 3600 * 1000;
    std::fs::rename(&file, trash.join(format!("{aged}-{slug}.clan"))).unwrap();
    // its note carries the same time
    std::fs::rename(
        file.with_extension("json"),
        trash.join(format!("{aged}-{slug}.json")),
    )
    .unwrap();
    let clans = || {
        std::fs::read_dir(&trash)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".clan"))
            .count()
    };

    // not for a person who is not an admin
    let r = me
        .json(
            &s,
            "POST",
            "/trash/purge",
            serde_json::json!({ "dry_run": false }),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // dry run is the default and removes nothing
    let r = admin
        .json(&s, "POST", "/trash/purge", serde_json::json!({}))
        .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    assert_eq!(r.json()["dry_run"], true);
    assert_eq!(r.json()["purged"], serde_json::json!([old]));
    assert_eq!(clans(), 2);

    let r = admin
        .json(
            &s,
            "POST",
            "/trash/purge",
            serde_json::json!({ "dry_run": false }),
        )
        .await;
    assert_eq!(r.json()["purged"], serde_json::json!([old]));
    assert!(
        !trash.join(format!("{aged}-{slug}.json")).exists(),
        "a purged document's note goes with it"
    );
    let left: Vec<String> = me
        .get(&s, "/trash")
        .await
        .json()
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["path"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        left,
        vec![fresh.clone()],
        "only the one inside 30 days is kept"
    );
    // the aged one cannot come back
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        &format!("/d/{old}/restore"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn another_agency_cannot_delete_restore_or_purge_a_project() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let other = sign_in(&s, "planner", "javelin").await;
    let (doc, bytes, _) = project(&s, &me);

    // through its own path the document does not exist in the other tenant
    let r = call(
        &s,
        Some(&other),
        &other.tenant,
        "DELETE",
        &format!("/d/{doc}"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    // through the owner's path the session does not match
    let r = call(
        &s,
        Some(&other),
        &me.tenant,
        "DELETE",
        &format!("/d/{doc}"),
        &[],
        vec![],
    )
    .await;
    assert!(r.status.is_client_error());
    assert!(me.download(&s, &doc).await.0 == bytes, "still there");

    // trash it as the owner; the other agency cannot restore it
    call(
        &s,
        Some(&me),
        &me.tenant,
        "DELETE",
        &format!("/d/{doc}"),
        &[],
        vec![],
    )
    .await;
    let r = call(
        &s,
        Some(&other),
        &other.tenant,
        "POST",
        &format!("/d/{doc}/restore"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let r = call(
        &s,
        Some(&other),
        &me.tenant,
        "POST",
        &format!("/d/{doc}/restore"),
        &[],
        vec![],
    )
    .await;
    assert!(r.status.is_client_error());
    assert!(other
        .get(&s, "/trash")
        .await
        .json()
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        me.get(&s, "/trash").await.json().as_array().unwrap().len(),
        1
    );
}

// ── Copies and imports ───────────────────────────────────────────────────────

/// A document made by upload keeps the source's `manifest.document_id`. The
/// save rule compares what is sent with the STORED bytes' identity (never a
/// library key), so a copy or an import saves on its first try, and the copy
/// is a separate library document with its own version and its own file.
#[tokio::test]
async fn a_copy_or_import_saves_on_its_first_try_and_stays_its_own_document() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let (src, bytes, _) = project(&s, &me);

    let up = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        "/documents/upload",
        &[("content-type", "application/vnd.clan+zip".into())],
        bytes.clone(),
    )
    .await;
    assert_eq!(
        up.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&up.body)
    );
    let copy = up.json()["path"].as_str().unwrap().to_string();
    assert_ne!(copy, src);

    let (got, etag) = me.download(&s, &copy).await;
    let v = etag.unwrap().trim_matches('"').to_string();
    assert_eq!(v, version_of(&got));
    let edited = big_doc::with_entry(&got, "shared/data.yaml", b"edited: copy\n".to_vec());
    let r = me.save(&s, &copy, &v, &edited, None).await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );

    // the source is untouched, and the copy has its own version and identity
    assert!(me.download(&s, &src).await.0 == bytes);
    assert!(me.download(&s, &copy).await.0 == edited);
    let id_of = |b: &[u8]| {
        clan_sdk::ClanFile::from_bytes(b.to_vec())
            .unwrap()
            .document_id()
            .to_string()
    };
    assert_ne!(
        id_of(&bytes),
        id_of(&edited),
        "a copy is a distinct document"
    );
    // neither takes the other's bytes
    let r = me.save(&s, &src, &version_of(&bytes), &edited, None).await;
    assert_eq!(
        r.status.as_u16(),
        422,
        "the copy's bytes are not the source's"
    );
    let r = me.save(&s, &copy, &version_of(&edited), &bytes, None).await;
    assert_eq!(
        r.status.as_u16(),
        422,
        "the source's bytes are not the copy's"
    );

    // another app's upload keeps its identity (spin-offs address it)
    let brief = instance(&s, &me, "ie.napkin.brief-maker", "B");
    let bb = prod_bytes(&s, &me, &brief);
    let up = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        "/documents/upload",
        &[],
        bb.clone(),
    )
    .await;
    let path = up.json()["path"].as_str().unwrap().to_string();
    assert_eq!(id_of(&me.download(&s, &path).await.0), id_of(&bb));
}

// ── HEAD on download ─────────────────────────────────────────────────────────

#[tokio::test]
async fn head_on_download_names_the_version_and_time_with_no_body() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let (doc, bytes, v0) = project(&s, &me);
    let head = call(
        &s,
        Some(&me),
        &me.tenant,
        "HEAD",
        &format!("/d/{doc}/download"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(head.status, StatusCode::OK);
    assert!(head.body.is_empty());
    let get = me.get(&s, &format!("/d/{doc}/download")).await;
    assert_eq!(head.header("etag"), Some(format!("\"{v0}\"")));
    assert_eq!(head.header("etag"), get.header("etag"));
    assert_eq!(head.header("x-saved-at"), get.header("x-saved-at"));
    assert!(head.header("x-saved-at").is_some());
    let _ = bytes;
    // a missing document and no session behave as for GET
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "HEAD",
        "/d/doc-missing/download",
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let r = call(
        &s,
        None,
        &me.tenant,
        "HEAD",
        &format!("/d/{doc}/download"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
}

// ── Library trash: what the Trash page needs (features/library-trash) ───────

async fn make_client(s: &Server, p: &Person, name: &str) -> String {
    let r = p
        .json(s, "POST", "/clients", serde_json::json!({ "name": name }))
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    r.json()["id"].as_str().unwrap().to_string()
}

async fn make_doc(s: &Server, p: &Person, app: &str, title: &str, client: Option<&str>) -> String {
    let r = p
        .json(
            s,
            "POST",
            "/documents",
            serde_json::json!({ "app_id": app, "title": title, "client_id": client }),
        )
        .await;
    assert!(
        r.status.is_success(),
        "{}",
        String::from_utf8_lossy(&r.body)
    );
    r.json()["path"].as_str().unwrap().to_string()
}

async fn trash_it(s: &Server, p: &Person, doc: &str) {
    let r = call(
        s,
        Some(p),
        &p.tenant,
        "DELETE",
        &format!("/d/{doc}"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
}

#[tokio::test]
async fn trash_keeps_title_tool_client_and_who_and_filters_by_client() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let a = make_client(&s, &me, "Hollow Oak Cider").await;
    let b = make_client(&s, &me, "Stena").await;
    let d1 = make_doc(&s, &me, PRODUCTION, "Still life", Some(&a)).await;
    let d2 = make_doc(&s, &me, "ie.napkin.brief-maker", "Autumn brief", Some(&b)).await;
    let d3 = make_doc(&s, &me, "ie.napkin.deck-maker", "Loose deck", None).await;
    for d in [&d1, &d2, &d3] {
        trash_it(&s, &me, d).await;
    }

    let all = me.get(&s, "/trash").await.json();
    assert_eq!(all.as_array().unwrap().len(), 3);
    let row = |j: &serde_json::Value, d: &str| {
        j.as_array()
            .unwrap()
            .iter()
            .find(|r| r["path"] == d)
            .unwrap()
            .clone()
    };
    let r1 = row(&all, &d1);
    assert_eq!(r1["title"], "Still life");
    assert_eq!(r1["app_id"], PRODUCTION);
    assert_eq!(r1["client_id"], a);
    assert_eq!(
        r1["by"], "Laurance",
        "the signed-in person, by display name"
    );
    assert!(r1["restorable_until"].is_string() && r1["trashed_at"].is_string());
    assert!(row(&all, &d3)["client_id"].is_null());

    let only_a = me.get(&s, &format!("/trash?client={a}")).await.json();
    let paths: Vec<_> = only_a
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["path"].clone())
        .collect();
    assert_eq!(paths, vec![serde_json::json!(d1)]);
    let none = me.get(&s, "/trash?client=cl-nobody").await.json();
    assert!(none.as_array().unwrap().is_empty());

    // restore: back in the library, gone from the trash, its note with it
    let r = call(
        &s,
        Some(&me),
        &me.tenant,
        "POST",
        &format!("/d/{d2}/restore"),
        &[],
        vec![],
    )
    .await;
    assert_eq!(r.status, StatusCode::OK);
    let left = me.get(&s, "/trash").await.json();
    assert_eq!(left.as_array().unwrap().len(), 2);
    let dir = s
        .dir
        .path()
        .join("data")
        .join(me.tenant.as_str())
        .join("trash");
    let notes = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .count();
    assert_eq!(notes, 2, "a restored document leaves no note behind");
    // trash it again: listed with its details once more
    trash_it(&s, &me, &d2).await;
    let again = row(&me.get(&s, "/trash").await.json(), &d2);
    assert_eq!(again["title"], "Autumn brief");
    assert_eq!(again["client_id"], b);
}

#[tokio::test]
async fn trash_of_a_document_trashed_before_notes_still_lists() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let d = make_doc(&s, &me, "ie.napkin.brief-maker", "Old", None).await;
    trash_it(&s, &me, &d).await;
    let dir = s
        .dir
        .path()
        .join("data")
        .join(me.tenant.as_str())
        .join("trash");
    for e in std::fs::read_dir(&dir).unwrap().flatten() {
        if e.file_name().to_string_lossy().ends_with(".json") {
            std::fs::remove_file(e.path()).unwrap();
        }
    }
    let t = me.get(&s, "/trash").await.json();
    assert_eq!(t[0]["path"], d);
    assert!(t[0]["title"].is_null() && t[0]["by"].is_null());
}

// ── Rename a document that is not open (UAT round 4: the trash dialog and the Trash row disagreed) ──

#[tokio::test]
async fn a_rename_by_id_reaches_the_library_the_download_and_the_trash() {
    let s = server();
    let me = sign_in(&s, "visionary", "napkin").await;
    let doc = make_doc(&s, &me, PRODUCTION, "Copperell Refill", None).await;

    let r = me
        .json(
            &s,
            "POST",
            &format!("/d/{doc}/title"),
            serde_json::json!({ "title": "  Copperell Refill 2 " }),
        )
        .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body)
    );

    let lib = me.get(&s, "/library").await.json();
    let row = lib["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["path"] == doc)
        .unwrap()
        .clone();
    assert_eq!(
        row["title"], "Copperell Refill 2",
        "the library lists the new name"
    );

    let bytes = prod_bytes(&s, &me, &doc);
    let clan = clan_sdk::ClanFile::from_bytes(bytes).unwrap();
    assert_eq!(
        clan.manifest().title,
        "Copperell Refill 2",
        "the document itself carries it, so an export keeps it"
    );

    trash_it(&s, &me, &doc).await;
    let t = me.get(&s, "/trash").await.json();
    assert_eq!(
        t[0]["title"], "Copperell Refill 2",
        "the Trash row says what the dialog said"
    );

    // an empty name is refused (another agency reaches doc_session only for its own tenant)
    let other = make_doc(&s, &me, PRODUCTION, "Keep me", None).await;
    let r = me
        .json(
            &s,
            "POST",
            &format!("/d/{other}/title"),
            serde_json::json!({ "title": "   " }),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}
