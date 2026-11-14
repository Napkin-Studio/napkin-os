// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/align-needs-lock-people.clan, stage 3, the rollout: on first start the server imports the
//! build's agency directories into the People store (one change line per person), copies an agency's logo
//! to its record, and from then on the store is the only list. The import drops nobody, widens no role,
//! is idempotent, and refuses to start on a directory that moved after it was imported (two stores).

use std::collections::BTreeSet;
use std::path::Path;

use napkin_host::agency::{self, NewPerson};
use napkin_web::people::People;
use napkin_web::store::TenantStore;
use napkin_web::tenant::TenantId;

/// The J001 seed's shape: an agency with a directory (cr, its admin and the people they named), and a
/// roster-only agency (wk) whose roles are the roster's column.
const ROSTER: &str = "cara@cr\tCara\tadmin\n\
old@cr\tOld Line\tplanning\n\
aoife@wk\tAoife\tplanning\n\
dara@wk\tDara\tcreative-director\n\
sam@wk\tSam\n\
engineer@napkin\tEng\tadmin\n";

fn known(r: &str) -> bool {
    r != "demo" && napkin_web::roles::Table::default().knows(r)
}

fn store_of(root: &Path, agency: &str) -> TenantStore {
    TenantStore::new(root.join(TenantId::of_agency(agency).as_str()))
}

fn invite(root: &Path, agency: &str, by: &str, username: &str, roles: &[&str]) {
    let ctx = TenantId::of_agency(agency).ctx_for(by);
    agency::invite(
        &store_of(root, agency),
        &ctx,
        NewPerson {
            username: username.into(),
            name: format!("{username} Test"),
            email: format!("{}@mail.example.test", username.split('@').next().unwrap()),
            roles: roles.iter().map(|r| r.to_string()).collect(),
        },
        &known,
    )
    .unwrap();
}

/// cr's directory as the build kept it: cara (the first admin), dan and fay named, eve named and removed.
fn directory(root: &Path) {
    invite(root, "cr", "cara@cr", "dan@cr", &["planning"]);
    invite(root, "cr", "cara@cr", "eve@cr", &["traffic"]);
    invite(root, "cr", "cara@cr", "fay@cr", &["copywriter", "art-director"]);
    agency::remove_person(
        &store_of(root, "cr"),
        &TenantId::of_agency("cr").ctx_for("cara@cr"),
        "eve@cr",
    )
    .unwrap();
}

/// Who could sign in before, and with which roles, by the build's rule: an agency with a directory is the
/// directory's alone (a removed person or one with no roles gets in nowhere); any other is the roster's.
fn before(root: &Path, roster: &str, username: &str) -> Option<Vec<String>> {
    let agency = username.split('@').nth(1).unwrap();
    let (reg, _) = agency::read(&store_of(root, agency)).unwrap();
    if reg.has_directory() {
        return reg
            .person(username)
            .filter(|p| p.state != agency::State::Removed && !p.roles.is_empty())
            .map(|p| p.roles.clone());
    }
    roster.lines().find_map(|l| {
        let mut c = l.split('\t');
        (c.next() == Some(username)).then(|| {
            napkin_web::roles::parse_roles(c.nth(1).unwrap_or(""))
        })
    })
}

fn everyone(root: &Path, p: &People) -> BTreeSet<String> {
    let mut all: BTreeSet<String> = p.book().people.iter().map(|x| x.id.clone()).collect();
    let (reg, _) = agency::read(&store_of(root, "cr")).unwrap();
    all.extend(reg.people.iter().map(|x| x.username.clone()));
    all
}

fn open(dir: &Path) -> People {
    People::open(dir.join("_people"), &dir.join("accounts.tsv")).unwrap()
}

