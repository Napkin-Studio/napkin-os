// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! CSV import of people, clients and jobs (features/agency-setup.clan).
//!
//! Every import has a **dry run**: the file is read and every row checked against what the
//! agency already holds, and a result per row comes back (new, changed, the same, or an error with
//! its line number and the reason), with nothing written. The same call without `dry_run` writes
//! the rows that are fine and lists the ones that are not. A file is one registry write for people
//! (`agency::upsert_people`); clients and jobs are made one pass under the registries' own locks,
//! and a failure partway says which rows were made.
//!
//! The reader is pure (no `std::fs`, no parser crate), so it builds for wasm32. It strips a byte
//! order mark, reads UTF-8 or else Windows-1252, finds a comma, semicolon or tab from the header,
//! keeps every cell as text, and refuses a file over 1 MB or 5,000 rows with one plain line. A
//! cell that begins with `=`, `+`, `-` or `@` is stored as typed; [`export_cell`] puts a quote in
//! front of it whenever a list is written out, so a spreadsheet never runs it.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::agency::{self, NewPerson};
use crate::clients;
use crate::ctx::Ctx;
use crate::error::{HostError, HostResult};
use crate::jobs::{self, NewJob};
use crate::store::DocStore;

pub const MAX_BYTES: usize = 1024 * 1024;
pub const MAX_ROWS: usize = 5000;

/// A parsed file: its header (lower case) and its rows, each with the line it began on.
#[derive(Debug, Clone)]
pub struct Table {
    pub header: Vec<String>,
    pub rows: Vec<(usize, Vec<String>)>,
}

impl Table {
    fn col(&self, names: &[&str]) -> Option<usize> {
        names
            .iter()
            .find_map(|n| self.header.iter().position(|h| h == n))
    }
}

/// The text of a cell as it must be written to a spreadsheet: one that would be read as a formula
/// gets a quote in front.
pub fn export_cell(s: &str) -> String {
    if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    }
}

/// Windows-1252 for the bytes that are not Latin-1: `0x80` to `0x9F`.
const CP1252: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
];

fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes
            .iter()
            .map(|&b| match b {
                0x80..=0x9F => CP1252[(b - 0x80) as usize],
                _ => b as char,
            })
            .collect(),
    }
}

/// The delimiter the header line uses: whichever of comma, semicolon and tab it holds most of
/// outside quotes (a comma when none).
fn delimiter(first: &str) -> char {
    let mut counts = [(',', 0), (';', 0), ('\t', 0)];
    let mut quoted = false;
    for c in first.chars() {
        if c == '"' {
            quoted = !quoted;
        } else if !quoted {
            for (d, n) in counts.iter_mut() {
                if c == *d {
                    *n += 1;
                }
            }
        }
    }
    counts
        .iter()
        .max_by_key(|(_, n)| *n)
        .filter(|(_, n)| *n > 0)
        .map_or(',', |(d, _)| *d)
}

