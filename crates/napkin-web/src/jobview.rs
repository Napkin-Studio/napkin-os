// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! A job as one person may see it (features/job-page.clan). The index holds every field of a job; what
//! goes out is chosen by name, per role, from the allow lists below, never by removing the fields that
//! are held back (the way `clean.rs` does it, after a deny list leaked). A field added to `JobEntry`
//! is sent to nobody until it is named here, and the test at the foot builds a `JobEntry` with a struct
//! literal, so adding a field breaks it until its place in these lists is decided.
//!
//! Money (the Money group of `roles.rs`) is sent `budget_hours`. The Approvals group (account service and
//! management, who name the route) is sent a client step's contact email and rounds; everyone else sees
//! who approves a step and its state, not how to reach the client. A person with no role, an admin and a
//! demo are in every group, as everywhere.

use napkin_host::jobindex::JobEntry;
use serde_json::{Map, Value};

use crate::roles::{in_group, Group};

/// Every role.
pub const JOB_KEYS: &[&str] = &[
    "number",
    "title",
    "client",
    "owner",
    "opened_on",
    "due",
    "stage",
    "status",
    "waiting_on",
    "days_waiting_on_client",
    "at_risk",
    "documents",
    "route",
    "holder",
];
/// Held back from every role: the people on the job feed the on-the-job filter of Needs you and are
/// nobody's to read off the job.
pub const HELD_BACK_KEYS: &[&str] = &["people"];
/// The Money group only.
pub const MONEY_KEYS: &[&str] = &["budget_hours"];

const CLIENT_KEYS: &[&str] = &["id", "name"];
const STAGE_KEYS: &[&str] = &["id", "step", "label"];
const DOC_KEYS: &[&str] = &[
    "path",
    "title",
    "app_id",
    "needs_you",
    "locked",
    "version",
    "changed_since_lock",
];
const HOLDER_KEYS: &[&str] = &[
    "party",
    "person",
    "role",
    "stage",
    "since",
    "days",
    "due",
    "days_late",
];
/// Every role.
pub const STEP_KEYS: &[&str] = &[
    "stage",
    "label",
    "party",
    "role",
    "approver",
    "due",
    "state",
    "approved_by",
    "approved_at",
    "version",
    "document",
    "held_since",
    "days_held",
    "days_late",
];
/// The Approvals group only.
pub const APPROVER_KEYS: &[&str] = &["contact", "rounds"];

fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    if let Value::Object(m) = v {
        for k in keys {
            if let Some(x) = m.get(*k) {
                out.insert((*k).to_string(), x.clone());
            }
        }
    }
    Value::Object(out)
}

fn pick_all(v: &Value, keys: &[&str]) -> Value {
    match v {
        Value::Array(items) => Value::Array(items.iter().map(|i| pick(i, keys)).collect()),
        other => other.clone(),
    }
}

/// What is sent of a need, by name (features/needs-you-full.clan): the audience (who else it was for) is
/// held back, and so is anything a later field might add until it is named here.
pub const NEED_KEYS: &[&str] = &[
    "id",
    "kind",
    "stage",
    "days_late",
    "job",
    "client",
    "client_id",
    "text",
    "action",
    "path",
    "due",
    "due_source",
    "urgent",
    "can_done",
];

/// A need as the signed-in person is sent it.
pub fn need_view(need: &napkin_host::jobindex::Need) -> Value {
    pick(
        &serde_json::to_value(need).unwrap_or(Value::Null),
        NEED_KEYS,
    )
}