#[test]
fn the_directory_is_imported_with_nobody_dropped_and_no_role_widened() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("accounts.tsv"), ROSTER).unwrap();
    directory(root);
    // cr's logo, kept by look.rs before the People store took it
    std::fs::write(
        root.join(TenantId::of_agency("cr").as_str())
            .join("agency-look.json"),
        r#"{"logo":"data:image/png;base64,AAAA","agent":"cara@cr","action":"agency look: set the logo","at":"2026-11-01T00:00:00Z"}"#,
    )
    .unwrap();
    let p = open(root);
    let all = everyone(root, &p);
    let was: Vec<(String, Option<Vec<String>>)> = all
        .iter()
        .map(|u| (u.clone(), before(root, ROSTER, u)))
        .collect();

    let report = napkin_web::people_import::run(&p, root).unwrap();
    assert_eq!(report.people, 4, "cara, dan, eve and fay: {report:?}");

    for (u, roles) in &was {
        let now = p.active(u).map(|x| x.roles);
        assert_eq!(&now, roles, "{u}: before {roles:?}, after {now:?}");
    }
    // nobody is dropped: every person of the directory is in the store, removed ones as removed
    for u in ["cara@cr", "dan@cr", "eve@cr", "fay@cr"] {
        assert!(p.book().person(u).is_some(), "{u} dropped");
    }
    assert!(p.book().person("eve@cr").unwrap().removed_at.is_some());
    // the roster's line for old@cr did not let them in once cr had a directory, and does not now
    assert!(p.active("old@cr").is_none());
    assert!(p.book().person("old@cr").is_some(), "kept, as removed");
    // the email comes with the person
    assert_eq!(
        p.book().person("dan@cr").unwrap().email.as_deref(),
        Some("dan@mail.example.test")
    );
    // one change line per person of the directory
    let log = std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap();
    for u in ["cara@cr", "dan@cr", "eve@cr", "fay@cr"] {
        let n = log
            .lines()
            .filter(|l| l.contains("imported from the directory") && l.contains(&format!("\"{u}\"")))
            .count();
        assert_eq!(n, 1, "{u}: {log}");
    }
    // the logo is on the agency's record
    assert_eq!(
        p.book().logos.get("cr").map(|l| l.logo.as_str()),
        Some("data:image/png;base64,AAAA")
    );
}

#[test]
fn the_import_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("accounts.tsv"), ROSTER).unwrap();
    directory(root);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    let file = std::fs::read(root.join("_people/people.json")).unwrap();
    let log = std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap();
    // a second start: a new handle, the same files
    let again = open(root);
    let report = napkin_web::people_import::run(&again, root).unwrap();
    assert_eq!(report.people, 0, "{report:?}");
    assert_eq!(std::fs::read(root.join("_people/people.json")).unwrap(), file);
    assert_eq!(
        std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap(),
        log
    );
}

#[test]
fn a_directory_that_moved_after_the_import_stops_the_start() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("accounts.tsv"), ROSTER).unwrap();
    directory(root);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    // an older server, still running, names someone in the old directory
    invite(root, "cr", "cara@cr", "gil@cr", &["planning"]);
    let err = napkin_web::people_import::run(&open(root), root).unwrap_err();
    assert!(err.contains("cr"), "{err}");
    assert!(open(root).active("gil@cr").is_none());
}

#[test]
fn a_store_written_before_roles_takes_them_from_the_roster_column_once() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("accounts.tsv"), ROSTER).unwrap();
    // develop's people.json: no roles field, one person added on the page who is not on the roster
    std::fs::create_dir_all(root.join("_people")).unwrap();
    std::fs::write(
        root.join("_people/people.json"),
        r#"{"people":[
            {"id":"aoife@wk","agency":"wk","admin":false,"added_by":"roster","added_at":"2026-11-01T00:00:00Z"},
            {"id":"sam@wk","agency":"wk","admin":false,"added_by":"roster","added_at":"2026-11-01T00:00:00Z"},
            {"id":"new@wk","name":"New","agency":"wk","admin":false,"added_by":"engineer@napkin","added_at":"2026-11-02T00:00:00Z"},
            {"id":"engineer@napkin","agency":"napkin","admin":true,"added_by":"roster","added_at":"2026-11-01T00:00:00Z"}
        ]}"#,
    )
    .unwrap();
    let p = open(root);
    assert_eq!(p.active("aoife@wk").unwrap().roles, ["planning"]);
    assert!(p.active("sam@wk").unwrap().roles.is_empty());
    assert!(p.active("new@wk").unwrap().roles.is_empty());
    assert_eq!(p.active("engineer@napkin").unwrap().roles, ["admin"]);
    let log = std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap();
    // the roster file is the seed from now on: a second start with an edited file changes nothing
    std::fs::write(
        root.join("accounts.tsv"),
        ROSTER.replace("aoife@wk\tAoife\tplanning", "aoife@wk\tAoife\tadmin"),
    )
    .unwrap();
    let again = open(root);
    assert_eq!(again.active("aoife@wk").unwrap().roles, ["planning"]);
    assert_eq!(
        std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap(),
        log
    );
}
