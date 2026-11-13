// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Roles, homes and the one permission check (features/roles-and-homes.clan).
//!
//! A person has one or more roles, carried by the signed session. Two things
//! read them and nothing else does:
//!
//! - [`Table::home_for`] turns the roles into one home: at most five doors,
//!   the rest under More tools, and the O's department circles. The shell
//!   draws whatever it is sent.
//! - [`allowed`] is the permission check: `(roles, route, client)`, called by
//!   [`guard`] on every shell API request. Seeing is not permission (v2
//!   section 4): hiding a door in the browser is not enough, so a role that may
//!   not open a route gets 403 from here.
//!
//! The table is data. [`Table::default`] is the v2 section 4 table; an agency
//! may serve its own as `roles/<agency>.json` in the config directory.
//! A person with no roles at all is unrestricted, as every person was before
//! roles existed, until the roster is filled in.

use std::path::Path;

use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::auth::Account;

/// No role is offered more than five page doors on the desk's row; the rest are listed under More.
pub const MAX_DOORS: usize = 5;

/// The role of an admin and of a demo account. Both open every route and see
/// every home through the role switcher; nobody else gets the switcher.
pub const ADMIN: &str = "admin";
pub const DEMO: &str = "demo";

/// A door, or a line under More tools: its id (the shell keys the tool and its
/// Empty state on it) and the words on it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
}

/// One role's home.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Home {
    pub role: String,
    /// What the home is called: `Planning`, `Creative director`.
    pub title: String,
    pub department: String,
    /// Whether the home is switched on. All nine of the default table are; nothing reads it yet,
    /// and it is kept as the place for an agency's own table to hide a home.
    pub live: bool,
    pub doors: Vec<Entry>,
    pub more: Vec<Entry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Department {
    pub id: String,
    pub name: String,
    /// The roles that may open it. A role of the department always may.
    #[serde(default)]
    pub open_to: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    pub homes: Vec<Home>,
    /// The seven departments, in the order the O lists them.
    pub departments: Vec<Department>,
}

/// The tool (a landing/tools.ts id) a door opens for a client, when it is one.
pub fn tool_of(door: &str) -> Option<&'static str> {
    Some(match door {
        "brief" => "brief",
        "research" => "research",
        "territories" => "territories",
        "presentations" => "deck",
        "ideas" => "idea",
        "script-editor" => "script",
        _ => return None,
    })
}

fn e(id: &str, name: &str) -> Entry {
    Entry {
        id: id.into(),
        name: name.into(),
    }
}

fn home(
    role: &str,
    title: &str,
    department: &str,
    live: bool,
    doors: &[(&str, &str)],
    more: &[(&str, &str)],
) -> Home {
    Home {
        role: role.into(),
        title: title.into(),
        department: department.into(),
        live,
        doors: doors.iter().map(|(i, n)| e(i, n)).collect(),
        more: more.iter().map(|(i, n)| e(i, n)).collect(),
    }
}

