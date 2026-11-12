// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The agency registry (features/agency-setup.clan): people, roles and settings, each change one
//! attributed decision on the registry's chain, the last admin kept, a write by no person refused.

use std::collections::HashMap;
use std::sync::Mutex;

use napkin_host::agency::{self, NewPerson, PersonPatch, SettingsPatch, State};
use napkin_host::{Actor, Change, Ctx, DocId, HostError, HostResult, Library, PartStore, Version};

#[derive(Default)]
struct MemStore {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl PartStore for MemStore {
    fn read(&self, id: &DocId) -> HostResult<Vec<u8>> {
        self.files
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| HostError::not_found(format!("no such document: {id}")))
    }
    fn exists(&self, id: &DocId) -> bool {
        self.files.lock().unwrap().contains_key(id.as_str())
    }
    fn apply(&self, change: &Change) -> HostResult<Version> {
        self.files
            .lock()
            .unwrap()
            .insert(change.doc.to_string(), change.bytes.clone());
        Ok(change.archive_version())
    }
}

impl Library for MemStore {
    fn app_candidates(&self) -> Vec<DocId> {
        Vec::new()
    }
    fn app_template(&self, app_id: &str) -> DocId {
        DocId::new(format!("apps/{app_id}/app.clan"))
    }
    fn documents(&self) -> Vec<DocId> {
        Vec::new()
    }
    fn new_document(&self, app_id: &str, id_short: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("docs/{app_id}-{id_short}.clan")))
    }
    fn home(&self, version_tag: &str) -> HostResult<DocId> {
        Ok(DocId::new(format!("home-{version_tag}.clan")))
    }
    fn fork_branch(&self, parent: &DocId, agent: &str) -> DocId {
        DocId::new(format!("{parent}.{agent}.clan"))
    }
}

fn ctx(who: &str) -> Ctx {
    Ctx::new(Actor::human(who).unwrap())
}

fn known(r: &str) -> bool {
    ["admin", "planning", "traffic", "management"].contains(&r)
}

fn person(u: &str, roles: &[&str]) -> NewPerson {
    NewPerson {
        username: u.into(),
        name: format!("{u} Test"),
        email: format!("{}@example.test", u.split('@').next().unwrap()),
        roles: roles.iter().map(|r| r.to_string()).collect(),
    }
}

#[test]
fn the_first_person_named_also_names_the_admin_who_writes() {
    let s = MemStore::default();
    assert!(!agency::read(&s).unwrap().0.has_directory());
    agency::invite(&s, &ctx("cara@cr"), person("dan@cr", &["planning"]), &known).unwrap();
    let (reg, _) = agency::read(&s).unwrap();
    assert!(reg.has_directory());
    let cara = reg.person("cara@cr").expect("the writer is on the list");
    assert!(cara.is_admin());
    assert_eq!(cara.state, State::Active);
    assert_eq!(reg.person("dan@cr").unwrap().state, State::Invited);
}

#[test]
fn a_role_change_is_one_decision_with_the_admin_as_agent_and_the_roles_before_and_after() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    agency::invite(&s, &admin, person("dan@cr", &["planning"]), &known).unwrap();
    agency::edit_person(
        &s,
        &admin,
        "dan@cr",
        PersonPatch {
            roles: Some(vec!["traffic".into(), "management".into()]),
            ..Default::default()
        },
        &known,
    )
    .unwrap();
    let h = agency::history(&s).unwrap();
    assert_eq!(
        h.len(),
        2,
        "one decision per change: the naming, then the roles"
    );
    let d = &h[0];
    assert_eq!(d.action, "set_roles");
    assert_eq!(d.who, "cara@cr");
    assert_eq!(d.target, "dan@cr");
    assert_eq!(d.before, serde_json::json!(["planning"]));
    assert_eq!(d.after, serde_json::json!(["traffic", "management"]));
}

#[test]
fn a_write_by_no_person_is_refused() {
    let s = MemStore::default();
    let process = Ctx::new(Actor::process("job-1").unwrap());
    let err = agency::invite(&s, &process, person("dan@cr", &["planning"]), &known).unwrap_err();
    assert_eq!(err.status, 403);
    assert!(!agency::read(&s).unwrap().0.has_directory());
    let err = agency::set_settings(&s, &process, SettingsPatch::default()).unwrap_err();
    assert_eq!(err.status, 403);
}

