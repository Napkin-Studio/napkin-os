// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The one-time move to one People store (features/align-needs-lock-people.clan, stage 3, rollout).
//!
//! The build kept an agency's people in a registry document per workspace (`napkin_host::agency`). On the
//! first start after the deploy, [`run`] imports those registries into the People store (people.rs) in one
//! write, one change line per person, and copies an agency's logo from look.rs's file to its record. Only
//! seed, staging and UAT agencies have a registry.
//!
//! The registry is a document, and until this stage any member of the agency could open it and write its
//! `people` with an ordinary `patch-data` (the build's directory read it on every request). So nothing in it
//! is trusted for what it says alone:
//!
//! - an entry is imported only into the agency that owns the registry (its workspace), checked per entry;
//!   one of any other agency is skipped and logged;
//! - a person the store already has is never written: not overwritten, re-roled or removed (so neither a
//!   Napkin admin nor any agency's last admin can be touched);
//! - a role is kept only if the default role table defines it (never `demo`, never `napkin-admin`, never a
//!   string the store does not know), and `admin` only where the registry's own chain shows a trusted admin
//!   gave it (an `add_person` or `set_roles` decision for that person, written by an admin); a bulk import
//!   cannot show that, so its `admin` is dropped;
//! - the chain is replayed from the agency's admins in the People store: every decision on it must be one of
//!   the registry's own actions written by an admin of the time (or a person's own first sign-in). Any other
//!   decision (a member's `patch-data`) taints the registry, and then nothing it names is trusted.
//!
//! An entry the import will not trust (tainted, removed, or left with no role it trusts) is written as
//! removed with no roles: kept for the record, unable to sign in, and brought back on the People page.
//!
//! It runs once: the store records a fingerprint of each registry it read. After that the registry is a
//! source of nothing (the API refuses to open it: `state::Workspace`), and a registry that changed is only
//! logged. Nothing in a registry can stop a start: one that cannot be read is skipped and logged.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use napkin_host::agency;

use crate::people::{Directory, DirectoryPerson, People, ADMIN_ROLE};
use crate::store::TenantStore;
use crate::tenant::TenantId;

/// The registry's document id in a workspace (`TenantStore::home` of `napkin_host::agency`'s tag). The API
/// refuses to open it (`state::Workspace`), so no session, token or `patch-data` reaches it.
pub const REGISTRY_DOC: &str = "home-agency-v1";

/// What a start imported.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Imported {
    /// People written into the store from the registries (0 once the import has run).
    pub people: usize,
    /// Logos copied from look.rs's files.
    pub logos: usize,
}