impl Default for Table {
    /// The doors table of v2 section 4.
    fn default() -> Self {
        let homes = vec![
            home(
                "planning",
                "Planning",
                "planning",
                true,
                &[
                    ("brief", "Brief"),
                    ("research", "Research"),
                    ("territories", "Territories"),
                    ("client-brains", "Client brains"),
                    ("presentations", "Presentations"),
                ],
                &[
                    ("ideas", "Ideas (read only)"),
                    ("case-study-builder", "Case study builder (read only)"),
                ],
            ),
            home(
                "creative-director",
                "Creative director",
                "creative",
                true,
                &[
                    ("ideas", "Ideas"),
                    ("ready-for-review", "Ready for review"),
                    ("judge-scores", "Judge scores"),
                    ("approved-work", "Approved work"),
                    ("direction-notes", "Direction notes"),
                ],
                &[
                    ("brief", "Brief (read and sign)"),
                    ("presentations", "Presentations"),
                    ("traffic-board", "Traffic board (read only)"),
                ],
            ),
            home(
                "account-service",
                "Account service",
                "account-service",
                true,
                &[
                    ("clients", "Clients"),
                    ("live-jobs", "Live jobs"),
                    ("approvals", "Approvals"),
                    ("scope-estimates", "Scope and estimates"),
                    ("presentations", "Presentations"),
                ],
                &[
                    ("case-study-builder", "Case study builder"),
                    ("job-memory", "Job memory"),
                    ("compliance-watch", "Compliance night watch"),
                ],
            ),
            home(
                "management",
                "Management",
                "management",
                true,
                &[
                    ("agency-dashboard", "Agency dashboard"),
                    ("live-jobs", "Live jobs"),
                    ("time-money", "Time and money"),
                    ("clients", "Clients"),
                    ("traffic-board", "Traffic board"),
                ],
                &[
                    ("presentations", "Presentations"),
                    ("agency-brain", "Agency Brain (read only)"),
                ],
            ),
            home(
                "art-director",
                "Art director",
                "creative",
                true,
                &[
                    ("ideas", "Ideas"),
                    ("stills", "Stills"),
                    ("video-motion", "Video and motion"),
                    ("formats-in-situ", "Formats and in situ"),
                    ("shopper-stands", "Shopper stands"),
                ],
                &[
                    ("experiential", "Experiential"),
                    ("presentations", "Presentations"),
                    ("craft-review", "Craft review"),
                ],
            ),
            home(
                "copywriter",
                "Copywriter",
                "creative",
                true,
                &[
                    ("ideas", "Ideas"),
                    ("script-editor", "Script editor"),
                    ("radio", "Radio"),
                    ("video-motion", "Video and motion"),
                    ("formats-in-situ", "Formats and in situ"),
                ],
                &[
                    ("shopper-stands", "Shopper stands"),
                    ("experiential", "Experiential"),
                    ("presentations", "Presentations"),
                    ("craft-review", "Craft review"),
                ],
            ),
            home(
                "producer",
                "Producer",
                "production",
                true,
                &[
                    ("live-jobs", "Live jobs"),
                    ("video-motion", "Video and motion"),
                    ("radio", "Radio"),
                    ("scope-estimates", "Scope and estimates"),
                    ("timetables", "Timetables"),
                ],
                &[
                    ("formats-in-situ", "Formats and in situ"),
                    ("shopper-stands", "Shopper stands"),
                    ("traffic-board", "Traffic board"),
                ],
            ),
            home(
                "agency-brain",
                "Agency Brain",
                "agency-brain",
                true,
                &[
                    ("client-brains", "Client brains"),
                    ("pitches", "Pitches"),
                    ("awards", "Awards"),
                    ("case-studies", "Case studies"),
                    ("proprietary-data", "Proprietary data"),
                ],
                &[
                    ("judge-scores", "Judge scores (read only)"),
                    ("job-memory", "Job memory"),
                ],
            ),
            home(
                "traffic",
                "Traffic",
                "production",
                true,
                &[
                    ("traffic-board", "Traffic board"),
                    ("timesheets", "Timesheets"),
                    ("resources", "Resources"),
                    ("live-jobs", "Live jobs"),
                    ("timetables", "Timetables"),
                ],
                &[("scope-estimates", "Scope and estimates (read only)")],
            ),
        ];
        let d = |id: &str, name: &str, open_to: &[&str]| Department {
            id: id.into(),
            name: name.into(),
            open_to: open_to.iter().map(|s| s.to_string()).collect(),
        };
        Table {
            homes,
            departments: vec![
                d("management", "Management", &[]),
                d("clients", "Clients", &["account-service", "management"]),
                d("account-service", "Account service", &[]),
                d("planning", "Planning", &[]),
                d("creative", "Creative", &[]),
                d("production", "Production", &[]),
                d("agency-brain", "Agency Brain", &[]),
            ],
        }
    }
}

/// A person's roles, as the shell reads them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RoleInfo {
    pub id: String,
    pub title: String,
}

/// What `/api/t/{tenant}/doors` answers: what the desk adds for a role (features/align-landing-look.clan).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HomeView {
    pub roles: Vec<String>,
    /// False for a person with no roles: no home is drawn and nothing is refused.
    pub restricted: bool,
    /// The home on screen: `Planning`, or `Planning and Creative director` for two roles.
    pub title: String,
    /// The home the role switcher put on screen, when it did.
    pub viewing: Option<String>,
    /// The page doors of the desk's "Your pages" row: at most five, the person's own role first.
    pub pages: Vec<Entry>,
    /// The page doors that did not fit, as a text list under More.
    pub more: Vec<Entry>,
    /// The tools this person is offered (landing/tools.ts ids): the Dial, the client's page and Continue in
    /// show these and no others. Not a second list: a tool is a door that opens a document of a client.
    pub tools: Vec<String>,
    /// Every role's home, for admins and demos; none for anyone else.
    pub switcher: Option<Vec<RoleInfo>>,
    /// What this person may do with jobs; the shell draws a control only when it is true, and the
    /// server refuses the write in any case (features/job-page.clan).
    pub jobs: JobRights,
}

/// What a person may do with jobs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct JobRights {
    /// Open a job; change its title, owner and deadline.
    pub manage: bool,
    /// Set the budget in hours.
    pub budget: bool,
}