#[test]
fn the_last_admin_cannot_be_removed_or_demoted() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    agency::invite(&s, &admin, person("dan@cr", &["planning"]), &known).unwrap();
    assert_eq!(
        agency::remove_person(&s, &admin, "cara@cr")
            .unwrap_err()
            .status,
        409
    );
    let demote = PersonPatch {
        roles: Some(vec!["planning".into()]),
        ..Default::default()
    };
    assert_eq!(
        agency::edit_person(&s, &admin, "cara@cr", demote, &known)
            .unwrap_err()
            .status,
        409
    );
    // a second admin makes either possible
    agency::invite(&s, &admin, person("eve@cr", &["admin"]), &known).unwrap();
    agency::remove_person(&s, &admin, "cara@cr").unwrap();
    assert_eq!(
        agency::read(&s).unwrap().0.person("cara@cr").unwrap().state,
        State::Removed
    );
    // and now eve is the last one
    assert_eq!(
        agency::remove_person(&s, &ctx("eve@cr"), "eve@cr")
            .unwrap_err()
            .status,
        409
    );
}

#[test]
fn a_person_needs_a_role_and_the_role_must_be_known() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    assert_eq!(
        agency::invite(&s, &admin, person("dan@cr", &[]), &known)
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        agency::invite(&s, &admin, person("dan@cr", &["wizard"]), &known)
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        agency::invite(&s, &admin, person("Dan@cr", &["planning"]), &known)
            .unwrap_err()
            .status,
        400
    );
    agency::invite(&s, &admin, person("dan@cr", &["planning"]), &known).unwrap();
    let empty = PersonPatch {
        roles: Some(vec![]),
        ..Default::default()
    };
    assert_eq!(
        agency::edit_person(&s, &admin, "dan@cr", empty, &known)
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        agency::invite(&s, &admin, person("dan@cr", &["traffic"]), &known)
            .unwrap_err()
            .status,
        409
    );
}

#[test]
fn a_removed_person_can_be_named_again_and_a_first_sign_in_activates() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    agency::invite(&s, &admin, person("dan@cr", &["planning"]), &known).unwrap();
    agency::activate(&s, &ctx("dan@cr"), "dan@cr").unwrap();
    assert_eq!(
        agency::read(&s).unwrap().0.person("dan@cr").unwrap().state,
        State::Active
    );
    agency::remove_person(&s, &admin, "dan@cr").unwrap();
    assert_eq!(
        agency::edit_person(&s, &admin, "dan@cr", PersonPatch::default(), &known)
            .unwrap_err()
            .status,
        409
    );
    agency::invite(&s, &admin, person("dan@cr", &["traffic"]), &known).unwrap();
    let (reg, _) = agency::read(&s).unwrap();
    assert_eq!(reg.person("dan@cr").unwrap().state, State::Invited);
    assert_eq!(
        reg.person("dan@cr").unwrap().roles,
        vec!["traffic".to_string()]
    );
}

#[test]
fn settings_are_checked_and_each_change_is_a_decision() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    let out = agency::set_settings(
        &s,
        &admin,
        SettingsPatch {
            name: Some("  Agency   C ".into()),
            credit_cap_month_eur: Some(1500.0),
            time_zone: None,
        },
    )
    .unwrap();
    assert_eq!(out.name, "Agency C");
    assert_eq!(out.credit_cap_month_eur, 1500.0);
    assert_eq!(out.time_zone, "Europe/Dublin");
    for bad in [-1.0, f64::NAN, f64::INFINITY] {
        let p = SettingsPatch {
            credit_cap_month_eur: Some(bad),
            ..Default::default()
        };
        assert_eq!(agency::set_settings(&s, &admin, p).unwrap_err().status, 400);
    }
    let h = agency::history(&s).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].action, "set_settings");
    assert_eq!(
        h[0].after["credit_cap_month_eur"],
        serde_json::json!(1500.0)
    );
    // settings alone are not a directory: the roster stays the source until people are named
    assert!(!agency::read(&s).unwrap().0.has_directory());
}