/// Read a file into a table. The errors are the one plain line a person is shown.
pub fn read_table(bytes: &[u8]) -> HostResult<Table> {
    if bytes.len() > MAX_BYTES {
        return Err(HostError::bad_request(
            "That file is larger than 1 MB. Split it and import it in parts.",
        ));
    }
    let text = decode(bytes);
    if text.trim().is_empty() {
        return Err(HostError::bad_request("That file is empty."));
    }
    let delim = delimiter(text.lines().next().unwrap_or(""));
    // records, each with the line it starts on
    let mut records: Vec<(usize, Vec<String>)> = Vec::new();
    let mut line = 1usize;
    let mut start = 1usize;
    let mut cell = String::new();
    let mut row: Vec<String> = Vec::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    let mut any = false;
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    chars.next();
                    cell.push('"');
                }
                '"' => quoted = false,
                '\n' => {
                    line += 1;
                    cell.push('\n');
                }
                _ => cell.push(c),
            }
            continue;
        }
        match c {
            '"' if cell.is_empty() => {
                quoted = true;
                any = true;
            }
            c if c == delim => {
                row.push(std::mem::take(&mut cell));
                any = true;
            }
            '\r' => {}
            '\n' => {
                if any || !cell.is_empty() || !row.is_empty() {
                    row.push(std::mem::take(&mut cell));
                    records.push((start, std::mem::take(&mut row)));
                }
                any = false;
                line += 1;
                start = line;
            }
            _ => {
                cell.push(c);
                any = true;
            }
        }
    }
    if quoted {
        return Err(HostError::bad_request(
            "A quote opened in that file is never closed. Check the line it starts on.",
        ));
    }
    if any || !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        records.push((start, row));
    }
    let mut it = records.into_iter();
    let (_, head) = it
        .next()
        .ok_or_else(|| HostError::bad_request("That file is empty."))?;
    let header: Vec<String> = head.iter().map(|h| h.trim().to_lowercase()).collect();
    let rows: Vec<(usize, Vec<String>)> = it
        .filter(|(_, r)| r.iter().any(|c| !c.trim().is_empty()))
        .collect();
    if rows.len() > MAX_ROWS {
        return Err(HostError::bad_request(
            "That file has more than 5,000 rows. Split it and import it in parts.",
        ));
    }
    Ok(Table { header, rows })
}

// ── what an import returns ──────────────────────────────────────────────────