pub fn job_rights(roles: &[String]) -> JobRights {
    JobRights {
        manage: may_manage_jobs(roles),
        budget: may_set_budget(roles),
    }
}

pub fn is_switcher(roles: &[String]) -> bool {
    roles.iter().any(|r| r == ADMIN || r == DEMO)
}

impl Table {
    fn home_of(&self, role: &str) -> Option<&Home> {
        self.homes.iter().find(|h| h.role == role)
    }

    /// Whether `role` is one this table (or the admin kinds) knows.
    pub fn knows(&self, role: &str) -> bool {
        role == ADMIN || role == DEMO || self.home_of(role).is_some()
    }

    /// The home a role lands on. An admin lands on Management's.
    fn landing_role<'a>(&self, role: &'a str) -> &'a str {
        if role == ADMIN || role == DEMO {
            "management"
        } else {
            role
        }
    }

    /// One merged home for `roles`: the first door of each role in turn, so two
    /// roles share the five doors fairly; anything left, and each role's More
    /// tools, go to More tools without repeating a door.
    pub fn home_for(&self, roles: &[String]) -> (Vec<Entry>, Vec<Entry>) {
        let homes: Vec<&Home> = roles
            .iter()
            .filter_map(|r| self.home_of(self.landing_role(r)))
            .collect();
        let mut doors: Vec<Entry> = Vec::new();
        let mut spill: Vec<Entry> = Vec::new();
        let deepest = homes.iter().map(|h| h.doors.len()).max().unwrap_or(0);
        for i in 0..deepest {
            for h in &homes {
                let Some(d) = h.doors.get(i) else { continue };
                if doors.iter().any(|x| x.id == d.id) {
                    continue;
                }
                if doors.len() < MAX_DOORS {
                    doors.push(d.clone());
                } else if !spill.iter().any(|x| x.id == d.id) {
                    spill.push(d.clone());
                }
            }
        }
        let mut more = spill;
        for h in &homes {
            for m in &h.more {
                let seen = |list: &[Entry]| list.iter().any(|x| x.id == m.id);
                if !seen(&doors) && !seen(&more) {
                    more.push(m.clone());
                }
            }
        }
        // A door that sits open in the five is not repeated as a read-only line.
        more.retain(|m| !doors.iter().any(|d| d.id == m.id));
        (doors, more)
    }

    /// The home `roles` land on, or, for an admin or a demo, the home of the
    /// role `as_role` names. A role switcher that is not allowed is ignored.
    pub fn view(&self, roles: &[String], as_role: Option<&str>) -> HomeView {
        let switcher = is_switcher(roles).then(|| {
            self.homes
                .iter()
                .map(|h| RoleInfo {
                    id: h.role.clone(),
                    title: h.title.clone(),
                })
                .collect()
        });
        let viewing = as_role
            .filter(|r| is_switcher(roles) && self.home_of(r).is_some())
            .map(str::to_string);
        let shown: Vec<String> = match &viewing {
            Some(r) => vec![r.clone()],
            None => roles.to_vec(),
        };
        let (doors, rest) = self.home_for(&shown);
        // One rule: a door that opens a document of a client is a tool (the shell's TOOLS table); any other is a
        // page door. The desk is the Clients door, so that one is not drawn as a page.
        let mut tools: Vec<String> = Vec::new();
        let mut page_doors: Vec<Entry> = Vec::new();
        for d in doors.iter().chain(rest.iter()) {
            if let Some(t) = tool_of(&d.id) {
                if !tools.iter().any(|x| x == t) {
                    tools.push(t.to_string());
                }
            } else if d.id != "clients" && !page_doors.iter().any(|x| x.id == d.id) {
                page_doors.push(d.clone());
            }
        }
        let more = page_doors.split_off(page_doors.len().min(MAX_DOORS));
        let pages = page_doors;
        let title = shown
            .iter()
            .filter_map(|r| self.home_of(self.landing_role(r)).map(|h| h.title.clone()))
            .fold(Vec::<String>::new(), |mut acc, t| {
                if !acc.contains(&t) {
                    acc.push(t);
                }
                acc
            })
            .join(" and ");
        HomeView {
            roles: roles.to_vec(),
            restricted: !roles.is_empty(),
            title,
            viewing,
            pages,
            more,
            tools,
            switcher,
            jobs: job_rights(roles),
        }
    }

    /// An agency's own table from `<dir>/roles/<agency>.json`, else the default.
    /// A file that does not parse, or that has a home with more than five
    /// doors, is ignored with a warning: a broken file must not lock people out.
    pub fn for_agency(dir: Option<&Path>, agency: Option<&str>) -> Table {
        let file = dir
            .zip(agency)
            .map(|(d, a)| d.join("roles").join(format!("{a}.json")));
        let Some(file) = file.filter(|f| f.is_file()) else {
            return Table::default();
        };
        let parsed = std::fs::read(&file)
            .map_err(|e| e.to_string())
            .and_then(|b| serde_json::from_slice::<Table>(&b).map_err(|e| e.to_string()))
            .and_then(
                |t| match t.homes.iter().find(|h| h.doors.len() > MAX_DOORS) {
                    Some(h) => Err(format!("{} has more than {MAX_DOORS} doors", h.role)),
                    None => Ok(t),
                },
            );
        match parsed {
            Ok(t) => t,
            Err(why) => {
                tracing::warn!(file = %file.display(), %why, "role table ignored");
                Table::default()
            }
        }
    }
}

