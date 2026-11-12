// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The alerts table of v2 section 4 and the rules that make its needs (features/needs-you-full.clan).
//!
//! One table, [`ALERTS`]: each event v2 names, who it is for, whether it is urgent, and whether it is
//! live (a [`Rule`] makes its needs) or waiting on a named record. A rule is a pure function of a
//! job's facts and the clock: nothing here reads a document, a store or the time itself, so the index
//! can call it from what it already holds per document, and a test sets the clock.
//!
//! A need's text is built from an allow list: a job number, a client name, a document title, a stage
//! label, a date. It never quotes a document's words or a client's comment, and nothing here can
//! name another person's timesheet.
//!
//! Ids are stable: a need keeps its id for as long as its cause stands (`{job}:{stage}:{who}:{kind}`,
//! and for a notice `:{hash of the document and the cause}`), and an event that happens again has a new
//! cause, so a new id. A person's done mark is keyed on the id.

use chrono::NaiveDate;

use crate::jobindex::{Audience, Need};
use crate::jobs::JobRecord;

/// A deadline is told from 48 hours before it, counted in dates.
pub const DEADLINE_DAYS: i64 = 2;
/// The timesheet reminder comes from this local hour.
pub const TIMESHEET_HOUR: i64 = 16;

/// Which need a rule makes. A kind a person may press Done on is a notice; a task leaves when the work is.
pub const BRIEF_CHANGED: &str = "brief-changed";
pub const CLIENT_CHANGE: &str = "client-change";
pub const DEADLINE: &str = "deadline";
pub const TIMESHEET: &str = "timesheet";

/// Whether a need of `kind` may be marked done by the person it is for.
pub fn can_done(kind: &str) -> bool {
    matches!(kind, BRIEF_CHANGED | CLIENT_CHANGE | DEADLINE | TIMESHEET)
}

/// The rules that are live. A row of the table is `Live(rule)` or `Waiting(record)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rule {
    /// [`brief_changed`].
    BriefChanged,
    /// [`client_change`].
    ClientChange,
    /// [`deadline_soon`].
    DeadlineSoon,
    /// [`timesheet_reminder`].
    Timesheet,
    /// The approval route's own needs (`jobindex::route_needs`): the approver, then the person who set the route.
    ApprovalOverdue,
}

/// Where a row of the table stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Live(Rule),
    /// Not built yet: the record that turns it on.
    Waiting(&'static str),
}

/// One row of v2 section 4's alerts table.
#[derive(Clone, Copy, Debug)]
pub struct AlertRow {
    pub id: &'static str,
    /// The event, as v2 words it.
    pub event: &'static str,
    /// Who is alerted, as v2 words it.
    pub audience: &'static str,
    pub urgent: bool,
    pub state: State,
}

pub const ALERTS: [AlertRow; 8] = [
    AlertRow {
        id: "brief-changes-version",
        event: "Brief changes version",
        audience: "Everyone on the job",
        urgent: false,
        state: State::Live(Rule::BriefChanged),
    },
    AlertRow {
        id: "work-scores-under-24",
        event: "Work scores under 24",
        audience:
            "The creative team on the job, or the creative director if the idea is marked Brave",
        urgent: false,
        state: State::Waiting("judge"),
    },
    AlertRow {
        id: "client-comment-or-change-request",
        event: "Client comment or change request",
        audience: "Account service first",
        urgent: false,
        state: State::Live(Rule::ClientChange),
    },
    AlertRow {
        id: "request-out-of-scope",
        event: "Request out of scope",
        audience: "Account service",
        urgent: false,
        state: State::Waiting("scope (Phase 3)"),
    },
    AlertRow {
        id: "approval-overdue",
        event: "Approval overdue",
        audience: "The approver, then account service",
        urgent: true,
        state: State::Live(Rule::ApprovalOverdue),
    },
    AlertRow {
        id: "job-hours-near-budget",
        event: "Job hours near budget",
        audience: "Producer, account service, management",
        urgent: false,
        state: State::Waiting("confirmed hours (Phase 3)"),
    },
    AlertRow {
        id: "deadline-within-48-hours",
        event: "Deadline within 48 hours",
        audience: "The job owner",
        urgent: true,
        state: State::Live(Rule::DeadlineSoon),
    },
    AlertRow {
        id: "timesheet-not-confirmed",
        event: "Today's timesheet not confirmed",
        audience: "That person, once",
        urgent: false,
        state: State::Live(Rule::Timesheet),
    },
];