/// What a row came to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    New,
    Changed,
    Same,
    Error,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RowResult {
    pub line: usize,
    pub status: Status,
    /// What the row is: a sign-in name, a client's name, a job number or title.
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RowError {
    pub line: usize,
    pub reason: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Report {
    pub kind: &'static str,
    pub dry_run: bool,
    /// Rows in the file, after its header.
    pub rows: usize,
    /// Rows that are fine.
    pub ok: usize,
    pub errors: Vec<RowError>,
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
    /// Whether anything was written.
    pub committed: bool,
    pub results: Vec<RowResult>,
    /// People only: the agency has no directory yet, so importing starts one, and from then on only
    /// the people on it sign in.
    pub starts_directory: bool,
    /// Clients and jobs made before a failure stopped the commit; empty when it did not.
    pub made_before_failure: Vec<usize>,
}

impl Report {
    fn new(kind: &'static str, dry_run: bool, table: &Table) -> Self {
        Report {
            kind,
            dry_run,
            rows: table.rows.len(),
            ok: 0,
            errors: Vec::new(),
            created: 0,
            updated: 0,
            unchanged: 0,
            committed: false,
            results: Vec::new(),
            starts_directory: false,
            made_before_failure: Vec::new(),
        }
    }

    fn push(&mut self, line: usize, status: Status, label: String, reason: Option<String>) {
        if status == Status::Error {
            self.errors.push(RowError {
                line,
                reason: reason.clone().unwrap_or_default(),
            });
        } else {
            self.ok += 1;
        }
        self.results.push(RowResult {
            line,
            status,
            label,
            reason,
        });
    }
}

fn cell(row: &[String], i: Option<usize>) -> &str {
    i.and_then(|i| row.get(i)).map_or("", |c| c.trim())
}

// ── people ──────────────────────────────────────────────────────────────────

fn split_roles(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in raw
        .split(|c: char| matches!(c, ',' | ';' | '|') || c.is_whitespace())
        .map(|r| r.trim().to_ascii_lowercase())
        .filter(|r| !r.is_empty())
    {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

/// The sign-in name for a row: the file's `username` column, else the email's local part at this
/// agency (`dara@wk.example` and `dara@wk` both make `dara@wk`).
fn username_of(agency_slug: &str, username: &str, email: &str) -> Result<String, String> {
    let local = if username.is_empty() {
        email.split('@').next().unwrap_or("")
    } else {
        username.split('@').next().unwrap_or("")
    };
    let local = local.trim().to_ascii_lowercase();
    let ok = !local.is_empty()
        && local.len() <= 64
        && local
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c));
    if ok {
        Ok(format!("{local}@{agency_slug}"))
    } else {
        Err("a sign-in name cannot be made from this email; add a username column".into())
    }
}

/// Import people. `agency_slug` is the signed-in agency (every person joins it); `known` says
/// which roles exist. The acting admin is never taken off the list or demoted by their own file.
pub fn people(
    store: &dyn DocStore,
    ctx: &Ctx,
    agency_slug: &str,
    bytes: &[u8],
    dry_run: bool,
    known: &dyn Fn(&str) -> bool,
) -> HostResult<Report> {
    let table = read_table(bytes)?;
    let (Some(email_c), Some(roles_c)) = (
        table.col(&["email", "e-mail", "email address"]),
        table.col(&["roles", "role"]),
    ) else {
        return Err(HostError::bad_request(
            "The first line must name the columns: email, name and roles.",
        ));
    };
    let name_c = table.col(&["name", "full name"]);
    let user_c = table.col(&["username", "sign-in", "sign-in name"]);
    let me = ctx
        .actor
        .as_str()
        .strip_prefix("human:")
        .unwrap_or("")
        .to_string();
    let (reg, _) = agency::read(store)?;
    let mut report = Report::new("people", dry_run, &table);
    report.starts_directory = !reg.has_directory();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut good: Vec<(usize, NewPerson)> = Vec::new();
    for (line, row) in &table.rows {
        let line = *line;
        let email = cell(row, Some(email_c));
        let name = cell(row, name_c);
        let label = if email.is_empty() {
            format!("line {line}")
        } else {
            email.to_string()
        };
        let fail = |report: &mut Report, why: String| {
            report.push(line, Status::Error, label.clone(), Some(why))
        };
        if email.is_empty() {
            fail(&mut report, "missing email".into());
            continue;
        }
        let email = match agency::clean_email(email) {
            Ok(e) => e,
            Err(_) => {
                fail(
                    &mut report,
                    "the email does not look like name@place".into(),
                );
                continue;
            }
        };
        if name.is_empty() {
            fail(&mut report, "missing name".into());
            continue;
        }
        let name = match agency::clean_person_name(name) {
            Ok(n) => n,
            Err(e) => {
                fail(&mut report, e.message);
                continue;
            }
        };
        let roles = split_roles(cell(row, Some(roles_c)));
        if roles.is_empty() {
            fail(&mut report, "missing role".into());
            continue;
        }
        if let Some(bad) = roles.iter().find(|r| !known(r)) {
            fail(&mut report, format!("unknown role: {bad}"));
            continue;
        }
        let username = match username_of(agency_slug, cell(row, user_c), &email) {
            Ok(u) => u,
            Err(why) => {
                fail(&mut report, why);
                continue;
            }
        };
        if let Some(first) = seen.get(&username) {
            fail(&mut report, format!("duplicate of line {first}"));
            continue;
        }
        if username == me && !roles.iter().any(|r| r == agency::ADMIN) {
            fail(
                &mut report,
                "this is you: keep the admin role in your own row".into(),
            );
            continue;
        }
        seen.insert(username.clone(), line);
        let status = match reg.person(&username) {
            None => Status::New,
            Some(p) if p.state == agency::State::Removed => Status::New,
            Some(p) if p.name == name && p.email == email && p.roles == roles => Status::Same,
            Some(_) => Status::Changed,
        };
        report.push(line, status, username.clone(), None);
        good.push((
            line,
            NewPerson {
                username,
                name,
                email,
                roles,
            },
        ));
    }
    for r in &report.results {
        match r.status {
            Status::New => report.created += 1,
            Status::Changed => report.updated += 1,
            Status::Same => report.unchanged += 1,
            Status::Error => {}
        }
    }
    if dry_run || good.is_empty() {
        return Ok(report);
    }
    let out = agency::upsert_people(
        store,
        ctx,
        good.into_iter().map(|(_, p)| p).collect(),
        known,
    )?;
    report.created = out.created;
    report.updated = out.updated;
    report.unchanged = out.unchanged;
    report.committed = out.created + out.updated > 0 || report.starts_directory;
    Ok(report)
}

// ── clients ─────────────────────────────────────────────────────────────────

/// Import clients: a `name` column, and an optional `material`. A client already in the registry
/// (whatever its case or spacing) is left as it is: the same file twice changes nothing.
pub fn clients_csv(
    store: &dyn DocStore,
    ctx: &Ctx,
    bytes: &[u8],
    dry_run: bool,
) -> HostResult<Report> {
    let table = read_table(bytes)?;
    let Some(name_c) = table.col(&["name", "client", "client name"]) else {
        return Err(HostError::bad_request(
            "The first line must name the columns: name, and optionally material.",
        ));
    };
    let material_c = table.col(&["material"]);
    let have: HashSet<String> = clients::list(store, true)?
        .iter()
        .map(|c| clients::name_key(&c.name))
        .collect();
    let mut report = Report::new("clients", dry_run, &table);
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut todo: Vec<(usize, String, Option<String>)> = Vec::new();
    for (line, row) in &table.rows {
        let line = *line;
        let raw = cell(row, Some(name_c));
        let name = match clients::clean_name(raw) {
            Ok(n) => n,
            Err(e) => {
                let label = if raw.is_empty() {
                    format!("line {line}")
                } else {
                    raw.to_string()
                };
                report.push(
                    line,
                    Status::Error,
                    label,
                    Some(e.message.replace("a client needs a name", "missing name")),
                );
                continue;
            }
        };
        let key = clients::name_key(&name);
        if let Some(first) = seen.get(&key) {
            report.push(
                line,
                Status::Error,
                name,
                Some(format!("duplicate of line {first}")),
            );
            continue;
        }
        seen.insert(key.clone(), line);
        let material = Some(cell(row, material_c).to_lowercase()).filter(|m| !m.is_empty());
        if let Some(m) = &material {
            if !clients::MATERIALS.contains(&m.as_str()) {
                report.push(
                    line,
                    Status::Error,
                    name,
                    Some(format!("unknown material: {m}")),
                );
                continue;
            }
        }
        if have.contains(&key) {
            report.push(line, Status::Same, name, None);
            report.unchanged += 1;
        } else {
            report.push(line, Status::New, name.clone(), None);
            todo.push((line, name, material));
        }
    }
    report.created = todo.len();
    if dry_run {
        return Ok(report);
    }
    for (line, name, material) in todo {
        match clients::create_client(store, ctx, &name, material.as_deref()) {
            Ok(_) => {
                report.made_before_failure.push(line);
                report.committed = true;
            }
            Err(e) => {
                let made = report.made_before_failure.len();
                report.created = made;
                report.errors.push(RowError {
                    line,
                    reason: format!("stopped here after {made} made: {}", e.message),
                });
                return Ok(report);
            }
        }
    }
    report.made_before_failure.clear();
    Ok(report)
}

// ── jobs ────────────────────────────────────────────────────────────────────

/// A date as the registry keeps it, from `2026-12-18` or `18/12/2026`.
fn date_of(s: &str) -> Option<String> {
    let s = s.trim();
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.format("%Y-%m-%d").to_string());
    }
    chrono::NaiveDate::parse_from_str(s, "%d/%m/%Y")
        .ok()
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// Import jobs: `client` (a client's name, which must exist), and optionally `number`, `title`,
/// `owner`, `opened_on`, `due` and `budget_hours`. A number already in the registry is left as it
/// is. Run it after the clients.
pub fn jobs_csv(
    store: &dyn DocStore,
    ctx: &Ctx,
    bytes: &[u8],
    dry_run: bool,
) -> HostResult<Report> {
    let table = read_table(bytes)?;
    let Some(client_c) = table.col(&["client", "client name"]) else {
        return Err(HostError::bad_request(
            "The first line must name the columns: client, and optionally number, title, owner, opened_on, due and budget_hours.",
        ));
    };
    let number_c = table.col(&["number", "job", "job number"]);
    let title_c = table.col(&["title"]);
    let owner_c = table.col(&["owner"]);
    let opened_c = table.col(&["opened_on", "opened"]);
    let due_c = table.col(&["due", "deadline"]);
    let hours_c = table.col(&["budget_hours", "hours"]);
    let by_name: HashMap<String, clients::ClientRecord> = clients::list(store, true)?
        .into_iter()
        .map(|c| (clients::name_key(&c.name), c))
        .collect();
    let have: HashSet<String> = jobs::list(store)?.into_iter().map(|j| j.number).collect();
    let mut report = Report::new("jobs", dry_run, &table);
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut todo: Vec<(usize, NewJob)> = Vec::new();
    for (line, row) in &table.rows {
        let line = *line;
        let number = cell(row, number_c).to_ascii_uppercase();
        let title = cell(row, title_c);
        let client_name = cell(row, Some(client_c));
        let label = if !number.is_empty() {
            number.clone()
        } else if !title.is_empty() {
            title.to_string()
        } else {
            format!("line {line}")
        };
        let fail = |report: &mut Report, why: String| {
            report.push(line, Status::Error, label.clone(), Some(why))
        };
        if client_name.is_empty() {
            fail(&mut report, "missing client".into());
            continue;
        }
        let Some(client) = by_name.get(&clients::name_key(client_name)) else {
            fail(
                &mut report,
                format!("unknown client: {client_name}; import the clients first"),
            );
            continue;
        };
        if client.is_archived() {
            fail(&mut report, format!("{client_name} is archived"));
            continue;
        }
        if !number.is_empty() && !jobs::is_job_number(&number) {
            fail(
                &mut report,
                "a job number is J and three to six digits, like J001".into(),
            );
            continue;
        }
        if !number.is_empty() {
            if let Some(first) = seen.get(&number) {
                fail(&mut report, format!("duplicate of line {first}"));
                continue;
            }
            seen.insert(number.clone(), line);
        }
        let date = |c: Option<usize>, what: &str| -> Result<Option<String>, String> {
            let raw = cell(row, c);
            if raw.is_empty() {
                return Ok(None);
            }
            date_of(raw)
                .map(Some)
                .ok_or_else(|| format!("{what} is a date, like 2026-12-18 or 18/12/2026"))
        };
        let (opened_on, due) = match (date(opened_c, "opened_on"), date(due_c, "due")) {
            (Ok(o), Ok(d)) => (o, d),
            (Err(e), _) | (_, Err(e)) => {
                fail(&mut report, e);
                continue;
            }
        };
        let budget_hours = match cell(row, hours_c) {
            "" => None,
            h => match h.replace(',', ".").parse::<f64>() {
                Ok(v) if v.is_finite() && v >= 0.0 => Some(v),
                _ => {
                    fail(&mut report, "budget_hours is a number of hours".into());
                    continue;
                }
            },
        };
        if !number.is_empty() && have.contains(&number) {
            report.push(line, Status::Same, label.clone(), None);
            report.unchanged += 1;
            continue;
        }
        report.push(line, Status::New, label.clone(), None);
        todo.push((
            line,
            NewJob {
                number: (!number.is_empty()).then_some(number),
                client_id: client.id.clone(),
                title: (!title.is_empty()).then(|| title.to_string()),
                owner: Some(cell(row, owner_c).to_string()).filter(|o| !o.is_empty()),
                opened_on,
                due,
                budget_hours,
            },
        ));
    }
    report.created = todo.len();
    if dry_run {
        return Ok(report);
    }
    for (line, job) in todo {
        match jobs::create_job(store, ctx, job) {
            Ok(_) => {
                report.made_before_failure.push(line);
                report.committed = true;
            }
            Err(e) => {
                let made = report.made_before_failure.len();
                report.created = made;
                report.errors.push(RowError {
                    line,
                    reason: format!("stopped here after {made} made: {}", e.message),
                });
                return Ok(report);
            }
        }
    }
    report.made_before_failure.clear();
    Ok(report)
}
