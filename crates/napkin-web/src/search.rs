// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! `GET /api/t/{tenant}/search?q=&limit=`: what the one bar finds (features/one-bar-search.clan).
//!
//! The index is the tenant's own (`Workspace.search`, napkin-host `searchindex`), and the tenant is the
//! session's, never the request's (the `Tenant` extractor answers 403 to any other). Every entry,
//! and every person from the agency's directory, passes `roles::allowed` with the route it opens and
//! its client **before** it is scored, ranked or counted, so a person never finds, and never sees a
//! count that hints at, what they cannot open. There is no write verb (405). The handler logs counts
//! and milliseconds, never what was typed.

use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use napkin_host::searchindex::{self, Entry};
use serde::{Deserialize, Serialize};

use crate::auth::Account;
use crate::directory::PersonState;
use crate::error::ApiResult;
use crate::roles::{self, Table};
use crate::state::AppCtx;
use crate::tenant::Tenant;

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/t/{tenant}/search", get(search))
}

#[derive(Deserialize)]
struct Params {
    #[serde(default)]
    q: String,
    limit: Option<usize>,
}

/// The most results one answer carries.
const DEFAULT_LIMIT: usize = 12;
const MAX_LIMIT: usize = 50;

/// One result as the bar is sent it: an allow list of fields, built by name.
#[derive(Serialize)]
struct Item {
    kind: &'static str,
    id: String,
    title: String,
    line: String,
    route: String,
    open: searchindex::Open,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    job: Option<String>,
    /// A person only: the numbers of the jobs they own, as the card lists them.
    #[serde(skip_serializing_if = "Option::is_none")]
    jobs: Option<Vec<String>>,
}

#[derive(Serialize)]
struct Group {
    kind: &'static str,
    items: Vec<Item>,
}

#[derive(Serialize)]
struct Answer {
    total: usize,
    groups: Vec<Group>,
}

/// The roles of a person in words: the title of each role's home, else the role as written.
fn role_words(table: &Table, roles: &[String]) -> String {
    let mut out: Vec<String> = Vec::new();
    for r in roles {
        let title = table
            .homes
            .iter()
            .find(|h| h.role == *r)
            .map(|h| h.title.clone())
            .unwrap_or_else(|| {
                let mut c = r.replace('-', " ").chars().collect::<Vec<_>>();
                if let Some(f) = c.first_mut() {
                    *f = f.to_ascii_uppercase();
                }
                c.into_iter().collect()
            });
        if !out.contains(&title) {
            out.push(title);
        }
    }
    out.join(", ")
}

async fn search(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    account: Option<Extension<Account>>,
    Query(p): Query<Params>,
) -> ApiResult<Json<Answer>> {
    let started = Instant::now();
    let me = account.map(|Extension(a)| a);
    let my_roles: Vec<String> = me.as_ref().map(|a| a.roles.clone()).unwrap_or_default();
    let query = searchindex::parse(&p.q);
    if query.is_empty() {
        return Ok(Json(Answer {
            total: 0,
            groups: Vec::new(),
        }));
    }
    let ws = ctx.workspace(&tenant);
    let before = ws.search.builds();
    let index = ws.search.get(&*ws.store, &ws.jobs, ws.now())?;
    let rebuilt = ws.search.builds() != before;
    // People come from the agency's directory, a member's view of it: names and roles, no email,
    // nobody removed. Anonymous, or an agency with no directory: no people.
    let table = Table::for_agency(
        ctx.roles_dir.as_deref(),
        me.as_ref().map(|a| a.agency.as_str()),
    );
    let people: Vec<Entry> = me
        .as_ref()
        .map(|a| {
            ctx.directory
                .people(&a.agency)
                .into_iter()
                .filter(|x| x.state != PersonState::Removed)
                .map(|x| {
                    searchindex::person_entry(
                        &x.username,
                        &x.name,
                        &x.roles,
                        &role_words(&table, &x.roles),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let limit = p.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let found = searchindex::search(
        index.entries.iter().chain(people.iter()),
        &query,
        |e| roles::allowed(&my_roles, &e.route, e.client_id.as_deref()),
        limit,
    );
    let groups: Vec<Group> = found
        .groups
        .into_iter()
        .map(|(kind, entries)| Group {
            kind,
            items: entries
                .into_iter()
                .map(|e| Item {
                    kind: e.kind,
                    id: e.id.clone(),
                    title: e.title.clone(),
                    line: e.line.clone(),
                    route: e.route.clone(),
                    open: e.open.clone(),
                    client_id: e.client_id.clone(),
                    job: e.job.clone(),
                    jobs: (e.kind == "person").then(|| {
                        index
                            .entries
                            .iter()
                            .filter(|j| {
                                j.kind == "job"
                                    && j.owner.as_deref() == Some(e.id.as_str())
                                    && roles::allowed(&my_roles, &j.route, j.client_id.as_deref())
                            })
                            .map(|j| j.id.clone())
                            .collect()
                    }),
                })
                .collect(),
        })
        .collect();
    tracing::info!(
        target: "napkin_web::search",
        entries = index.entries.len(),
        results = found.total,
        rebuilt,
        ms = started.elapsed().as_millis() as u64,
        "search"
    );
    Ok(Json(Answer {
        total: found.total,
        groups,
    }))
}
