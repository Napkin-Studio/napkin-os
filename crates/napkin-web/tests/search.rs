// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/one-bar-search.clan, through the real router: what each role finds is exactly the allow list
//! below (checked role by role and agency by agency), a result appears if and only if a GET of its own
//! route is not a 403, the total never counts what a person cannot open, two agencies never meet, people
//! are the directory's member view (no email, nobody removed), the index holds no document words, a
//! search is read-only and never logs what was typed, and an unchanged tenant is searched with no read.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::http::{header, StatusCode};
use napkin_host::jobindex::{IndexCache, JobIndex};
use napkin_host::jobs::{self, NewJob};
use napkin_host::searchindex::{self, SearchCache, SearchIndex};
use napkin_host::{
    clients, Actor, Change, Ctx, DocId, HostResult, Library, NoConfig, PartStore, Stamp, Version,
};
use napkin_web::state::AppCtx;
use napkin_web::store::{doc_id, TenantStore};
use napkin_web::tenant::TenantId;
use serde_json::json;

mod search_support;
use search_support::*;

fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// What each role may find of the seed: written out here by hand, kind by kind, apart from `roles.rs`, so
/// the two are held to each other. An allow list: a role not named for a kind does not find it.
fn expected(role: &str, with_people: bool) -> BTreeSet<String> {
    let money = ["producer", "account-service", "management", "traffic"];
    let brains = ["planning", "account-service", "agency-brain"];
    let everything = role == "admin" || role.is_empty();
    let mut out = set(&[
        "J001",
        "doc-alpha-brief",
        "doc-alpha-brief#logo-alpha.png",
        "doc-alpha-radio",
        "doc-alpha-ideas",
        "doc-alpha-research",
    ]);
    if everything || money.contains(&role) {
        out.insert("doc-alpha-scope".into());
    }
    if everything || brains.contains(&role) {
        out.insert("doc-alpha-client-brain".into());
    }
    if everything || role == "agency-brain" {
        out.insert("doc-alpha-agency-brain".into());
    }
    if with_people {
        for r in ROLES {
            out.insert(format!("{r}@cr"));
        }
    }
    out
}

/// The client's id is its registry id: take it from the answer, so the allow list names the entry.
fn with_client(mut want: BTreeSet<String>, client: &str) -> BTreeSet<String> {
    want.insert(client.to_string());
    want
}

async fn invite_everyone(r: &Rig) {
    let cara = sign_in(r, "cara@cr").await;
    for role in ROLES {
        let (st, body, _, _) = call(
            r,
            "POST",
            &format!("/api/t/{}/agency/people/invite", cara.tenant),
            Some(&cara.cookie),
            Some(json!({ "username": format!("{role}@cr"), "name": format!("Alpha {role}"), "email": format!("{role}@mail.example.test"), "roles": [role] })),
        )
        .await;
        assert_eq!(st, StatusCode::CREATED, "{body}");
    }
}

