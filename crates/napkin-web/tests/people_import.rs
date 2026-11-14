// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! features/align-needs-lock-people.clan, stage 3, the rollout: on first start the server imports the
//! build's agency directories into the People store (one change line per person), copies an agency's logo
//! to its record, and from then on the store is the only list. The import writes over nobody the store
//! has, is idempotent, and ignores a directory that moved after it was imported (people_trust.rs holds
//! what it refuses to trust).

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
    invite(
        root,
        "cr",
        "cara@cr",
        "fay@cr",
        &["copywriter", "art-director"],
    );
    agency::remove_person(
        &store_of(root, "cr"),
        &TenantId::of_agency("cr").ctx_for("cara@cr"),
        "eve@cr",
    )
    .unwrap();
}

fn open(dir: &Path) -> People {
    People::open(dir.join("_people"), &dir.join("accounts.tsv")).unwrap()
}

#[test]
fn the_directory_records_the_people_the_store_lacks_and_touches_no_one_it_has() {
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
    let had: Vec<_> = p.book().people.clone();

    let report = napkin_web::people_import::run(&p, root).unwrap();
    assert_eq!(report.people, 3, "dan, eve and fay: {report:?}");
    // the directory's people the store lacked come in for the record, removed and with no role: the roster
    // names none of them, and the registry is no source of a role
    for u in ["dan@cr", "eve@cr", "fay@cr"] {
        assert!(p.active(u).is_none(), "{u}");
        assert!(p.book().person(u).unwrap().roles.is_empty(), "{u}");
    }
    assert_eq!(
        p.book().person("dan@cr").unwrap().email.as_deref(),
        Some("dan@mail.example.test")
    );
    // everyone the store already had is exactly as they were: the import writes over nobody (old@cr, on
    // the roster but not the directory, keeps their roster record: the rollout's People page check)
    for before in &had {
        assert_eq!(p.book().person(&before.id), Some(before), "{}", before.id);
    }
    // one change line per person written, none for those it left alone
    let log = std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap();
    for (u, n) in [
        ("dan@cr", 1),
        ("eve@cr", 1),
        ("fay@cr", 1),
        ("cara@cr", 0),
        ("old@cr", 0),
    ] {
        let seen = log
            .lines()
            .filter(|l| {
                l.contains("imported from the directory") && l.contains(&format!("\"{u}\""))
            })
            .count();
        assert_eq!(seen, n, "{u}: {log}");
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
    assert_eq!(
        std::fs::read(root.join("_people/people.json")).unwrap(),
        file
    );
    assert_eq!(
        std::fs::read_to_string(root.join("_people/changes.jsonl")).unwrap(),
        log
    );
}

#[test]
fn a_directory_that_moved_after_the_import_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("accounts.tsv"), ROSTER).unwrap();
    directory(root);
    let p = open(root);
    napkin_web::people_import::run(&p, root).unwrap();
    // an older server, still running, names someone in the old directory
    invite(root, "cr", "cara@cr", "gil@cr", &["planning"]);
    let again = napkin_web::people_import::run(&open(root), root).unwrap();
    assert_eq!(again.people, 0);
    assert!(open(root).book().person("gil@cr").is_none());
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
