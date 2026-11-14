// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Needs you, for the signed-in person (features/needs-you-full.clan; v2 section 4).
//!
//! The job index (`napkin_host::jobindex`) holds every need of the agency, rebuilt from the documents.
//! This module answers one person's list from it: the items of the jobs they are on, addressed to them
//! by name or to a role they hold, less what they have marked done, with their own timesheet reminder
//! added. The only state kept is the person's own done marks ([`DoneStore`]), one small file each,
//! readable by nobody else and counted by nobody: Napkin never scores people, and a mark is not a
//! measure of one.
//!
//! The index stays read-only: `POST /needs` is 405. `GET /needs` answers per document (`documents`), the
//! person's own set-aside keys (`aside`), the next deadline and the timesheet reminder. There is no second
//! list: what is on a document's own Needs you list is what is counted.
//!
//! Set aside (features/align-needs-lock-people.clan) is the person's own mark on one of a document's items:
//! `POST /needs/{key}/aside?path=<document>` with the key of the shell's `needKey`, and `DELETE` to bring it
//! back. The marks are kept here, one small file each, readable by nobody else and counted by nobody:
//! Napkin never scores people, and a mark is not a measure of one.

use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, RawQuery, State};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use napkin_host::alerts;
use napkin_host::jobindex::{JobIndex, Need};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth::Account;
use crate::error::{ApiError, ApiResult};
use crate::state::AppCtx;
use crate::tenant::Tenant;

/// The most marks one person keeps: the oldest go first. A mark on a need whose cause has passed is dead
/// weight, and a person's list is short.
const MAX_MARKS: usize = 2000;

/// The most set-aside marks one person keeps, counted apart from done marks: the oldest go first.
const MAX_ASIDE: usize = 500;

fn is_aside(id: &str) -> bool {
    id.starts_with("aside\u{1f}")
}

// ── the done store ──────────────────────────────────────────────────────────

/// Where a person's done marks live. The file store is the first; the agency database replaces it later
/// without a route changing.
pub trait DoneStore: Send + Sync {
    /// The ids `person` has marked done.
    fn marked(&self, person: &str) -> HashSet<String>;
    /// `person` marks `id` done. Marking twice is the same as once.
    fn mark(&self, person: &str, id: &str) -> ApiResult<()>;
    /// `person` takes the mark back (Undo). No mark is no error.
    fn unmark(&self, person: &str, id: &str) -> ApiResult<()>;
}

#[derive(Serialize, Deserialize, Default)]
struct Marks {
    /// Oldest first.
    #[serde(default)]
    done: VecDeque<String>,
}

/// One file per person, `<root>/<name>.json`, beside the timesheets.
pub struct FileDone {
    root: PathBuf,
    lock: Mutex<()>,
}

impl FileDone {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
        }
    }

    fn file(&self, person: &str) -> PathBuf {
        let safe: String = person
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@') {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        self.root.join(format!("{}.json", safe.replace("..", "-")))
    }

    fn read(&self, person: &str) -> Marks {
        fs::read(self.file(person))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn write(&self, person: &str, marks: &Marks) -> ApiResult<()> {
        let fail = |e: String| ApiError::new(500, format!("Done could not be saved: {e}"));
        fs::create_dir_all(&self.root).map_err(|e| fail(e.to_string()))?;
        let path = self.file(person);
        let tmp = path.with_extension("tmp");
        fs::write(
            &tmp,
            serde_json::to_vec(marks).map_err(|e| fail(e.to_string()))?,
        )
        .and_then(|_| fs::rename(&tmp, &path))
        .map_err(|e| fail(e.to_string()))
    }
}

impl DoneStore for FileDone {
    fn marked(&self, person: &str) -> HashSet<String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read(person).done.into_iter().collect()
    }

    fn mark(&self, person: &str, id: &str) -> ApiResult<()> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut marks = self.read(person);
        if marks.done.iter().any(|d| d == id) {
            return Ok(());
        }
        marks.done.push_back(id.to_string());
        // each kind keeps to its own bound, so one cannot push the other out
        let (aside, cap) = (
            is_aside(id),
            if is_aside(id) { MAX_ASIDE } else { MAX_MARKS },
        );
        while marks.done.iter().filter(|d| is_aside(d) == aside).count() > cap {
            if let Some(at) = marks.done.iter().position(|d| is_aside(d) == aside) {
                marks.done.remove(at);
            }
        }
        self.write(person, &marks)
    }

    fn unmark(&self, person: &str, id: &str) -> ApiResult<()> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut marks = self.read(person);
        let before = marks.done.len();
        marks.done.retain(|d| d != id);
        if marks.done.len() == before {
            return Ok(());
        }
        self.write(person, &marks)
    }
}

