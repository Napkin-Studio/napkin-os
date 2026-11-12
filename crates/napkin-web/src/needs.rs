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
//! The index stays read-only: `POST /needs` is 405. A mark is written by `POST /needs/{id}/done` and
//! taken back by `DELETE` on the same path, which is the five seconds to undo.

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
        while marks.done.len() > MAX_MARKS {
            marks.done.pop_front();
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
        "/t/{tenant}/needs/{id}/done",
        post(mark_done).delete(undo_done),
    )
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
    Ok(Json(list_for(
        &ctx,
        &index,
        user.as_ref(),
        tz_of(&query),
        ws.now().date_naive(),
    )))
}

fn signed_in(user: Option<Extension<Account>>) -> ApiResult<Account> {
    user.map(|Extension(a)| a)
        .ok_or_else(|| ApiError::new(403, "Sign in to mark something done."))
}

/// The signed-in person marks one of their own items done. A notice only: 409 for a task, 404 for an id
/// that is not theirs.
async fn mark_done(
    State(ctx): State<Arc<AppCtx>>,
    Tenant(tenant): Tenant,
    user: Option<Extension<Account>>,
    Path((_t, id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> ApiResult<Json<Value>> {
    let me = signed_in(user)?;
    let ws = ctx.workspace(&tenant);
    let index = crate::api::job_index(&ws)?;
    let tz = tz_of(&query);
    let mut mine = all_of(&ctx, &index, &me, tz);
    // the reminder is decided by the person's local day, which a request a few hours either side may be on
    for off in [-1_i64, 1] {
        mine.extend(reminder(&ctx, &me, tz + off * 24 * 60));
    }
    let Some(need) = mine.iter().find(|n| n.id == id) else {
        return Err(ApiError::new(404, "That is not one of your items."));
    };
    if !need.can_done {
        return Err(ApiError::new(
            409,
            "This is work to do: it leaves when the work is done.",
        ));
    }
    ctx.done.mark(&me.username, &id)?;
    Ok(Json(serde_json::json!({ "ok": true, "id": id })))
}

/// Undo: the person takes their own mark back. It is theirs alone, so there is nothing to look up.
async fn undo_done(
    State(ctx): State<Arc<AppCtx>>,
    user: Option<Extension<Account>>,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let me = signed_in(user)?;
    ctx.done.unmark(&me.username, &id)?;
    Ok(Json(serde_json::json!({ "ok": true, "id": id })))
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