fn fingerprint(people: &[agency::Person]) -> String {
    use sha2::Digest as _;
    let bytes = serde_json::to_vec(people).unwrap_or_default();
    sha2::Sha256::digest(&bytes)
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A role the import may keep: one the default role table defines, other than `demo`.
fn known(role: &str) -> bool {
    role != crate::roles::DEMO && crate::roles::Table::default().knows(role)
}

fn roles_of(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|x| x.trim().to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_default()
}

/// What the registry's chain shows: whether every decision on it was the registry's own, by an admin of the
/// time, and which people an admin made admin.
struct Shown {
    tainted: Option<String>,
    admin_by_admin: BTreeSet<String>,
}

/// Replay the chain (newest first, as `agency::history` gives it), oldest first, from `admins`: the agency's
/// admins in the People store.
fn replay(history: &[agency::Edit], agency_id: &str, admins: BTreeSet<String>) -> Shown {
    let mut trusted = admins;
    let mut shown = BTreeSet::new();
    for d in history.iter().rev() {
        let of_agency = crate::tenant::agency_of(&d.who).as_deref() == Some(agency_id);
        if d.action == agency::ACTIVATE && d.target == d.who && of_agency {
            continue;
        }
        if !agency::ACTIONS.contains(&d.action.as_str()) || !trusted.contains(&d.who) {
            return Shown {
                tainted: Some(format!(
                    "{} wrote {:?} to the registry and was not its admin",
                    d.who, d.action
                )),
                admin_by_admin: BTreeSet::new(),
            };
        }
        match d.action.as_str() {
            agency::ADD_PERSON | agency::SET_ROLES => {
                if roles_of(&d.after).iter().any(|r| r == ADMIN_ROLE) {
                    trusted.insert(d.target.clone());
                    shown.insert(d.target.clone());
                } else {
                    trusted.remove(&d.target);
                    shown.remove(&d.target);
                }
            }
            agency::REMOVE_PERSON => {
                trusted.remove(&d.target);
                shown.remove(&d.target);
            }
            _ => {}
        }
    }
    Shown {
        tainted: None,
        admin_by_admin: shown,
    }
}

/// Every registry under `root` that names people, read as the import trusts it. A registry that cannot be
/// read, or whose agency cannot be told, is skipped and logged.
fn directories(people: &People, root: &Path) -> Vec<Directory> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| TenantId::parse(n).is_some())
        .collect();
    names.sort();
    let book = people.book();
    for name in names {
        let store = TenantStore::new(root.join(&name));
        let reg = match agency::read(&store) {
            Ok((reg, _)) => reg,
            Err(e) => {
                tracing::warn!(target: "napkin_web::people", workspace = %name, error = %e,
                    "an agency registry cannot be read; nobody is imported from it");
                continue;
            }
        };
        if !reg.has_directory() {
            continue;
        }
        let history = agency::history(&store).unwrap_or_default();
        let agency_id = reg
            .people
            .iter()
            .filter_map(|p| crate::tenant::agency_of(&p.username))
            .chain(
                history
                    .iter()
                    .filter_map(|d| crate::tenant::agency_of(&d.who)),
            )
            .chain(book.people.iter().map(|p| p.agency.clone()))
            .find(|a| TenantId::of_agency(a).as_str() == name);
        let Some(agency_id) = agency_id else {
            tracing::warn!(target: "napkin_web::people", workspace = %name,
                "an agency registry whose agency cannot be told; nobody is imported from it");
            continue;
        };
        let admins: BTreeSet<String> = book
            .people
            .iter()
            .filter(|p| p.agency == agency_id && p.is_agency_admin())
            .map(|p| p.id.clone())
            .collect();
        let shown = replay(&history, &agency_id, admins);
        if let Some(why) = &shown.tainted {
            tracing::warn!(target: "napkin_web::people", agency = %agency_id, why = %why,
                "the agency registry was written outside its admins' routes; nobody new signs in from it");
        }
        let mut list = Vec::new();
        for p in &reg.people {
            if crate::tenant::agency_of(&p.username).as_deref() != Some(agency_id.as_str()) {
                tracing::warn!(target: "napkin_web::people", agency = %agency_id, person = %p.username,
                    "a registry entry of another agency; skipped");
                continue;
            }
            let wanted = crate::people::clean_roles(&p.roles);
            let mut roles: Vec<String> = wanted.iter().filter(|r| known(r)).cloned().collect();
            let mut why: Vec<String> = Vec::new();
            if roles.len() != wanted.len() {
                why.push("a role the store does not define was dropped".into());
            }
            if roles.iter().any(|r| r == ADMIN_ROLE) && !shown.admin_by_admin.contains(&p.username)
            {
                roles.retain(|r| r != ADMIN_ROLE);
                why.push(
                    "admin was dropped: the registry's chain does not show an admin gave it".into(),
                );
            }
            if let Some(t) = &shown.tainted {
                roles.clear();
                why.push(format!("not trusted: {t}"));
            }
            let removed = p.state == agency::State::Removed || roles.is_empty();
            list.push(DirectoryPerson {
                id: p.username.clone(),
                name: p.name.clone(),
                email: Some(p.email.clone()).filter(|e| !e.is_empty()),
                roles,
                removed,
                why: (!why.is_empty()).then(|| why.join("; ")),
            });
        }
        out.push(Directory {
            agency: agency_id,
            fingerprint: fingerprint(&reg.people),
            people: list,
        });
    }
    out
}

/// Import the build's registries into `people` once, and copy any agency's logo that the store does not
/// hold yet. `root` is the data root (every workspace is a folder under it). An error is the People store
/// itself failing to write; nothing in a registry makes one.
pub fn run(people: &People, root: &Path) -> Result<Imported, String> {
    let found = directories(people, root);
    let book = people.book();
    let mut report = Imported::default();
    match book.migrated.as_ref().and_then(|m| m.directories.as_ref()) {
        Some(done) => {
            for d in &found {
                if done.get(&d.agency) != Some(&d.fingerprint) {
                    tracing::warn!(target: "napkin_web::people", agency = %d.agency,
                        "the agency registry changed after its import; it is a source of nothing and is ignored");
                }
            }
        }
        None => {
            report.people = people
                .import_directories(&found)
                .map_err(|e| format!("the agency registries could not be imported: {e:?}"))?;
            for d in &found {
                for p in &d.people {
                    tracing::info!(target: "napkin_web::people", agency = %d.agency, person = %p.id,
                        roles = %p.roles.join(","), removed = p.removed, why = ?p.why,
                        "read from the agency registry");
                }
            }
        }
    }
    // the logos: every agency the store knows (its people, its basic agencies, the code's), by workspace
    let book = people.book();
    let mut agencies: BTreeMap<String, String> = BTreeMap::new();
    for a in book
        .people
        .iter()
        .map(|p| p.agency.clone())
        .chain(book.agencies.iter().map(|a| a.id.clone()))
        .chain(
            crate::people::CODE_AGENCIES
                .iter()
                .map(|(id, ..)| id.to_string()),
        )
    {
        agencies.insert(TenantId::of_agency(&a).as_str().to_string(), a);
    }
    for (tenant, agency) in agencies {
        if book.logos.contains_key(&agency) {
            continue;
        }
        let dir = root.join(&tenant);
        if !dir.join("agency-look.json").is_file() {
            continue;
        }
        let Some(logo) = crate::look::read_dir(&dir).logo else {
            continue;
        };
        people
            .set_logo("directory import", &agency, Some(&logo))
            .map_err(|e| format!("the logo of {agency} could not be copied: {e:?}"))?;
        tracing::info!(target: "napkin_web::people", agency = %agency, "logo copied from look.rs to the agency's record");
        report.logos += 1;
    }
    Ok(report)
}