// ── one person's list ───────────────────────────────────────────────────────

/// The roles of a person on a job, as the agency's directory has them; none for an agency with no
/// directory, where Needs you works from roles alone.
fn roles_in_directory<'a>(ctx: &'a AppCtx, agency: &'a str) -> impl Fn(&str) -> Vec<String> + 'a {
    move |username: &str| {
        ctx.directory
            .person(agency, username)
            .filter(|p| p.state != crate::directory::PersonState::Removed)
            .map(|p| p.roles)
            .unwrap_or_default()
    }
}

/// What the index asks of `user`, before their done marks and without the timesheet reminder.
pub fn items_of(ctx: &AppCtx, index: &JobIndex, user: Option<&Account>) -> Vec<Need> {
    match user {
        None => index.needs_for(None, &[]),
        Some(a) => index.needs_visible(
            Some(a.username.as_str()),
            &a.roles,
            &roles_in_directory(ctx, &a.agency),
        ),
    }
}

/// The local date and hour for `tz` minutes east of UTC, at the timesheet clock.
fn local_now(ctx: &AppCtx, tz: i64) -> (String, i64) {
    use chrono::Timelike;
    let at = chrono::DateTime::from_timestamp_millis(ctx.timesheets.now() + tz * 60_000)
        .unwrap_or_default();
    (at.date_naive().to_string(), i64::from(at.hour()))
}

/// The caller's own timesheet reminder, when the rule says so. Built from the caller's own day alone.
fn reminder(ctx: &AppCtx, user: &Account, tz: i64) -> Option<Need> {
    let (date, hour) = local_now(ctx, tz);
    let asked = ctx.timesheets.store.consent(&user.username) != crate::timesheet::Consent::NotAsked;
    if !asked || hour < alerts::TIMESHEET_HOUR {
        return None;
    }
    let confirmed = ctx.timesheets.day_confirmed(&user.username, &date);
    alerts::timesheet_reminder(&user.username, &date, hour, asked, confirmed)
}

/// Every need of `user` that Done may still be pressed on, or has been: the list before the marks. Used
/// to answer who an id belongs to.
fn all_of(ctx: &AppCtx, index: &JobIndex, user: &Account, tz: i64) -> Vec<Need> {
    let mut items = items_of(ctx, index, Some(user));
    items.extend(reminder(ctx, user, tz));
    items
}

/// `tz` from a query string: minutes east of UTC, as the timesheet's own routes take it.
fn tz_of(query: &Option<String>) -> i64 {
    napkin_host::routes::query_param(query.as_deref().unwrap_or(""), "tz")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| (-14 * 60..=14 * 60).contains(v))
        .unwrap_or(0)
}

/// The signed-in person's list, as it is sent: done marks taken out, the reminder in.
pub fn list_for(
    ctx: &AppCtx,
    index: &JobIndex,
    user: Option<&Account>,
    tz: i64,
    today: chrono::NaiveDate,
) -> Value {
    let (items, next) = match user {
        None => (
            items_of(ctx, index, None),
            index.next_deadline(None, &[], today),
        ),
        Some(a) => {
            let marked = ctx.done.marked(&a.username);
            let mut items = all_of(ctx, index, a, tz);
            items.retain(|n| !marked.contains(&n.id));
            (
                items,
                index.next_deadline(Some(&a.username), &a.roles, today),
            )
        }
    };
    // by deadline, none last, then by job and text: the order of the index, with the reminder placed in it
    let mut items = items;
    items.sort_by(|a, b| {
        (a.due.is_none(), &a.due, &a.job, &a.text).cmp(&(b.due.is_none(), &b.due, &b.job, &b.text))
    });
    serde_json::json!({
        "total": items.len(),
        "items": items.iter().map(crate::jobview::need_view).collect::<Vec<_>>(),
        "next_deadline": next,
    })
}

/// The items of one job, as `GET /jobs/{number}` sends them: the person's list, one job of it.
pub fn job_items(
    ctx: &AppCtx,
    index: &JobIndex,
    user: Option<&Account>,
    number: &str,
    today: chrono::NaiveDate,
) -> Vec<Value> {
    list_for(ctx, index, user, 0, today)["items"]
        .as_array()
        .map(|a| a.iter().filter(|n| n["job"] == number).cloned().collect())
        .unwrap_or_default()
}

// ── routes ──────────────────────────────────────────────────────────────────