// ── ids ─────────────────────────────────────────────────────────────────────

/// A stable hash (FNV-1a, 64 bit) of `parts`, as 10 hex digits. Not `DefaultHasher`: a mark kept on
/// disk must mean the same thing after the next Rust release.
pub fn short_hash(parts: &[&str]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in p.bytes().chain(std::iter::once(0u8)) {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{:010x}", h & 0xff_ffff_ffff)
}

/// A notice's id: what it is about, and what caused it (the document and a decision or a date).
fn notice_id(job: &str, stage: &str, who: &str, kind: &str, path: &str, cause: &str) -> String {
    format!(
        "{job}:{stage}:{who}:{kind}:{}",
        short_hash(&[job, kind, path, cause])
    )
}

// ── the deadline of a need ──────────────────────────────────────────────────

/// A need's own deadline: the stage's, when the job's approval route has a step for the stage, else
/// the job's. The second is where it came from (`stage` or `job`).
pub fn due_of(rec: &JobRecord, stage: &str) -> (Option<String>, &'static str) {
    match rec.route.iter().find(|s| s.stage == stage) {
        Some(step) => (Some(step.due.clone()), "stage"),
        None => (rec.due.clone(), "job"),
    }
}

/// Whole days from `today` to a `YYYY-MM-DD` date; negative when it has passed.
pub fn days_until(due: &str, today: NaiveDate) -> Option<i64> {
    NaiveDate::parse_from_str(due, "%Y-%m-%d")
        .ok()
        .map(|d| (d - today).num_days())
}

/// Finish a need: whether it is urgent (due within 48 hours, or past) and whether Done is offered.
pub fn finish(need: &mut Need, today: NaiveDate) {
    need.can_done = can_done(need.kind);
    need.urgent = need
        .due
        .as_deref()
        .and_then(|d| days_until(d, today))
        .is_some_and(|n| n <= DEADLINE_DAYS);
}

// ── the rules ───────────────────────────────────────────────────────────────

/// What a rule needs to know about the job it speaks of.
pub struct Subject<'a> {
    pub rec: &'a JobRecord,
    pub client_name: &'a str,
}

#[allow(clippy::too_many_arguments)]
fn need(
    s: &Subject,
    kind: &'static str,
    stage: &str,
    who: &str,
    cause: (&str, &str),
    text: String,
    action: &str,
    audience: Audience,
) -> Need {
    let (due, due_source) = due_of(s.rec, stage);
    Need {
        id: notice_id(&s.rec.number, stage, who, kind, cause.0, cause.1),
        kind,
        stage: stage.to_string(),
        days_late: None,
        job: s.rec.number.clone(),
        client: s.client_name.to_string(),
        client_id: s.rec.client_id.clone(),
        text,
        action: action.to_string(),
        path: cause.0.to_string(),
        due,
        due_source,
        urgent: false,
        can_done: can_done(kind),
        audience,
    }
}

/// Brief changes version: the brief was edited after it was signed. For everyone on the job. The cause
/// is the newest edit, so a brief edited again is a new notice.
pub fn brief_changed(s: &Subject, title: &str, path: &str, cause: &str) -> Need {
    need(
        s,
        BRIEF_CHANGED,
        "brief-check",
        "everyone",
        (path, cause),
        format!("{title}: the brief has a new version since it was signed."),
        "Open the brief",
        Audience::Job,
    )
}

/// Client comment or change request: the client answered with changes, or turned it down. Account
/// service first. The cause is the client's answer; its words are never in the text.
pub fn client_change(s: &Subject, stage: &str, title: &str, path: &str, answer_id: &str) -> Need {
    need(
        s,
        CLIENT_CHANGE,
        stage,
        "account_service",
        (path, answer_id),
        format!("{title}: the client has asked for changes."),
        "Open the document",
        Audience::Role("account-service"),
    )
}