/// The index is found if and only if the route is not a 403: GET every result's own route and compare.
async fn check_agency(r: &Rig, agency: &str, with_people: bool, client: &str) {
    let mut roles: Vec<&str> = ROLES.to_vec();
    if !with_people {
        roles.push("");
    }
    for role in roles {
        let who = if role.is_empty() {
            "sam".to_string()
        } else {
            role.to_string()
        };
        let p = sign_in(r, &format!("{who}@{agency}")).await;
        let (st, ids, total, v) = search(r, &p, "alpha").await;
        assert_eq!(st, StatusCode::OK, "{agency} {role}");
        let want = with_client(expected(role, with_people), client);
        let got: BTreeSet<String> = ids.iter().cloned().collect();
        assert_eq!(got, want, "{agency} as {role:?}");
        assert_eq!(
            total,
            want.len(),
            "{agency} as {role:?}: the total counts what is shown and nothing hidden"
        );
        // found if and only if a GET of its own route is not 403
        let every = [
            "J001",
            "doc-alpha-brief",
            "doc-alpha-radio",
            "doc-alpha-ideas",
            "doc-alpha-research",
            "doc-alpha-scope",
            "doc-alpha-client-brain",
            "doc-alpha-agency-brain",
        ];
        for item in v["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["items"].as_array().unwrap())
        {
            let route = item["route"].as_str().unwrap();
            let (st, _, _, _) = call(
                r,
                "GET",
                &format!("/api/t/{}{route}", p.tenant),
                Some(&p.cookie),
                None,
            )
            .await;
            assert_ne!(
                st,
                StatusCode::FORBIDDEN,
                "{agency} {role:?} was shown {route} but cannot open it"
            );
        }
        // and the other way: what is not shown is a 403 (the routes the groups guard)
        for id in every {
            if got.contains(id) {
                continue;
            }
            let route = match id {
                "doc-alpha-scope" => "/jobs/J001/scope".to_string(),
                "doc-alpha-client-brain" => format!("/client-brains/{id}"),
                "doc-alpha-agency-brain" => format!("/proprietary/{id}"),
                other => panic!("{role:?} may open {other} and should find it"),
            };
            let (st, _, _, _) = call(
                r,
                "GET",
                &format!("/api/t/{}{route}", p.tenant),
                Some(&p.cookie),
                None,
            )
            .await;
            assert_eq!(
                st,
                StatusCode::FORBIDDEN,
                "{agency} {role:?} does not find {route}, so it must be refused"
            );
        }
    }
}

#[tokio::test]
async fn each_role_finds_exactly_its_allow_list_in_each_agency_and_a_result_opens_if_and_only_if_it_is_not_a_403(
) {
    let r = rig();
    let wk_client = seed(r.dir.path(), "wk");
    let cr_client = seed(r.dir.path(), "cr");
    invite_everyone(&r).await;
    check_agency(&r, "wk", false, &wk_client).await; // a roster agency, no people
    check_agency(&r, "cr", true, &cr_client).await; // an agency with a directory: its people too
}

#[tokio::test]
async fn two_agencies_never_meet_and_another_tenant_is_a_403() {
    let r = rig();
    seed(r.dir.path(), "wk");
    // a second agency holds a document of the same title, and nothing of J001
    let bq = TenantStore::new(r.dir.path().join(TenantId::of_agency("bq").as_str()));
    let me = Ctx::new(Actor::human("kai@bq").unwrap());
    let client = clients::create_client(&bq, &me, "Other Client", None).unwrap();
    put(
        &bq,
        &Doc {
            slug: "bq-brief",
            title: "Alpha brief",
            app_id: "ie.napkin.brief-maker",
            app_name: "Brief Maker",
            document_type: None,
            client: &client.id,
            job: None,
            updated: "2026-03-14T10:00:00Z",
            editors: &[],
            assets: &[],
            data: "a: b\n",
        },
    );
    let kai = sign_in(&r, "kai@bq").await;
    let cian = sign_in(&r, "account-service@wk").await;
    let (_, ids, total, _) = search(&r, &kai, "alpha").await;
    assert_eq!(
        ids,
        ["doc-bq-brief"],
        "kai finds his own agency's document only"
    );
    assert_eq!(total, 1);
    for q in ["J001", "alpha launch", "scope", "alpha scope", "logo-alpha"] {
        let (_, ids, total, _) = search(&r, &kai, q).await;
        assert!(!ids.iter().any(|i| i != "doc-bq-brief"), "{q}: {ids:?}");
        assert!(!ids.contains(&"J001".to_string()) && total <= 1, "{q}");
    }
    let (_, ids, _, _) = search(&r, &cian, "alpha").await;
    assert!(
        ids.contains(&"doc-alpha-brief".to_string()) && !ids.contains(&"doc-bq-brief".to_string())
    );
    // the tenant is the session's: naming the other agency's is refused by the tenant check
    let (st, _, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/search?q=alpha", cian.tenant),
        Some(&kai.cookie),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn people_are_the_directory_member_view_no_email_and_nobody_removed() {
    let r = rig();
    seed(r.dir.path(), "cr");
    invite_everyone(&r).await;
    let cara = sign_in(&r, "cara@cr").await;
    let (st, _, _, _) = call(
        &r,
        "DELETE",
        &format!("/api/t/{}/agency/people/traffic@cr", cara.tenant),
        Some(&cara.cookie),
        None,
    )
    .await;
    assert!(st.is_success(), "{st}");
    let dara = sign_in(&r, "creative-director@cr").await;
    let (_, ids, _, v) = search(&r, &dara, "alpha person").await;
    let want: BTreeSet<String> = ROLES
        .iter()
        .filter(|r| **r != "traffic")
        .map(|r| format!("{r}@cr"))
        .collect();
    assert_eq!(
        ids.iter().cloned().collect::<BTreeSet<_>>(),
        want,
        "the people of the agency, the removed one left out"
    );
    let (_, ids, _, v2) = search(&r, &dara, "people").await;
    assert!(ids.contains(&"planning@cr".to_string()) && ids.contains(&"cara@cr".to_string()));
    assert!(
        !ids.contains(&"traffic@cr".to_string()),
        "a removed person is left out"
    );
    let all = format!("{v}{v2}");
    assert!(
        !all.contains("mail.example.test") && !all.contains("email"),
        "never an email"
    );
    // a person is found by first name, and the card lists the jobs they own
    let (_, _, _, v) = search(&r, &dara, "planning").await;
    let p = v["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["kind"] == "person")
        .unwrap()["items"][0]
        .clone();
    assert_eq!(p["id"], json!("planning@cr"), "{v}");
    assert_eq!(p["jobs"], json!(["J001"]));
    // an agency with no directory returns no people
    seed(r.dir.path(), "wk");
    let wk = sign_in(&r, "planning@wk").await;
    let (_, ids, total, _) = search(&r, &wk, "people").await;
    assert_eq!((ids.len(), total), (0, 0));
}

#[tokio::test]
async fn a_search_is_read_only_and_anonymous_search_has_no_people() {
    let r = rig();
    seed(r.dir.path(), "wk");
    let p = sign_in(&r, "planning@wk").await;
    for m in ["POST", "PUT", "PATCH", "DELETE"] {
        let (st, _, _, _) = call(
            &r,
            m,
            &format!("/api/t/{}/search?q=alpha", p.tenant),
            Some(&p.cookie),
            Some(json!({})),
        )
        .await;
        assert_eq!(st, StatusCode::METHOD_NOT_ALLOWED, "{m}");
    }
    // no session at all is not served
    let (st, _, _, _) = call(
        &r,
        "GET",
        &format!("/api/t/{}/search?q=alpha", p.tenant),
        None,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    // an empty or hostile query answers nothing, not an error
    for q in ["", "%20%20", "%27%3B%20DROP%20TABLE", "%00%07"] {
        let (st, v, _, _) = call(
            &r,
            "GET",
            &format!("/api/t/{}/search?q={q}", p.tenant),
            Some(&p.cookie),
            None,
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{q}");
        assert_eq!(v["total"], json!(0), "{q}");
    }
}

#[tokio::test]
async fn an_anonymous_visitor_searches_their_own_workspace_and_finds_no_people() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Arc::new(AppCtx::new(
        dir.path().to_path_buf(),
        Arc::new(NoConfig),
        None,
        40,
    ));
    let app = napkin_web::router_with(
        ctx,
        None,
        Arc::new(napkin_web::tenant::Identity::anonymous(false)),
    );
    let r = Rig { dir, app };
    let (_, me, _, h) = call(&r, "GET", "/api/session", None, None).await;
    let tenant = me["tenant"].as_str().unwrap().to_string();
    let cookie = h
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap().to_string())
        .collect::<Vec<_>>()
        .join("; ");
    let store = TenantStore::new(r.dir.path().join(&tenant));
    let ctxh = Ctx::new(Actor::human(&tenant).unwrap());
    let client = clients::create_client(&store, &ctxh, "Alpha Client", None).unwrap();
    put(
        &store,
        &Doc {
            slug: "mine",
            title: "Alpha mine",
            app_id: "ie.napkin.brief-maker",
            app_name: "Brief Maker",
            document_type: None,
            client: &client.id,
            job: None,
            updated: "2026-03-14T10:00:00Z",
            editors: &[],
            assets: &[],
            data: "a: b\n",
        },
    );
    let p = Who { cookie, tenant };
    let (st, ids, _, _) = search(&r, &p, "alpha").await;
    assert_eq!(st, StatusCode::OK);
    assert!(ids.contains(&"doc-mine".to_string()));
    let (_, ids, _, _) = search(&r, &p, "people").await;
    assert!(ids.is_empty());
}

#[tokio::test]
async fn the_index_holds_no_document_words_budget_or_rationale_and_never_finds_them() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), "wk");
    let store = TenantStore::new(dir.path().join(TenantId::of_agency("wk").as_str()));
    let index = SearchIndex::build(
        &store,
        &JobIndex::build(&store, chrono::Utc::now()).unwrap(),
    )
    .unwrap();
    let text = serde_json::to_string(&index).unwrap();
    assert!(index.entries.len() >= 10);
    for m in MARKERS {
        assert!(!text.contains(m), "the serialised index holds {m}");
        assert!(!text.to_uppercase().contains(&m.to_uppercase()));
    }
    // nor does a search find them
    for m in MARKERS {
        let q = searchindex::parse(m);
        let found = searchindex::search(index.entries.iter(), &q, |_| true, 50);
        assert_eq!(found.total, 0, "{m} is found");
    }
    // what it does hold is the listed facts: kind, title, client, job, tool, dates, editors, asset name and type
    let brief = index
        .entries
        .iter()
        .find(|e| e.id == "doc-alpha-brief")
        .unwrap();
    let all: Vec<&String> = brief
        .title_tokens
        .iter()
        .chain(brief.fact_tokens.iter())
        .collect();
    for w in [
        "brief", "maker", "alpha", "client", "j001", "march", "2026", "planning",
    ] {
        assert!(
            all.iter().any(|t| *t == w),
            "the brief carries {w}: {all:?}"
        );
    }
    let asset = index.entries.iter().find(|e| e.kind == "asset").unwrap();
    assert_eq!(
        (asset.title.as_str(), asset.line.as_str()),
        ("logo-alpha.png", "image/png in Alpha brief")
    );
}

#[tokio::test]
async fn the_parser_and_ranker_put_the_expected_entry_first_on_the_seed() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), "wk");
    let store = TenantStore::new(dir.path().join(TenantId::of_agency("wk").as_str()));
    // a second client and job, so the first is not the only one
    let me = Ctx::new(Actor::human("admin@wk").unwrap());
    let other = clients::create_client(&store, &me, "Beta Client", None).unwrap();
    jobs::create_job(
        &store,
        &me,
        NewJob {
            number: Some("J002".into()),
            client_id: other.id.clone(),
            title: Some("Beta spring".into()),
            ..Default::default()
        },
    )
    .unwrap();
    put(
        &store,
        &Doc {
            slug: "beta-brief",
            title: "Beta brief",
            app_id: "ie.napkin.brief-maker",
            app_name: "Brief Maker",
            document_type: None,
            client: &other.id,
            job: Some("J002"),
            updated: "2026-03-20T10:00:00Z",
            editors: &[],
            assets: &[],
            data: "a: b\n",
        },
    );
    let index = SearchIndex::build(
        &store,
        &JobIndex::build(&store, chrono::Utc::now()).unwrap(),
    )
    .unwrap();
    let top = |q: &str| -> String {
        let f = searchindex::search(index.entries.iter(), &searchindex::parse(q), |_| true, 1);
        f.groups
            .first()
            .and_then(|(_, v)| v.first())
            .map(|e| e.id.clone())
            .unwrap_or_default()
    };
    assert_eq!(top("J001"), "J001");
    assert_eq!(top("J002"), "J002");
    assert_eq!(top("J001 brief"), "doc-alpha-brief");
    assert_eq!(top("J002 brief"), "doc-beta-brief");
    assert_eq!(top("client alpha radio"), "doc-alpha-radio");
    assert_eq!(
        top("brief march"),
        "doc-beta-brief",
        "the newest brief of March"
    );
    assert_eq!(top("alpha brief march"), "doc-alpha-brief");
    assert_eq!(
        top("planning"),
        "doc-alpha-research",
        "a name held as a fact ties the job and the documents, and the newest comes first"
    );
    assert_eq!(top("logo-alpha.png"), "doc-alpha-brief#logo-alpha.png");
    assert_eq!(top("logo png"), "doc-alpha-brief#logo-alpha.png");
    assert_eq!(top("script"), "doc-alpha-radio");
    assert_eq!(top("idea"), "doc-alpha-ideas");
    let f = searchindex::search(
        index.entries.iter(),
        &searchindex::parse("scope"),
        |_| true,
        50,
    );
    assert!(f
        .groups
        .iter()
        .flat_map(|(_, v)| v)
        .any(|e| e.id == "doc-alpha-scope"));
}