/// `GET /needs` only: the index is read-only, so a write to it is 405. A done mark has its own path.
pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/t/{tenant}/needs", get(needs)).route(
        "/t/{tenant}/needs/{id}/aside",
        post(set_aside).delete(bring_back),
    )
}

// ── per document, and set aside ─────────────────────────────────────────────

/// The longest document path or key a mark names.
const MAX_KEY: usize = 600;

/// Separates the parts of a set-aside mark's id: never in a path, and a done mark's id has none.
const SEP: char = '\u{1f}';

fn aside_id(path: &str, key: &str) -> String {
    format!("aside{SEP}{path}{SEP}{key}")
}

/// The index's needs that are notices or tasks on one document, as the document's own list carries them: an
/// attention item that does not block the lock (`code` `notice:<kind>`), for the person (or the role) the
/// need is for. The gate's own row is left out (it is a `gate:` item already) and so is the timesheet
/// reminder, which is on no document. Built from the caller's own visible needs, so it names nobody else.
pub fn notices_on(ctx: &AppCtx, index: &JobIndex, user: &Account, path: &str) -> Vec<Value> {
    use napkin_host::jobindex::Audience;
    // a need about the job itself (its deadline) sits on the job's brief, or else its first document
    let home_of = |job: &str| {
        index.job(job).and_then(|j| {
            j.documents
                .iter()
                .find(|d| d.app_id.as_deref() == Some(napkin_host::ops::gate::BRIEF_MAKER))
                .or_else(|| j.documents.first())
                .map(|d| d.path.as_str())
        })
    };
    // addressed to this person: by name, by a role they hold, or to the job's people when they are on it. What an
    // admin or the demo person may see of every job (`items_of`) is not addressed to them.
    let for_me = |n: &Need| match &n.audience {
        Audience::Person(p) => *p == user.username,
        Audience::Role(r) => user.roles.iter().any(|x| x == r),
        Audience::Job => index.is_on(&n.job, &user.username),
    };
    items_of(ctx, index, Some(user))
        .into_iter()
        .filter(|n| {
            for_me(n)
                && n.kind != "gate"
                && n.kind != "timesheet"
                && if n.path.is_empty() {
                    home_of(&n.job) == Some(path)
                } else {
                    n.path == path
                }
        })
        .map(|n| {
            let who = match &n.audience {
                Audience::Person(p) => serde_json::json!({ "person": p }),
                Audience::Role(r) => serde_json::json!({ "role": r }),
                Audience::Job => serde_json::json!({ "person": user.username }),
            };
            serde_json::json!({
                "code": format!("notice:{}", n.kind),
                "text": n.text,
                "blocks_lock": false,
                "for": who,
                "due": n.due,
                "job": n.job,
            })
        })
        .collect()
}

/// A document's decision view as the sandbox sends it to the person who opened it: the host's answer, with
/// the notices of the job index that are theirs on this document added to `attention` (they block nothing).
/// The host does not know a person's roles, so the join is made here. `None` when nothing is added.
pub fn with_notices(
    ctx: &AppCtx,
    ws: &crate::state::Workspace,
    grant: &crate::tokens::Grant,
    body: &[u8],
) -> Option<Vec<u8>> {
    let mut view: Value = serde_json::from_slice(body).ok()?;
    let index = crate::api::job_index(ws).ok()?;
    let agency = crate::tenant::agency_of(&grant.person).unwrap_or_default();
    // The roles are read again now, not taken from the token: a role change (or a removal) holds on the
    // person's next read of a document, whatever the token was minted with.
    let roles = if ctx.directory.has(&agency) {
        match ctx.directory.person(&agency, &grant.person) {
            Some(p) if p.state != crate::directory::PersonState::Removed => p.roles,
            _ => return None,
        }
    } else {
        grant.roles.clone()
    };
    let me = Account {
        username: grant.person.clone(),
        agency,
        name: None,
        roles,
    };
    let notices = notices_on(ctx, &index, &me, grant.doc.as_str());
    if notices.is_empty() {
        return None;
    }
    view.get_mut("attention")?.as_array_mut()?.extend(notices);
    serde_json::to_vec(&view).ok()
}