// ── the permission check ─────────────────────────────────────────────────────

/// The routes a role may not open, in groups. A route no group names is open
/// to everyone signed in (the documents, the library, the clients).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    /// Scope, estimates, invoices and change orders: producers, account service, management.
    /// Traffic reads scope (its More tools line); no route writes it yet.
    Money,
    /// Client brains and pitches: planning, account service and the Agency Brain.
    Brains,
    /// Proprietary data: the Agency Brain only.
    Proprietary,
    /// Making and withdrawing the client's own link: account service sends it, the planner may
    /// (features/client-confirm-link.clan).
    ClientLink,
    /// The agency dashboard: management (an admin or a demo opens everything).
    Management,
    /// Naming who approves each stage of a job and by when (features/approval-route.clan):
    /// account service, and management.
    Approvals,
    /// An agency's setup, import and audit view (features/agency-setup.clan): its admin only. A
    /// person with no role is refused here, not let through.
    Admin,
    /// The control list of agencies: a napkin-admin of the home agency (checked where it is served).
    Control,
    Open,
}

impl Group {
    fn roles(self) -> &'static [&'static str] {
        match self {
            Group::Money => &["producer", "account-service", "management", "traffic"],
            Group::Brains => &["planning", "account-service", "agency-brain"],
            Group::Proprietary => &["agency-brain"],
            Group::ClientLink => &["account-service", "planning"],
            Group::Management => &["management"],
            Group::Approvals => &["account-service", "management"],
            Group::Admin => &[ADMIN],
            Group::Control => &["napkin-admin"],
            Group::Open => &[],
        }
    }
}

/// Which group a route belongs to. `route` is the path under `/api`, either
/// `/t/{tenant}/jobs/J001/scope` or the same without the tenant.
pub fn group_of(route: &str) -> Group {
    let mut parts = route.trim_matches('/').split('/').filter(|s| !s.is_empty());
    let mut first = parts.next();
    if first == Some("t") {
        parts.next(); // the tenant
        first = parts.next();
    }
    let rest: Vec<&str> = parts.collect();
    match first {
        Some("jobs") if rest.get(1).copied() == Some("route") => Group::Approvals,
        Some("jobs")
            if matches!(
                rest.get(1).copied(),
                Some("scope" | "estimates" | "invoices" | "change-orders")
            ) =>
        {
            Group::Money
        }
        Some("scope" | "estimates" | "invoices" | "change-orders" | "time-money") => Group::Money,
        Some("d")
            if matches!(
                rest.get(1).copied(),
                Some("client-link" | "client-links" | "client-review")
            ) =>
        {
            Group::ClientLink
        }
        Some("client-brains" | "pitches") => Group::Brains,
        Some("proprietary") => Group::Proprietary,
        Some("dashboard") => Group::Management,
        // what Judge's telemetry holds leaves the vault by this one export, for management and admin
        Some("judge") if rest.first().copied() == Some("telemetry") => Group::Management,
        Some("audit" | "setup") => Group::Admin,
        Some("agency") if rest.first().copied() == Some("accounts.tsv") => Group::Admin,
        Some("control") => Group::Control,
        _ => Group::Open,
    }
}

/// May a person with `roles` open `route`, for `client` (unused in Phase 1:
/// the signature is where per-client rules would go, so they do not need a new check)?
/// A person with no roles is unrestricted; an admin or a demo opens everything.
pub fn allowed(roles: &[String], route: &str, _client: Option<&str>) -> bool {
    let group = group_of(route);
    if matches!(group, Group::Admin | Group::Control) {
        return roles.iter().any(|r| group.roles().contains(&r.as_str()));
    }
    if roles.is_empty() || is_switcher(roles) {
        return true;
    }
    group == Group::Open || roles.iter().any(|r| group.roles().contains(&r.as_str()))
}