/// `entry` as a person with `roles` is sent it.
pub fn job_view(entry: &JobEntry, roles: &[String]) -> Value {
    let full = serde_json::to_value(entry).unwrap_or(Value::Null);
    let mut keys: Vec<&str> = JOB_KEYS.to_vec();
    if in_group(roles, Group::Money) {
        keys.extend_from_slice(MONEY_KEYS);
    }
    let mut step_keys: Vec<&str> = STEP_KEYS.to_vec();
    if in_group(roles, Group::Approvals) {
        step_keys.extend_from_slice(APPROVER_KEYS);
    }
    let Value::Object(mut v) = pick(&full, &keys) else {
        return Value::Null;
    };
    let nested = [
        ("client", CLIENT_KEYS),
        ("stage", STAGE_KEYS),
        ("holder", HOLDER_KEYS),
    ];
    for (k, allowed) in nested {
        // A part the job does not have (no holder: no route yet, or every step approved) stays null.
        // Picking from null would send `{}`, which a reader takes for a holder with no fields.
        if let Some(x) = v.get(k).cloned().filter(Value::is_object) {
            v.insert(k.to_string(), pick(&x, allowed));
        }
    }
    if let Some(x) = v.get("documents").cloned() {
        v.insert("documents".into(), pick_all(&x, DOC_KEYS));
    }
    if let Some(x) = v.get("route").cloned() {
        v.insert("route".into(), pick_all(&x, &step_keys));
    }
    Value::Object(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clan_sdk::ClientRef;
    use napkin_host::jobindex::{Holder, JobDoc, RouteStepState, StageInfo};

    /// Every field of a job set, so a field the lists forget shows as a key that is missing or extra.
    fn seeded() -> JobEntry {
        JobEntry {
            number: "J001".into(),
            title: "Autumn launch".into(),
            client: ClientRef {
                id: "cli_00000001".into(),
                name: "Client A".into(),
            },
            owner: "aoife@wk".into(),
            opened_on: "2026-11-02".into(),
            due: Some("2026-12-18".into()),
            budget_hours: Some(120.0),
            stage: StageInfo {
                id: "brief-check",
                step: 3,
                label: "Brief check",
            },
            status: "Waiting for the brief check".into(),
            waiting_on: "agency",
            days_waiting_on_client: Some(2),
            at_risk: false,
            documents: vec![JobDoc {
                path: "a.clan".into(),
                title: "Brief".into(),
                app_id: Some("ie.napkin.brief-maker".into()),
                needs_you: 1,
                locked: false,
                version: Some(1),
                changed_since_lock: true,
            }],
            route: vec![RouteStepState {
                stage: "brief-check".into(),
                label: "Brief check",
                party: "client".into(),
                role: Some("client".into()),
                approver: "Client A contact".into(),
                contact: Some("contact@client-a.example".into()),
                rounds: Some(2),
                due: "2026-11-20".into(),
                state: "waiting",
                approved_by: Some("x".into()),
                approved_at: Some("2026-11-03T09:00:00Z".into()),
                version: Some("v".into()),
                document: Some("a.clan".into()),
                held_since: Some("2026-11-03".into()),
                days_held: Some(1),
                days_late: Some(0),
            }],
            holder: Some(Holder {
                party: "client".into(),
                person: "Client A contact".into(),
                role: Some("client".into()),
                stage: "brief-check".into(),
                since: "2026-11-03".into(),
                days: 1,
                due: "2026-11-20".into(),
                days_late: 0,
            }),
            people: vec!["aoife@wk".into(), "dara@wk".into()],
        }
    }

    fn keys(v: &Value) -> Vec<String> {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    }
    fn sorted(a: &[&str], b: &[&str]) -> Vec<String> {
        let mut k: Vec<String> = a.iter().chain(b).map(|s| s.to_string()).collect();
        k.sort();
        k
    }

    #[test]
    fn the_lists_name_every_field_of_a_job_exactly_once() {
        let full = serde_json::to_value(seeded()).unwrap();
        let sent = sorted(JOB_KEYS, MONEY_KEYS);
        assert_eq!(
            keys(&full),
            sorted(
                &sent.iter().map(String::as_str).collect::<Vec<_>>(),
                HELD_BACK_KEYS
            )
        );
        let step = &full["route"][0];
        assert_eq!(keys(step), sorted(STEP_KEYS, APPROVER_KEYS));
        assert_eq!(keys(&full["client"]), sorted(CLIENT_KEYS, &[]));
        assert_eq!(keys(&full["stage"]), sorted(STAGE_KEYS, &[]));
        assert_eq!(keys(&full["documents"][0]), sorted(DOC_KEYS, &[]));
        assert_eq!(keys(&full["holder"]), sorted(HOLDER_KEYS, &[]));
    }

    #[test]
    fn a_need_is_sent_by_name_and_never_says_who_else_it_was_for() {
        use napkin_host::jobindex::{Audience, Need};
        let need = Need {
            id: "J001:brief-check:everyone:brief-changed:abc".into(),
            kind: "brief-changed",
            stage: "brief-check".into(),
            days_late: None,
            job: "J001".into(),
            client: "Client A".into(),
            client_id: "cli_00000001".into(),
            text: "Brief: changed after it was signed.".into(),
            action: "Open the brief".into(),
            path: "documents/b.clan".into(),
            due: Some("2026-12-18".into()),
            due_source: "job",
            urgent: false,
            can_done: true,
            audience: Audience::Person("dara@wk".into()),
        };
        let full = serde_json::to_value(&need).unwrap();
        assert_eq!(keys(&full), sorted(NEED_KEYS, &["audience"]));
        let sent = need_view(&need);
        assert_eq!(keys(&sent), sorted(NEED_KEYS, &[]));
        assert!(sent.get("audience").is_none());
    }

    #[test]
    fn each_group_gets_its_own_fields_and_no_others() {
        let r = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let e = seeded();
        for (roles, money, approvals) in [
            (r(&["planning"]), false, false),
            (r(&["creative-director"]), false, false),
            (r(&["art-director"]), false, false),
            (r(&["copywriter"]), false, false),
            (r(&["agency-brain"]), false, false),
            (r(&["producer"]), true, false),
            (r(&["traffic"]), true, false),
            (r(&["account-service"]), true, true),
            (r(&["management"]), true, true),
            (r(&["admin"]), true, true),
            (r(&[]), true, true),
            (r(&["planning", "producer"]), true, false),
            (r(&["nonsense"]), false, false),
        ] {
            let v = job_view(&e, &roles);
            assert_eq!(
                keys(&v),
                sorted(JOB_KEYS, if money { MONEY_KEYS } else { &[] }),
                "{roles:?}"
            );
            assert_eq!(
                keys(&v["route"][0]),
                sorted(STEP_KEYS, if approvals { APPROVER_KEYS } else { &[] }),
                "{roles:?}"
            );
            assert_eq!(v.get("budget_hours").is_some(), money, "{roles:?}");
        }
    }

    #[test]
    fn a_job_with_no_holder_is_sent_a_null_holder_not_an_empty_one() {
        let mut entry = seeded();
        entry.holder = None;
        for roles in [
            vec!["account-service".to_string()],
            vec!["planning".to_string()],
            vec![],
        ] {
            let v = job_view(&entry, &roles);
            assert!(v["holder"].is_null(), "{roles:?}: {}", v["holder"]);
        }
    }
}