/// What the desk reads per document, for `user`: how many places the document's own Needs you list holds
/// (the count its library state and the Decisions drawer show, never a second one), how many items wait on
/// them (the list's places that name them or a role they hold, and the notices addressed to them, less what
/// they set aside), the earliest date of theirs, and the date the job is next due. A document with nothing
/// of theirs and nothing on its list is not listed.
pub fn documents_for(
    ctx: &AppCtx,
    index: &JobIndex,
    user: Option<&Account>,
    today: chrono::NaiveDate,
    aside: &Value,
) -> Vec<Value> {
    let (name, roles) = user.map_or((None, &[][..]), |a| {
        (Some(a.username.as_str()), &a.roles[..])
    });
    let held = |path: &str, key: &str| {
        aside[path]
            .as_array()
            .is_some_and(|k| k.iter().any(|x| x == key))
    };
    let roles_of = user.map(|a| roles_in_directory(ctx, &a.agency));
    // an item waits on a person when it names them, or a role they hold: on a job's people, or, when nobody on the
    // job holds the role, on everyone who does (the item is never orphaned)
    let waiting_on = |f: &napkin_host::ops::decisions::AttentionFor,
                      job: &napkin_host::jobindex::JobEntry,
                      on_job: bool| {
        user.is_some_and(|a| {
            f.person.as_deref() == Some(a.username.as_str())
                || f.role.as_ref().is_some_and(|r| {
                    a.roles.iter().any(|x| x == r)
                        && (on_job
                            || !job.people.iter().any(|p| {
                                roles_of
                                    .as_ref()
                                    .is_some_and(|f| f(p).iter().any(|x| x == r))
                            }))
                })
        })
    };
    let mut out = Vec::new();
    for job in &index.jobs {
        let on_job = index.sees_job(&job.number, name, roles);
        let next = job.due.as_deref().and_then(|due| {
            (alerts::days_until(due, today)? >= 0).then(|| {
                serde_json::json!({
                    "job": job.number, "client": job.client.name,
                    "client_id": job.client.id, "due": due,
                })
            })
        });
        for d in &job.documents {
            let notices = user.map_or_else(Vec::new, |a| notices_on(ctx, index, a, &d.path));
            let mut dues: Vec<&str> = Vec::new();
            let mut mine = 0usize;
            for h in d.holds.iter().filter(|h| {
                h.for_.as_ref().is_some_and(|f| waiting_on(f, job, on_job))
                    && !held(&d.path, &h.key)
            }) {
                mine += 1;
                dues.extend(h.due.as_deref());
            }
            for n in &notices {
                let key = format!(
                    "{}:{}",
                    n["code"].as_str().unwrap_or(""),
                    n["text"].as_str().unwrap_or("")
                );
                if held(&d.path, &key) {
                    continue;
                }
                mine += 1;
                dues.extend(n["due"].as_str());
            }
            // a person off the job sees only what is addressed to them
            if mine == 0
                && (!on_job || (d.holds.is_empty() && notices.is_empty()))
                && notices.is_empty()
            {
                continue;
            }
            out.push(serde_json::json!({
                "path": d.path,
                "count": d.holds.len(),
                "notices": notices.len(),
                "mine": mine,
                "earliest_due": dues.iter().min(),
                "next_deadline": next,
            }));
        }
    }
    out
}

/// The caller's set-aside keys, by document path.
fn aside_of(ctx: &AppCtx, user: Option<&Account>) -> Value {
    let mut out: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    if let Some(a) = user {
        let mut ids: Vec<String> = ctx.done.marked(&a.username).into_iter().collect();
        ids.sort();
        for id in ids {
            let Some(rest) = id.strip_prefix(&format!("aside{SEP}")) else {
                continue;
            };
            if let Some((path, key)) = rest.split_once(SEP) {
                out.entry(path.to_string())
                    .or_default()
                    .push(key.to_string());
            }
        }
    }
    serde_json::json!(out)
}

#[derive(Deserialize)]
struct AsideQuery {
    path: Option<String>,
}

fn aside_target(
    ctx: &AppCtx,
    tenant: &crate::tenant::TenantId,
    user: Option<Extension<Account>>,
    key: &str,
    path: Option<String>,
) -> ApiResult<(Account, String)> {
    let me = user
        .map(|Extension(a)| a)
        .ok_or_else(|| ApiError::new(403, "Sign in to set something aside."))?;
    let path = path.unwrap_or_default();
    if path.is_empty() || path.len() > MAX_KEY || key.is_empty() || key.len() > MAX_KEY {
        return Err(ApiError::new(
            400,
            "Say which document and which item to set aside.",
        ));
    }
    // only a document of the session's own workspace can be named
    let ws = ctx.workspace(tenant);
    if !ws.store.documents().iter().any(|d| d.as_str() == path) {
        return Err(ApiError::new(404, "That is not one of your documents."));
    }
    Ok((me, aside_id(&path, key)))
}