/// Is a person with `roles` in `group`? Used to decide which fields of a job they are sent. A person with
/// no roles is unrestricted; an admin or a demo is in every group.
pub fn in_group(roles: &[String], group: Group) -> bool {
    roles.is_empty()
        || is_switcher(roles)
        || roles.iter().any(|r| group.roles().contains(&r.as_str()))
}

/// The roles that may open a job and change its title, owner and deadline (features/job-page.clan):
/// planning (the planner opens the job at step 1 of v2 section 3), account service, management and
/// producers. Creative roles, the Agency Brain and traffic may not. An allow list: a role added later is
/// left out until it is named here. A person with no role is unrestricted, as everywhere; an admin too.
pub const JOB_MANAGERS: &[&str] = &["planning", "account-service", "management", "producer"];

pub fn may_manage_jobs(roles: &[String]) -> bool {
    roles.is_empty()
        || is_switcher(roles)
        || roles.iter().any(|r| JOB_MANAGERS.contains(&r.as_str()))
}

/// The budget in hours is money (the owner's answer is open; the design's default): only the Money roles
/// set it, and only those of them who manage jobs.
pub fn may_set_budget(roles: &[String]) -> bool {
    may_manage_jobs(roles) && in_group(roles, Group::Money)
}

/// The middleware: a signed-in person's roles against the route. 403 when the
/// roles may not open it; everyone else passes through.
pub async fn guard(request: Request, next: Next) -> Response {
    let roles = request
        .extensions()
        .get::<Account>()
        .map(|a| a.roles.clone())
        .unwrap_or_default();
    if !allowed(&roles, request.uri().path(), None) {
        let body = serde_json::json!({
            "ok": false,
            "error": "Your role cannot open this.",
        })
        .to_string();
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.into())
            .unwrap();
    }
    next.run(request).await
}