/// Deadline within 48 hours: the job's deadline is today or in the next two days. For the job owner.
/// A passed deadline is the dashboard's at-risk line, not a notice. The cause is the date, so a moved
/// deadline is a new notice.
pub fn deadline_soon(s: &Subject, today: NaiveDate) -> Option<Need> {
    let due = s.rec.due.as_deref()?;
    let left = days_until(due, today)?;
    if !(0..=DEADLINE_DAYS).contains(&left) {
        return None;
    }
    let when = match left {
        0 => "today".to_string(),
        1 => "tomorrow".to_string(),
        _ => format!("on {due}"),
    };
    Some(need(
        s,
        DEADLINE,
        "deadline",
        "owner",
        ("", due),
        format!("{} is due {when}.", s.rec.number),
        "Open the job",
        Audience::Person(s.rec.owner.clone()),
    ))
}

/// Today's timesheet not confirmed: the caller's own, from 16:00 local time, once the person has been
/// asked about timesheets (either answer) and has not confirmed the day. Built for the person it is
/// for, from their own day, and for nobody else.
pub fn timesheet_reminder(
    person: &str,
    date: &str,
    local_hour: i64,
    asked: bool,
    confirmed: bool,
) -> Option<Need> {
    if !asked || confirmed || local_hour < TIMESHEET_HOUR {
        return None;
    }
    Some(Need {
        id: format!("timesheet:{}", short_hash(&["timesheet", person, date])),
        kind: TIMESHEET,
        stage: "timesheets".to_string(),
        days_late: None,
        job: String::new(),
        client: String::new(),
        client_id: String::new(),
        text: "Today's timesheet is not confirmed.".to_string(),
        action: "Open your timesheet".to_string(),
        path: String::new(),
        due: Some(date.to_string()),
        due_source: "day",
        urgent: false,
        can_done: true,
        audience: Audience::Person(person.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::RouteStep;

    fn rec(due: Option<&str>, route: Vec<RouteStep>) -> JobRecord {
        JobRecord {
            number: "J001".into(),
            client_id: "cli_1".into(),
            title: "J001 brief".into(),
            owner: "aoife@wk".into(),
            opened_on: "2026-11-02".into(),
            due: due.map(str::to_string),
            budget_hours: None,
            created_at: "2026-11-02T09:00:00Z".into(),
            route,
        }
    }

    fn step(stage: &str, due: &str) -> RouteStep {
        RouteStep {
            stage: stage.into(),
            party: "agency".into(),
            role: None,
            approver: "dara@wk".into(),
            contact: None,
            due: due.into(),
            rounds: None,
        }
    }

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn every_row_is_live_with_a_rule_or_names_its_record() {
        let mut ids = std::collections::BTreeSet::new();
        for row in ALERTS {
            assert!(ids.insert(row.id), "{} twice", row.id);
            match row.state {
                State::Live(Rule::ApprovalOverdue) => {}
                State::Live(r) => {
                    // each live rule has a function above; this match breaks when a rule is added without one
                    match r {
                        Rule::BriefChanged
                        | Rule::ClientChange
                        | Rule::DeadlineSoon
                        | Rule::Timesheet => {}
                        Rule::ApprovalOverdue => unreachable!(),
                    }
                }
                State::Waiting(record) => {
                    assert!(!record.trim().is_empty(), "{} waits on nothing", row.id)
                }
            }
        }
        // v2 section 4 names eight events
        assert_eq!(ALERTS.len(), 8);
        let live = ALERTS
            .iter()
            .filter(|r| matches!(r.state, State::Live(_)))
            .count();
        assert_eq!(live, 5, "five live rows, three waiting");
    }

    #[test]
    fn a_stage_deadline_beats_the_jobs_and_the_jobs_stands_in_without_a_route() {
        let plain = rec(Some("2026-12-18"), vec![]);
        assert_eq!(
            due_of(&plain, "brief-check"),
            (Some("2026-12-18".into()), "job")
        );
        let routed = rec(Some("2026-12-18"), vec![step("brief-check", "2026-11-20")]);
        assert_eq!(
            due_of(&routed, "brief-check"),
            (Some("2026-11-20".into()), "stage")
        );
        assert_eq!(due_of(&routed, "decks"), (Some("2026-12-18".into()), "job"));
        assert_eq!(due_of(&rec(None, vec![]), "decks"), (None, "job"));
    }

    #[test]
    fn the_deadline_rule_fires_inside_48_hours_and_not_before_or_after() {
        for (due, today, fires) in [
            ("2026-11-14", "2026-11-12", true),
            ("2026-11-13", "2026-11-12", true),
            ("2026-11-12", "2026-11-12", true),
            ("2026-11-15", "2026-11-12", false),
            ("2026-11-11", "2026-11-12", false),
        ] {
            let r = rec(Some(due), vec![]);
            let s = Subject {
                rec: &r,
                client_name: "Client A",
            };
            let n = deadline_soon(&s, day(today));
            assert_eq!(n.is_some(), fires, "due {due} on {today}");
            if let Some(mut n) = n {
                finish(&mut n, day(today));
                assert!(n.urgent && n.can_done);
                assert_eq!(n.audience, Audience::Person("aoife@wk".into()));
                assert_eq!(n.due_source, "job");
            }
        }
        let none = rec(None, vec![]);
        assert!(deadline_soon(
            &Subject {
                rec: &none,
                client_name: "x"
            },
            day("2026-11-12")
        )
        .is_none());
    }

    #[test]
    fn an_id_holds_while_the_cause_stands_and_changes_with_the_cause() {
        let r = rec(Some("2026-12-18"), vec![]);
        let s = Subject {
            rec: &r,
            client_name: "Client A",
        };
        let a = brief_changed(&s, "J001 brief", "documents/b.clan", "d_edit_1");
        let b = brief_changed(&s, "J001 brief", "documents/b.clan", "d_edit_1");
        let c = brief_changed(&s, "J001 brief", "documents/b.clan", "d_edit_2");
        assert_eq!(a.id, b.id);
        assert_ne!(a.id, c.id);
        assert!(a.id.starts_with("J001:brief-check:everyone:brief-changed:"));
        let old = rec(Some("2026-12-18"), vec![]);
        let moved = rec(Some("2026-12-20"), vec![]);
        let d1 = deadline_soon(
            &Subject {
                rec: &old,
                client_name: "x",
            },
            day("2026-12-17"),
        )
        .unwrap();
        let d2 = deadline_soon(
            &Subject {
                rec: &moved,
                client_name: "x",
            },
            day("2026-12-19"),
        )
        .unwrap();
        assert_ne!(d1.id, d2.id, "a moved deadline is a new notice");
        assert_eq!(short_hash(&["a", "b"]), short_hash(&["a", "b"]));
        assert_ne!(short_hash(&["ab", ""]), short_hash(&["a", "b"]));
    }

    #[test]
    fn a_notice_offers_done_and_a_task_does_not() {
        for k in [BRIEF_CHANGED, CLIENT_CHANGE, DEADLINE, TIMESHEET] {
            assert!(can_done(k), "{k}");
        }
        for k in ["gate", "approval", "approval-chase"] {
            assert!(!can_done(k), "{k}");
        }
    }

    #[test]
    fn the_client_change_notice_goes_to_account_service_and_holds_no_words_of_the_client() {
        let r = rec(Some("2026-12-18"), vec![]);
        let s = Subject {
            rec: &r,
            client_name: "Client A",
        };
        let n = client_change(
            &s,
            "brief-check",
            "J001 brief",
            "documents/b.clan",
            "d_answer",
        );
        assert_eq!(n.audience, Audience::Role("account-service"));
        assert_eq!(n.text, "J001 brief: the client has asked for changes.");
        assert_eq!(n.kind, CLIENT_CHANGE);
    }

    #[test]
    fn the_timesheet_reminder_needs_a_question_asked_an_unconfirmed_day_and_the_afternoon() {
        let n = |asked, confirmed, hour| {
            timesheet_reminder("maeve@wk", "2026-11-12", hour, asked, confirmed)
        };
        assert!(n(true, false, 16).is_some());
        assert!(n(true, false, 23).is_some());
        assert!(n(true, false, 15).is_none(), "before 16:00");
        assert!(n(true, true, 17).is_none(), "confirmed");
        assert!(n(false, false, 17).is_none(), "never asked");
        let a = n(true, false, 17).unwrap();
        let b = timesheet_reminder("maeve@wk", "2026-11-13", 17, true, false).unwrap();
        assert_ne!(a.id, b.id, "one a day");
        assert_eq!(a.audience, Audience::Person("maeve@wk".into()));
    }
}
