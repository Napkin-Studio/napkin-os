// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The one-time move to one People store (features/align-needs-lock-people.clan, stage 3, rollout).
//!
//! The build kept an agency's people in a registry document per workspace (`napkin_host::agency`, read by
//! the directory that this replaces). On the first start after the deploy, [`run`] imports every such
//! directory into the People store (people.rs) in one write, one change line per person, and copies an
//! agency's logo from look.rs's file to its record. Only seed, staging and UAT agencies have a directory.
//!
//! It drops nobody and widens no role: a person of a directory is kept as the directory had them, and
//! anyone the directory shut out (removed, or with no role) is kept as removed. It runs once: the store
//! records a fingerprint of each directory it imported, and a later start does nothing. A directory that
//! changed after it was imported (an older server still writing to it) stops the start: the server would
//! otherwise run with two stores of who may sign in.

use std::collections::BTreeMap;
use std::path::Path;

use crate::people::{Directory, DirectoryPerson, People};
use crate::store::TenantStore;
use crate::tenant::TenantId;

/// What a start imported.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Imported {
    /// People of the directories written into the store (0 once the import has run).
    pub people: usize,
    /// Logos copied from look.rs's files.
    pub logos: usize,
}

fn fingerprint(people: &[napkin_host::agency::Person]) -> String {
    use sha2::Digest as _;
    let bytes = serde_json::to_vec(people).unwrap_or_default();
    sha2::Sha256::digest(&bytes)
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Every workspace under `root` whose agency registry names people, as `(agency, directory)`. A registry
/// that cannot be read stops the start: it may hold people the store would otherwise not know.
fn directories(root: &Path) -> Result<Vec<Directory>, String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return Ok(out);
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| TenantId::parse(n).is_some())
        .collect();
    names.sort();
    for name in names {
        let store = TenantStore::new(root.join(&name));
        let (reg, _) = napkin_host::agency::read(&store)
            .map_err(|e| format!("the agency directory in {name} cannot be read: {e}"))?;
        if !reg.has_directory() {
            continue;
        }
        let agency = reg
            .people
            .iter()
            .find_map(|p| crate::tenant::agency_of(&p.username))
            .filter(|a| TenantId::of_agency(a).as_str() == name)
            .ok_or_else(|| {
                format!("the agency directory in {name} names people of another workspace")
            })?;
        out.push(Directory {
            fingerprint: fingerprint(&reg.people),
            people: reg
                .people
                .iter()
                .map(|p| DirectoryPerson {
                    id: p.username.clone(),
                    name: p.name.clone(),
                    email: Some(p.email.clone()).filter(|e| !e.is_empty()),
                    roles: crate::people::clean_roles(&p.roles),
                    removed: p.state == napkin_host::agency::State::Removed,
                    added_by: p.invited_by.clone(),
                    added_at: p.at.clone(),
                })
                .collect(),
            agency,
        });
    }
    Ok(out)
}

/// Import the build's directories into `people` once, and copy any agency's logo that the store does not
/// hold yet. `root` is the data root (every workspace is a folder under it). An error means the server
/// must not start.
pub fn run(people: &People, root: &Path) -> Result<Imported, String> {
    let found = directories(root)?;
    let book = people.book();
    let mut report = Imported::default();
    match book.migrated.as_ref().and_then(|m| m.directories.as_ref()) {
        Some(done) => {
            for d in &found {
                if done.get(&d.agency) != Some(&d.fingerprint) {
                    return Err(format!(
                        "the agency directory of {} changed after it was imported into the People store; \
                         refusing to start with two stores of who may sign in (stop every older server, then \
                         move the change to the People page)",
                        d.agency
                    ));
                }
            }
        }
        None => {
            report.people = people
                .import_directories(&found)
                .map_err(|e| format!("the agency directories could not be imported: {e:?}"))?;
            for d in &found {
                for p in &d.people {
                    tracing::info!(target: "napkin_web::people", agency = %d.agency, person = %p.id,
                        roles = %p.roles.join(","), removed = p.removed || p.roles.is_empty(),
                        "imported from the agency directory");
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
