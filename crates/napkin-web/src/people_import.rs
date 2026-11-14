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
//! The registry is a document, and from 12 Nov 2026 until this stage any member of the agency could write
//! it (an ordinary `patch-data`, naming any agent and any action in its body). So nothing in it is a source
//! of authority: not a role, not who exists, not who wrote what. The only trust roots are what an operator
//! controls: the roster file the server starts with (`NAPKIN_AUTH_ROSTER`, its roles column) and the People
//! store itself.
//!
//! - A person the store already has is never written by the import.
//! - A registry entry of another agency than the registry's own is skipped and logged.
//! - A registry entry the store lacks takes its roles from the roster's column alone, only roles the role
//!   table defines, and only into the roster entry's own agency; the registry's roles are never read. One
//!   the roster does not name (or names with no role the table defines) is written as removed with no
//!   roles, with one log line naming them: an admin brings them back on the People page.
//! - From the registry only display data is taken, as untrusted input: a name (at most 120 characters,
//!   no control characters, no `<` or `>`) and an address (the shape `name@place`, no markup).
//! - An agency with a registry and no line in the roster: nobody in it gets a role, and the log says so.
//!
//! It runs once: the store records a fingerprint of each registry it read. After that the registry is a
//! source of nothing (the API refuses to open it: `state::Workspace`), and a registry that changed is only
//! logged. Nothing in a registry can stop a start: one that cannot be read is skipped and logged.

use std::collections::BTreeMap;
use std::path::Path;

use napkin_host::agency;

use crate::people::{Directory, DirectoryPerson, People};
use crate::store::TenantStore;
use crate::tenant::TenantId;

/// The registry's document id in a workspace (`TenantStore::home` of `napkin_host::agency`'s tag). The API
/// refuses to open it (`state::Workspace`), so no session, token or `patch-data` reaches it.
pub const REGISTRY_DOC: &str = "home-agency-v1";

/// The most entries the import records as removed from one registry: a registry any member could write may
/// name any number of people, and a removed entry costs a line and a record each. Beyond it, the rest are
/// logged as one line and not written.
pub const MAX_REMOVED_PER_REGISTRY: usize = 1000;

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

/// A name from a registry, as display data from an untrusted source: trimmed, at most 120 characters, no
/// control characters and no markup; None when it is not one.
fn clean_name(raw: &str) -> Option<String> {
    let n = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let ok = !n.is_empty()
        && n.chars().count() <= 120
        && !n.chars().any(|c| c.is_control() || c == '<' || c == '>');
    ok.then_some(n)
}

/// An address from a registry, as untrusted display data: the shape `name@place`, no markup.
fn clean_email(raw: &str) -> Option<String> {
    agency::clean_email(raw)
        .ok()
        .filter(|e| !e.contains(['<', '>', '"', '\'']))
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
    let roster = people.roster().unwrap_or_default();
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
        let agency_id = reg
            .people
            .iter()
            .filter_map(|p| crate::tenant::agency_of(&p.username))
            .chain(book.people.iter().map(|p| p.agency.clone()))
            .find(|a| TenantId::of_agency(a).as_str() == name);
        let Some(agency_id) = agency_id else {
            tracing::warn!(target: "napkin_web::people", workspace = %name,
                "an agency registry whose agency cannot be told; nobody is imported from it");
            continue;
        };
        let roster_names_agency = roster.lines().any(|l| {
            l.split('\t')
                .next()
                .and_then(crate::auth::Account::parse_username)
                .is_some_and(|(_, a)| a == agency_id)
        });
        if !roster_names_agency {
            tracing::warn!(target: "napkin_web::people", agency = %agency_id,
                "an agency registry and no line of this agency in the roster: nobody in it gets a role from the import");
        }
        let mut list = Vec::new();
        for p in &reg.people {
            let Some((id, at)) = crate::auth::Account::parse_username(&p.username) else {
                continue;
            };
            if at != agency_id {
                tracing::warn!(target: "napkin_web::people", agency = %agency_id, person = %p.username,
                    "a registry entry of another agency; skipped");
                continue;
            }
            // the roles: the roster's column, never the registry's
            let roles: Vec<String> = People::roster_roles_of(&roster, &id)
                .unwrap_or_default()
                .into_iter()
                .filter(|r| known(r))
                .collect();
            let why = if roles.is_empty() {
                tracing::warn!(target: "napkin_web::people", agency = %agency_id, person = %id,
                    "in the agency registry and given no role by the roster: imported as removed; an admin adds them back on the People page");
                Some(
                    "not given a role by the roster: removed until an admin adds them back"
                        .to_string(),
                )
            } else {
                None
            };
            list.push(DirectoryPerson {
                name: clean_name(&p.name).unwrap_or_default(),
                email: clean_email(&p.email),
                removed: roles.is_empty(),
                roles,
                why,
                id,
            });
        }
        let removed = list.iter().filter(|p| p.removed).count();
        if removed > MAX_REMOVED_PER_REGISTRY {
            let mut kept = 0;
            list.retain(|p| {
                if !p.removed {
                    return true;
                }
                kept += 1;
                kept <= MAX_REMOVED_PER_REGISTRY
            });
            tracing::warn!(target: "napkin_web::people", agency = %agency_id, removed,
                cap = MAX_REMOVED_PER_REGISTRY,
                "the agency registry names more people without a role than the import records; the rest are not written");
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