// ── the stamp: an unchanged tenant costs no read ─────────────────────────────

struct Counted<'a> {
    inner: &'a TenantStore,
    reads: AtomicUsize,
    hashes: AtomicUsize,
}

impl PartStore for Counted<'_> {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        self.inner.read(id)
    }
    fn exists(&self, id: &DocId) -> bool {
        self.inner.exists(id)
    }
    fn version(&self, id: &DocId) -> HostResult<Version> {
        self.hashes.fetch_add(1, Ordering::Relaxed);
        self.inner.version(id)
    }
    fn stamp(&self, id: &DocId) -> HostResult<Stamp> {
        self.inner.stamp(id)
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.inner.apply(change)
    }
}

impl Library for Counted<'_> {
    fn app_candidates(&self) -> Vec<DocId> {
        self.inner.app_candidates()
    }
    fn app_template(&self, app_id: &str) -> DocId {
        self.inner.app_template(app_id)
    }
    fn documents(&self) -> Vec<DocId> {
        self.inner.documents()
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        self.inner.new_document(app_id, id_short)
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        self.inner.home(version_tag)
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        self.inner.fork_branch(parent, agent)
    }
}

fn now() -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339("2026-11-12T10:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc)
}

#[test]
fn an_unchanged_tenant_of_three_hundred_documents_is_searched_with_no_read_and_no_hash() {
    let dir = tempfile::tempdir().unwrap();
    let client = seed(dir.path(), "wk");
    let store = TenantStore::new(dir.path().join(TenantId::of_agency("wk").as_str()));
    for i in 0..300 {
        put(
            &store,
            &Doc {
                slug: &format!("n{i:04}"),
                title: &format!("Alpha note {i}"),
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
    }
    let counted = Counted {
        inner: &store,
        reads: AtomicUsize::new(0),
        hashes: AtomicUsize::new(0),
    };
    let jobs = IndexCache::new();
    let cache = SearchCache::new();
    let first = cache.get(&counted, &jobs, now()).unwrap();
    assert!(
        counted.reads.load(Ordering::Relaxed) >= 300,
        "the first read after a start is one full build"
    );
    assert!(first.entries.len() >= 307);
    counted.reads.store(0, Ordering::Relaxed);
    counted.hashes.store(0, Ordering::Relaxed);
    for q in ["alpha note 42", "J001", "scope"] {
        let idx = cache.get(&counted, &jobs, now()).unwrap();
        let found = searchindex::search(idx.entries.iter(), &searchindex::parse(q), |_| true, 12);
        assert!(found.total > 0);
    }
    assert_eq!(
        (
            counted.reads.load(Ordering::Relaxed),
            counted.hashes.load(Ordering::Relaxed)
        ),
        (0, 0),
        "a search of an unchanged tenant reads no document and hashes none"
    );
    assert_eq!(cache.builds(), 1);
    // one document moves: only it is read again (and the two registries)
    let id = doc_id("n0007");
    let base = store.version(&id).unwrap();
    store
        .apply(&Change::replace(
            id,
            base,
            bytes(&Doc {
                slug: "n0007",
                title: "Alpha renamed",
                app_id: "ie.napkin.brief-maker",
                app_name: "Brief Maker",
                document_type: None,
                client: &client,
                job: Some("J001"),
                updated: "2026-03-15T10:00:00Z",
                editors: &[],
                assets: &[],
                data: "a: b\n",
            }),
        ))
        .unwrap();
    let idx = cache.get(&counted, &jobs, now()).unwrap();
    let reads = counted.reads.load(Ordering::Relaxed);
    assert!(reads < 20, "one document in 300 moved, {reads} reads");
    assert_eq!(cache.builds(), 2);
    assert!(idx.entries.iter().any(|e| e.title == "Alpha renamed"));
    // delete it, rebuild it, compare: identical
    cache.delete();
    let rebuilt = cache.get(&counted, &jobs, now()).unwrap();
    assert_eq!(*idx, *rebuilt);
    assert_eq!(
        *rebuilt,
        SearchIndex::build(&store, &JobIndex::build(&store, now()).unwrap()).unwrap()
    );
}

#[test]
fn five_thousand_entries_answer_a_hundred_queries_inside_the_bound() {
    let entries: Vec<searchindex::Entry> = (0..5000)
        .map(|i| searchindex::Entry {
            kind: "brief",
            id: format!("doc-{i}"),
            title: format!("Campaign {i} autumn launch"),
            line: String::new(),
            client_id: Some(format!("cli_{:08x}", i % 40)),
            job: Some(format!("J{:03}", i % 900 + 100)),
            route: format!("/d/doc-{i}"),
            open: searchindex::Open {
                action: "document",
                target: format!("doc-{i}"),
            },
            updated: "2026-03-14T10:00:00Z".into(),
            owner: None,
            title_tokens: searchindex::words(&format!("Campaign {i} autumn launch")),
            fact_tokens: searchindex::words("brief Brief Maker Client march 2026"),
        })
        .collect();
    let roles: Vec<String> = vec!["planning".into()];
    let mut worst = std::time::Duration::ZERO;
    for i in 0..100 {
        let q = searchindex::parse(&format!("autumn campaign {}", i * 37));
        let t = std::time::Instant::now();
        let f = searchindex::search(
            entries.iter(),
            &q,
            |e| napkin_web::roles::allowed(&roles, &e.route, e.client_id.as_deref()),
            12,
        );
        worst = worst.max(t.elapsed());
        assert!(f.total >= 1);
    }
    assert!(
        worst.as_millis() < 50,
        "the slowest of 100 queries took {worst:?}"
    );
}