/// Roles as written on a roster line or in a Cognito attribute: separated by
/// commas, semicolons or spaces, lower case, each once.
pub fn parse_roles(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in raw
        .split(|c: char| c == ',' || c == ';' || c.is_whitespace())
        .map(|r| r.trim().to_ascii_lowercase())
        .filter(|r| !r.is_empty())
    {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }
    fn names(v: &[Entry]) -> Vec<&str> {
        v.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn each_live_role_gets_the_doors_of_the_v2_table() {
        let t = Table::default();
        assert_eq!(
            names(&t.home_for(&r(&["planning"])).0),
            [
                "Brief",
                "Research",
                "Territories",
                "Client brains",
                "Presentations"
            ]
        );
        assert_eq!(
            names(&t.home_for(&r(&["creative-director"])).0),
            [
                "Ideas",
                "Ready for review",
                "Judge scores",
                "Approved work",
                "Direction notes"
            ]
        );
        assert_eq!(
            names(&t.home_for(&r(&["account-service"])).0),
            [
                "Clients",
                "Live jobs",
                "Approvals",
                "Scope and estimates",
                "Presentations"
            ]
        );
        assert_eq!(
            names(&t.home_for(&r(&["management"])).0),
            [
                "Agency dashboard",
                "Live jobs",
                "Time and money",
                "Clients",
                "Traffic board"
            ]
        );
        assert_eq!(
            names(&t.home_for(&r(&["planning"])).1),
            ["Ideas (read only)", "Case study builder (read only)"]
        );
    }

    #[test]
    fn no_home_has_more_than_five_doors_even_merged() {
        let t = Table::default();
        for h in &t.homes {
            assert!(h.doors.len() <= MAX_DOORS, "{}", h.role);
        }
        let ids: Vec<String> = t.homes.iter().map(|h| h.role.clone()).collect();
        // every pair of roles
        for a in &ids {
            for b in &ids {
                let (doors, more) = t.home_for(&r(&[a, b]));
                assert!(doors.len() <= MAX_DOORS, "{a} + {b}");
                for d in &doors {
                    assert!(
                        !more.iter().any(|m| m.id == d.id),
                        "{} twice for {a} + {b}",
                        d.id
                    );
                }
            }
        }
    }

    #[test]
    fn two_roles_get_one_merged_home_of_five() {
        let t = Table::default();
        let v = t.view(&r(&["planning", "creative-director"]), None);
        let two = t.home_for(&r(&["planning", "creative-director"]));
        assert_eq!(
            names(&two.0),
            [
                "Brief",
                "Ideas",
                "Research",
                "Ready for review",
                "Territories"
            ]
        );
        assert_eq!(v.title, "Planning and Creative director");
        // what did not fit is under More tools, not lost
        for lost in [
            "Judge scores",
            "Client brains",
            "Presentations",
            "Approved work",
            "Direction notes",
        ] {
            assert!(names(&two.1).contains(&lost), "{lost} is in More tools");
        }
        // Ideas is a full door for the creative director, so the planner's read-only line is not repeated
        assert!(!names(&two.1).contains(&"Ideas (read only)"));
    }

    #[test]
    fn only_admins_and_demos_have_the_switcher_and_it_changes_the_home() {
        let t = Table::default();
        assert!(t.view(&r(&["planning"]), None).switcher.is_none());
        assert!(
            t.view(&r(&["planning"]), Some("management"))
                .viewing
                .is_none(),
            "a planner cannot switch"
        );
        let a = t.view(&r(&["admin"]), Some("copywriter"));
        assert!(a.switcher.is_some());
        assert_eq!(
            names(&t.home_for(&r(&["copywriter"])).0),
            [
                "Ideas",
                "Script editor",
                "Radio",
                "Video and motion",
                "Formats and in situ"
            ]
        );
        assert!(t.view(&r(&["demo"]), None).switcher.is_some());
    }

    #[test]
    fn a_person_with_no_role_is_unrestricted() {
        let t = Table::default();
        let v = t.view(&[], None);
        assert!(!v.restricted);
        assert!(allowed(&[], "/t/x/jobs/J001/scope", None));
        assert!(allowed(&[], "/t/x/proprietary/data", None));
        // a roles column with only a typo is a role nobody knows: no privilege, not every privilege
        assert!(!allowed(&r(&["plannign"]), "/t/x/jobs/J001/scope", None));
        assert!(!t.knows("plannign"));
    }

    #[test]
    fn each_role_against_each_route_group() {
        let routes = [
            ("/t/x/jobs/J001/scope", Group::Money),
            ("/t/x/jobs/J001/estimates", Group::Money),
            ("/t/x/jobs/J001/invoices", Group::Money),
            ("/t/x/client-brains/c1", Group::Brains),
            ("/t/x/pitches", Group::Brains),
            ("/t/x/proprietary/rates", Group::Proprietary),
            ("/t/x/clients", Group::Open),
            ("/t/x/d/doc_1/patch", Group::Open),
            ("/t/x/library", Group::Open),
            ("/session", Group::Open),
        ];
        for (route, group) in routes {
            assert_eq!(group_of(route), group, "{route}");
        }
        // role, then the groups it opens: money, brains, proprietary
        let table: [(&str, [bool; 3]); 9] = [
            ("planning", [false, true, false]),
            ("creative-director", [false, false, false]),
            ("account-service", [true, true, false]),
            ("management", [true, false, false]),
            ("art-director", [false, false, false]),
            ("copywriter", [false, false, false]),
            ("producer", [true, false, false]),
            ("agency-brain", [false, true, true]),
            ("traffic", [true, false, false]),
        ];
        for (role, [money, brains, prop]) in table {
            let roles = r(&[role]);
            assert_eq!(
                allowed(&roles, "/t/x/jobs/J001/scope", None),
                money,
                "{role} money"
            );
            assert_eq!(
                allowed(&roles, "/t/x/client-brains/c1", None),
                brains,
                "{role} brains"
            );
            assert_eq!(
                allowed(&roles, "/t/x/proprietary/rates", None),
                prop,
                "{role} proprietary"
            );
            assert!(allowed(&roles, "/t/x/clients", None), "{role} open routes");
        }
        for admin in ["admin", "demo"] {
            assert!(allowed(&r(&[admin]), "/t/x/proprietary/rates", None));
        }
        // two roles: either may open it
        assert!(allowed(
            &r(&["planning", "management"]),
            "/t/x/jobs/J001/scope",
            None
        ));
    }

    #[test]
    fn only_management_opens_the_dashboard_and_everyone_opens_their_own_needs() {
        assert_eq!(group_of("/t/x/dashboard"), Group::Management);
        assert_eq!(group_of("/dashboard"), Group::Management);
        for role in [
            "planning",
            "creative-director",
            "account-service",
            "producer",
            "traffic",
        ] {
            assert!(!allowed(&r(&[role]), "/t/x/dashboard", None), "{role}");
            assert!(allowed(&r(&[role]), "/t/x/needs", None), "{role} needs");
            assert!(allowed(&r(&[role]), "/t/x/jobs", None), "{role} jobs");
        }
        assert!(allowed(&r(&["management"]), "/t/x/dashboard", None));
        assert!(allowed(&r(&["admin"]), "/t/x/dashboard", None));
        assert!(allowed(&r(&["demo"]), "/t/x/dashboard", None));
        assert!(allowed(&[], "/t/x/dashboard", None));
    }

    #[test]
    fn only_account_service_and_management_name_a_route() {
        assert_eq!(group_of("/t/x/jobs/J001/route"), Group::Approvals);
        assert_eq!(group_of("/jobs/J001/route"), Group::Approvals);
        // reading a job, its stage and the list stays open to everyone signed in
        assert_eq!(group_of("/t/x/jobs/J001"), Group::Open);
        assert_eq!(group_of("/t/x/jobs/J001/stage"), Group::Open);
        for role in [
            "planning",
            "creative-director",
            "producer",
            "traffic",
            "copywriter",
        ] {
            assert!(
                !allowed(&r(&[role]), "/t/x/jobs/J001/route", None),
                "{role}"
            );
        }
        for role in ["account-service", "management", "admin", "demo"] {
            assert!(allowed(&r(&[role]), "/t/x/jobs/J001/route", None), "{role}");
        }
    }

    #[test]
    fn roles_are_read_from_a_line_whatever_the_separator() {
        assert_eq!(
            parse_roles("Planning, creative-director;planning"),
            ["planning", "creative-director"]
        );
        assert!(parse_roles("  ").is_empty());
    }

    #[test]
    fn an_agency_table_overrides_the_default_and_a_broken_one_does_not() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("roles")).unwrap();
        let mut t = Table::default();
        t.homes[0].doors.truncate(2);
        std::fs::write(
            dir.path().join("roles/wk.json"),
            serde_json::to_vec(&t).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("roles/bad.json"), b"{ not json").unwrap();
        assert_eq!(
            Table::for_agency(Some(dir.path()), Some("wk")).homes[0]
                .doors
                .len(),
            2
        );
        assert_eq!(
            Table::for_agency(Some(dir.path()), Some("bad")),
            Table::default()
        );
        assert_eq!(
            Table::for_agency(Some(dir.path()), Some("none")),
            Table::default()
        );
        assert_eq!(Table::for_agency(None, None), Table::default());
    }

    fn all_roles() -> Vec<String> {
        Table::default()
            .homes
            .iter()
            .map(|h| h.role.clone())
            .collect()
    }

    #[test]
    fn all_nine_homes_are_live_with_the_doors_of_the_v2_table() {
        let t = Table::default();
        assert_eq!(t.homes.len(), 9);
        assert!(t.homes.iter().all(|h| h.live), "no home is marked not live");
        let check = |role: &str, doors: &[&str], more: &[&str]| {
            assert_eq!(names(&t.home_for(&r(&[role])).0), doors, "{role} doors");
            assert_eq!(names(&t.home_for(&r(&[role])).1), more, "{role} more tools");
        };
        check(
            "art-director",
            &[
                "Ideas",
                "Stills",
                "Video and motion",
                "Formats and in situ",
                "Shopper stands",
            ],
            &["Experiential", "Presentations", "Craft review"],
        );
        check(
            "copywriter",
            &[
                "Ideas",
                "Script editor",
                "Radio",
                "Video and motion",
                "Formats and in situ",
            ],
            &[
                "Shopper stands",
                "Experiential",
                "Presentations",
                "Craft review",
            ],
        );
        check(
            "producer",
            &[
                "Live jobs",
                "Video and motion",
                "Radio",
                "Scope and estimates",
                "Timetables",
            ],
            &["Formats and in situ", "Shopper stands", "Traffic board"],
        );
        check(
            "agency-brain",
            &[
                "Client brains",
                "Pitches",
                "Awards",
                "Case studies",
                "Proprietary data",
            ],
            &["Judge scores (read only)", "Job memory"],
        );
        check(
            "traffic",
            &[
                "Traffic board",
                "Timesheets",
                "Resources",
                "Live jobs",
                "Timetables",
            ],
            &["Scope and estimates (read only)"],
        );
    }

    #[test]
    fn the_desk_row_has_at_most_five_pages_and_every_door_is_a_tool_or_a_page() {
        let t = Table::default();
        let ids = all_roles();
        let mut sets: Vec<Vec<String>> = ids.iter().map(|a| r(&[a])).collect();
        for a in &ids {
            for b in &ids {
                sets.push(r(&[a, b]));
            }
        }
        sets.push(r(&["admin"]));
        sets.push(r(&["demo"]));
        for roles in sets {
            let v = t.view(&roles, None);
            assert!(v.pages.len() <= MAX_DOORS, "{roles:?}");
            let mut seen: Vec<&str> = v
                .pages
                .iter()
                .chain(&v.more)
                .map(|e| e.id.as_str())
                .collect();
            let n = seen.len();
            seen.sort();
            seen.dedup();
            assert_eq!(n, seen.len(), "{roles:?} no page twice");
            for e in v.pages.iter().chain(&v.more) {
                assert!(tool_of(&e.id).is_none(), "{} is a tool, not a page", e.id);
                assert_ne!(e.id, "clients", "the desk is the Clients door");
            }
            let (doors, rest) = t.home_for(&roles);
            for d in doors.iter().chain(&rest) {
                let ok = match tool_of(&d.id) {
                    Some(tool) => v.tools.iter().any(|x| x == tool),
                    None => {
                        d.id == "clients" || v.pages.iter().chain(&v.more).any(|e| e.id == d.id)
                    }
                };
                assert!(ok, "{} reaches nobody for {roles:?}", d.id);
            }
        }
    }

    #[test]
    fn a_role_is_offered_its_own_tools_and_pages() {
        let t = Table::default();
        let v = t.view(&r(&["planning"]), None);
        assert_eq!(
            v.tools,
            ["brief", "research", "territories", "deck", "idea"]
        );
        assert_eq!(
            names(&v.pages),
            ["Client brains", "Case study builder (read only)"]
        );
        assert!(v.more.is_empty());
        let m = t.view(&r(&["management"]), None);
        assert_eq!(
            names(&m.pages),
            [
                "Agency dashboard",
                "Live jobs",
                "Time and money",
                "Traffic board",
                "Agency Brain (read only)"
            ]
        );
        assert_eq!(m.tools, ["deck"]);
        // two roles merge into one row of five, the person's own role first
        let two = t.view(&r(&["account-service", "management"]), None);
        assert_eq!(two.pages.len(), 5);
    }

    #[test]
    fn the_permission_groups_hold_for_the_five_new_roles() {
        let scope = "/t/x/jobs/J001/scope";
        let prop = "/t/x/proprietary/rates";
        let brains = "/t/x/client-brains/c1";
        assert!(!allowed(&r(&["copywriter"]), scope, None));
        assert!(allowed(&r(&["producer"]), scope, None));
        assert!(allowed(&r(&["traffic"]), scope, None));
        assert!(allowed(&r(&["agency-brain"]), brains, None));
        assert!(allowed(&r(&["agency-brain"]), prop, None));
        assert!(!allowed(&r(&["art-director"]), brains, None));
        assert!(!allowed(&r(&["art-director"]), prop, None));
        assert!(!allowed(&r(&["copywriter"]), prop, None));
        // a Phase 1 role with a Phase 2 role: either may open it
        assert!(allowed(&r(&["copywriter", "agency-brain"]), prop, None));
    }

    /// The server's table and the shell's door content must not drift: every id a home lists
    /// (door or More tools) has its own Empty content in doors.ts, and doors.ts names no other id.
    #[test]
    fn every_door_has_its_content_in_the_shell() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../app/src/components/states/doors.ts"
        );
        let text = std::fs::read_to_string(path).expect("doors.ts");
        let in_shell: Vec<&str> = text
            .lines()
            .filter_map(|l| l.trim_start().strip_prefix("{ id: '"))
            .filter_map(|l| l.split('\'').next())
            .collect();
        let t = Table::default();
        let mut wanted: Vec<&str> = Vec::new();
        for h in &t.homes {
            for e in h.doors.iter().chain(&h.more) {
                if !wanted.contains(&e.id.as_str()) {
                    wanted.push(&e.id);
                }
            }
        }
        for id in &wanted {
            assert!(in_shell.contains(id), "doors.ts has no entry for {id}");
        }
        for id in &in_shell {
            assert!(
                wanted.contains(id),
                "doors.ts names {id}, which no home lists"
            );
        }
    }

    #[test]
    fn the_admin_routes_are_for_an_admin_only_and_never_for_no_role_or_a_demo() {
        let admin = r(&["admin"]);
        for route in [
            "/t/x/audit",
            "/t/x/setup/import/people",
            "/t/x/audit/verify",
        ] {
            assert!(allowed(&admin, route, None), "{route}");
            for who in [
                r(&[]),
                r(&["management"]),
                r(&["demo"]),
                r(&["planning", "traffic"]),
            ] {
                assert!(!allowed(&who, route, None), "{who:?} {route}");
            }
        }
        // the control list needs napkin-admin; an agency admin is not one
        assert!(!allowed(&admin, "/control/agencies", None));
        assert!(allowed(&r(&["napkin-admin"]), "/control/agencies", None));
        // the people list is open to everyone signed in (emails are cut in the handler)
        assert!(allowed(&r(&["traffic"]), "/t/x/agency/people", None));
    }
}
