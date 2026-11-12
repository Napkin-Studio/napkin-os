// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! CSV import of people, clients and jobs (features/agency-setup.clan): checked before anything
//! is written, bad rows listed by line, one registry write, the same file twice changes nothing.

use std::collections::HashMap;
use std::sync::Mutex;

use napkin_host::agency;
use napkin_host::import;
use napkin_host::{clients, jobs};
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
    ROLES.contains(&r) || r == "admin"
}

const ROLES: [&str; 8] = [
    "planning",
    "creative-director",
    "account-service",
    "management",
    "art-director",
    "copywriter",
    "producer",
    "traffic",
];

/// The suite's own people file: 120 rows, three bad (line 8 has no email, line 40 an unknown role,
/// line 70 repeats line 4's person).
fn people_csv(n: usize) -> String {
    let mut rows = vec!["email,name,roles".to_string()];
    for i in 1..=n {
        let line = i + 1;
        let mut email = format!("person{i}@cr");
        let mut role = ROLES[i % ROLES.len()].to_string();
        if line == 8 {
            email.clear();
        }
        if line == 40 {
            role = "wizard".into();
        }
        if line == 70 {
            email = "person3@cr".into();
        }
        rows.push(format!("{email},Person {i} Test,{role}"));
    }
    rows.join("\n") + "\n"
}

fn count_decisions(s: &MemStore) -> usize {
    agency::history(s).unwrap().len()
}

const REG: &str = "home-agency-v1.clan";

#[test]
fn a_dry_run_lists_the_bad_rows_by_line_and_writes_nothing() {
    let s = MemStore::default();
    let r = import::people(
        &s,
        &ctx("cara@cr"),
        "cr",
        people_csv(120).as_bytes(),
        true,
        &known,
    )
    .unwrap();
    assert_eq!(r.rows, 120);
    assert_eq!(r.ok, 117);
    assert_eq!(
        r.errors.iter().map(|e| e.line).collect::<Vec<_>>(),
        [8, 40, 70]
    );
    assert_eq!(r.errors[0].reason, "missing email");
    assert!(
        r.errors[1].reason.starts_with("unknown role"),
        "{}",
        r.errors[1].reason
    );
    assert!(
        r.errors[2].reason.starts_with("duplicate"),
        "{}",
        r.errors[2].reason
    );
    assert_eq!(r.results.len(), 120, "a result per row");
    assert!(r.starts_directory);
    assert!(!r.committed && r.dry_run);
    assert!(!s.exists(&DocId::new(REG)), "nothing was written");
}

#[test]
fn committing_writes_117_people_in_one_registry_write_and_the_same_file_again_changes_nothing() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    let r = import::people(&s, &admin, "cr", people_csv(120).as_bytes(), false, &known).unwrap();
    assert_eq!((r.created, r.updated, r.unchanged), (117, 0, 0));
    assert_eq!(r.errors.len(), 3);
    assert!(r.committed);
    let (reg, _) = agency::read(&s).unwrap();
    assert_eq!(
        reg.people.len(),
        118,
        "117 people and the admin who imported them"
    );
    assert!(reg.person("cara@cr").unwrap().is_admin());
    assert_eq!(count_decisions(&s), 1, "one registry write, one decision");
    let h = &agency::history(&s).unwrap()[0];
    assert_eq!(
        (h.action.as_str(), h.who.as_str()),
        ("import_people", "cara@cr")
    );
    // again: nothing changes, nothing is written
    let before = s.read(&DocId::new(REG)).unwrap();
    let again =
        import::people(&s, &admin, "cr", people_csv(120).as_bytes(), false, &known).unwrap();
    assert_eq!((again.created, again.updated, again.unchanged), (0, 0, 117));
    assert!(!again.committed);
    assert_eq!(s.read(&DocId::new(REG)).unwrap(), before);
    assert_eq!(count_decisions(&s), 1);
}

#[test]
fn a_changed_row_is_changed_not_duplicated_and_your_own_row_keeps_you_an_admin() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    import::people(
        &s,
        &admin,
        "cr",
        b"email,name,roles\ncara@cr,Cara Test,admin\ndan@cr,Dan Test,planning\n",
        false,
        &known,
    )
    .unwrap();
    let r = import::people(
        &s,
        &admin,
        "cr",
        b"email,name,roles\ncara@cr,Cara Test,admin\ndan@cr,Dan Test,planning;traffic\n",
        false,
        &known,
    )
    .unwrap();
    assert_eq!((r.created, r.updated, r.unchanged), (0, 1, 1));
    assert_eq!(
        agency::read(&s).unwrap().0.person("dan@cr").unwrap().roles,
        ["planning", "traffic"]
    );
    // a file that would demote the writer is refused on its line, in the dry run too
    let r = import::people(
        &s,
        &admin,
        "cr",
        b"email,name,roles\ncara@cr,Cara Test,planning\n",
        true,
        &known,
    )
    .unwrap();
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].reason.contains("you"));
}

#[test]
fn a_semicolon_file_with_a_byte_order_mark_reads() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(
        b"email;name;roles\nann@cr;Ann Test;planning,traffic\nbo@cr;\"Bo; Test\";admin\n",
    );
    let t = import::read_table(&bytes).unwrap();
    assert_eq!(t.header, ["email", "name", "roles"]);
    assert_eq!(t.rows.len(), 2);
    assert_eq!(t.rows[1].1[1], "Bo; Test");
    let s = MemStore::default();
    let r = import::people(&s, &ctx("bo@cr"), "cr", &bytes, true, &known).unwrap();
    assert_eq!((r.ok, r.errors.len()), (2, 0));
}