/// The signed-in person sets one of a document's items aside. Theirs alone: nobody else reads it and it
/// changes nothing on the document, so an item that blocks the lock still blocks.
async fn set_aside(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    user: Option<Extension<Account>>,
    Path((_t, key)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<AsideQuery>,
) -> ApiResult<Json<Value>> {
    let (me, id) = aside_target(&ctx, &tenant, user, &key, q.path)?;
    ctx.done.mark(&me.username, &id)?;
    Ok(Json(serde_json::json!({ "ok": true, "key": key })))
}

/// Bring back: the person takes their own mark away. Nothing of anyone else's is touched.
async fn bring_back(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    user: Option<Extension<Account>>,
    Path((_t, key)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<AsideQuery>,
) -> ApiResult<Json<Value>> {
    let (me, id) = aside_target(&ctx, &tenant, user, &key, q.path)?;
    ctx.done.unmark(&me.username, &id)?;
    Ok(Json(serde_json::json!({ "ok": true, "key": key })))
}

/// What the signed-in person is asked to do next, by deadline. Everyone's own list: two people on one
/// job see different lines. An anonymous visitor sees them all (and has no one to keep marks for).
async fn needs(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    user: Option<Extension<Account>>,
    RawQuery(query): RawQuery,
) -> ApiResult<Json<Value>> {
    let ws = ctx.workspace(&tenant);
    let index = crate::api::job_index(&ws)?;
    let user = user.map(|Extension(a)| a);
    let today = ws.now().date_naive();
    let aside = aside_of(&ctx, user.as_ref());
    let (name, roles) = user.as_ref().map_or((None, &[][..]), |a| {
        (Some(a.username.as_str()), &a.roles[..])
    });
    Ok(Json(serde_json::json!({
        "documents": documents_for(&ctx, &index, user.as_ref(), today, &aside),
        "aside": aside,
        "next_deadline": index.next_deadline(name, roles, today),
        // the person's own timesheet reminder, which is on no document: from 16:00 where they are
        "timesheet": user.as_ref()
            .and_then(|a| reminder(&ctx, a, tz_of(&query)))
            .map(|n| crate::jobview::need_view(&n)),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mark_is_kept_per_person_undone_and_never_seen_by_another() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileDone::new(dir.path().join("needs-done"));
        assert!(store.marked("aoife@wk").is_empty());
        store.mark("aoife@wk", "J001:x").unwrap();
        store.mark("aoife@wk", "J001:x").unwrap();
        assert_eq!(store.marked("aoife@wk").len(), 1, "twice is once");
        assert!(
            store.marked("dara@wk").is_empty(),
            "another person's marks are not shared"
        );
        // a new store on the same disk is another web task: the mark is still there
        let again = FileDone::new(dir.path().join("needs-done"));
        assert!(again.marked("aoife@wk").contains("J001:x"));
        store.unmark("aoife@wk", "J001:x").unwrap();
        store.unmark("aoife@wk", "J001:x").unwrap();
        assert!(store.marked("aoife@wk").is_empty());
    }

    #[test]
    fn set_aside_marks_have_their_own_bound_and_done_marks_theirs() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileDone::new(dir.path().to_path_buf());
        store.mark("p@wk", "J001:keep").unwrap();
        for i in 0..MAX_ASIDE + 5 {
            store
                .mark("p@wk", &aside_id("doc-a", &format!("k{i}")))
                .unwrap();
        }
        let kept = store.marked("p@wk");
        assert!(
            kept.contains("J001:keep"),
            "set-aside marks never push a done mark out"
        );
        let asides = kept.iter().filter(|k| k.starts_with("aside")).count();
        assert_eq!(asides, MAX_ASIDE);
        assert!(
            !kept.contains(&aside_id("doc-a", "k0")),
            "the oldest set-aside goes first"
        );
    }

    #[test]
    fn a_name_cannot_walk_out_of_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileDone::new(dir.path().join("needs-done"));
        store.mark("../../etc/x@wk", "a").unwrap();
        assert!(fs::read_dir(dir.path().join("needs-done")).unwrap().count() == 1);
        assert!(!dir.path().join("etc").exists());
    }

    #[test]
    fn the_oldest_marks_go_first() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileDone::new(dir.path().to_path_buf());
        for i in 0..MAX_MARKS + 3 {
            store.mark("p@wk", &format!("id{i}")).unwrap();
        }
        let kept = store.marked("p@wk");
        assert_eq!(kept.len(), MAX_MARKS);
        assert!(!kept.contains("id0") && kept.contains(&format!("id{}", MAX_MARKS + 2)));
    }
}
