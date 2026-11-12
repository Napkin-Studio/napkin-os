// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/one-bar-search.clan: the search handler logs counts and milliseconds, never what was typed, and a
//! document written a moment ago is found by the next search. Alone in its own test binary, so no other test's
//! tracing callsites decide what this one's subscriber hears.

use std::io::Write;
use std::sync::{Arc, Mutex};

use napkin_web::store::TenantStore;
use napkin_web::tenant::TenantId;

mod search_support;
use search_support::*;

#[derive(Clone)]
struct Sink(Arc<Mutex<Vec<u8>>>);

impl Write for Sink {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn a_document_written_is_found_at_once_and_the_log_never_holds_what_was_typed() {
    let log = Sink(Arc::new(Mutex::new(Vec::new())));
    let sink = log.clone();
    let _guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || sink.clone())
            .finish(),
    );
    let r = rig();
    let client = seed(r.dir.path(), "wk");
    let p = sign_in(&r, "planning@wk").await;
    let (_, ids, _, _) = search(&r, &p, "alpha").await;
    assert!(!ids.is_empty());
    // a new brief, written straight after a search, is found by the next
    let store = TenantStore::new(r.dir.path().join(TenantId::of_agency("wk").as_str()));
    put(
        &store,
        &Doc {
            slug: "late",
            title: "Zeppelin brief",
            app_id: "ie.napkin.brief-maker",
            app_name: "Brief Maker",
            document_type: None,
            client: &client,
            job: Some("J001"),
            updated: "2026-03-14T10:00:00Z",
            editors: &[],
            assets: &[],
            data: "a: b\n",
        },
    );
    let (_, ids, _, _) = search(&r, &p, "QXMARKERQUERY").await;
    assert!(ids.is_empty());
    let (_, ids, _, _) = search(&r, &p, "zeppelin").await;
    assert_eq!(
        ids,
        ["doc-late"],
        "a document written a moment ago is found"
    );
    let text = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
    assert!(
        text.contains("napkin_web::search"),
        "the handler logs its counts: {text}"
    );
    assert!(text.contains("ms="), "{text}");
    assert!(
        !text.to_lowercase().contains("qxmarkerquery") && !text.to_lowercase().contains("zeppelin"),
        "the log holds what was typed: {text}"
    );
}