#[test]
fn a_file_saved_as_windows_1252_reads_with_its_accents() {
    // "Sean" with a as the single byte 0xE1, and a curly apostrophe (0x92)
    let mut bytes = b"email,name,roles\nsean@cr,Se".to_vec();
    bytes.push(0xE1);
    bytes.extend_from_slice(b"n O");
    bytes.push(0x92);
    bytes.extend_from_slice(b"Test,planning\n");
    let t = import::read_table(&bytes).unwrap();
    assert_eq!(t.rows[0].1[1], "Se\u{e1}n O\u{2019}Test");
}

#[test]
fn a_file_that_cannot_be_read_is_refused_with_one_plain_line() {
    for (bytes, needle) in [
        (people_csv(5001).into_bytes(), "more than 5,000 rows"),
        (vec![b'a'; import::MAX_BYTES + 1], "larger than 1 MB"),
        (b"   \n".to_vec(), "empty"),
        (
            b"email,name,roles\n\"unclosed,Ann,planning\n".to_vec(),
            "never closed",
        ),
    ] {
        let e = import::read_table(&bytes).unwrap_err();
        assert_eq!(e.status, 400);
        assert!(
            e.message.contains(needle),
            "{} should mention {needle}",
            e.message
        );
        assert!(!e.message.contains('\n'));
    }
    let s = MemStore::default();
    let e = import::people(&s, &ctx("a@cr"), "cr", b"who,what\nx,y\n", true, &known).unwrap_err();
    assert!(e.message.contains("email, name and roles"));
    // 5,000 rows is the most
    assert!(import::read_table(people_csv(5000).as_bytes()).is_ok());
}

#[test]
fn a_cell_that_begins_with_a_formula_sign_is_kept_as_text_and_quoted_on_export() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    let csv = "email,name,roles\nann@cr,=HYPERLINK(\"x\"),planning\nbo@cr,+Bo Test,traffic\n";
    let r = import::people(&s, &admin, "cr", csv.as_bytes(), false, &known).unwrap();
    assert_eq!(r.ok, 2);
    let (reg, _) = agency::read(&s).unwrap();
    assert_eq!(reg.person("ann@cr").unwrap().name, "=HYPERLINK(\"x\")");
    assert_eq!(
        import::export_cell("=HYPERLINK(\"x\")"),
        "'=HYPERLINK(\"x\")"
    );
    for c in ["+1", "-1", "@x", "=1"] {
        assert!(import::export_cell(c).starts_with('\''));
    }
    assert_eq!(import::export_cell("Ann Test"), "Ann Test");
}

#[test]
fn clients_import_with_a_dry_run_and_again_changes_nothing() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    let csv = "name\nClient C1\nClient C2\nclient  c1\n\nClient C3\n,\n";
    let dry = import::clients_csv(&s, &admin, csv.as_bytes(), true).unwrap();
    assert_eq!(dry.ok, 3);
    assert_eq!(dry.errors.iter().map(|e| e.line).collect::<Vec<_>>(), [4]);
    assert!(clients::list(&s, true).unwrap().is_empty());
    let r = import::clients_csv(&s, &admin, csv.as_bytes(), false).unwrap();
    assert_eq!(r.created, 3);
    assert_eq!(clients::list(&s, true).unwrap().len(), 3);
    let again = import::clients_csv(&s, &admin, csv.as_bytes(), false).unwrap();
    assert_eq!((again.created, again.unchanged), (0, 3));
    assert_eq!(clients::list(&s, true).unwrap().len(), 3);
}

#[test]
fn jobs_import_against_the_clients_and_list_their_bad_rows() {
    let s = MemStore::default();
    let admin = ctx("cara@cr");
    import::clients_csv(&s, &admin, b"name\nClient C1\nClient C2\n", false).unwrap();
    let csv = "client,title,due,budget_hours,number\n\
Client C1,Launch film,18/12/2026,120,J010\n\
Client C2,Radio spot,2026-12-20,,\n\
Client C9,Not a client,,,\n\
Client C1,Bad date,31/31/2026,,\n\
Client C1,Bad hours,,lots,\n\
Client C1,Repeat,,,J010\n";
    let dry = import::jobs_csv(&s, &admin, csv.as_bytes(), true).unwrap();
    assert_eq!(dry.ok, 2);
    assert_eq!(
        dry.errors.iter().map(|e| e.line).collect::<Vec<_>>(),
        [4, 5, 6, 7]
    );
    assert!(dry.errors[0].reason.contains("unknown client"));
    assert!(jobs::list(&s).unwrap().is_empty());
    let r = import::jobs_csv(&s, &admin, csv.as_bytes(), false).unwrap();
    assert_eq!(r.created, 2);
    let all = jobs::list(&s).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].number, "J010");
    assert_eq!(all[0].due.as_deref(), Some("2026-12-18"));
    assert_eq!(all[0].budget_hours, Some(120.0));
    assert_eq!(all[1].number, "J011");
    let again = import::jobs_csv(&s, &admin, csv.as_bytes(), false).unwrap();
    assert_eq!(
        again.created, 1,
        "the job with no number is new each time; the numbered one is the same"
    );
}
