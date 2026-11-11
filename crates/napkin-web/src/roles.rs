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

/// No home has more than five doors, and the O draws no more than five circles.
pub const MAX_DOORS: usize = 5;
pub const MAX_CIRCLES: usize = 5;

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
    /// False for the five homes that go live in Phase 2: they exist as door lists only.
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
                false,
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
                false,
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
                false,
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
                false,
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
                false,
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

/// A circle on the O: a department, and where it opens.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Circle {
    pub id: String,
    pub name: String,
    /// The person's own department.
    pub mine: bool,
    /// The role whose home it opens; none for Clients, which opens the client desk.
    pub opens: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Map {
    /// At most five, the person's own first.
    pub circles: Vec<Circle>,
    /// The rest the person may open, as a text list.
    pub other: Vec<Circle>,
}

/// What `/api/t/{tenant}/doors` answers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HomeView {
    pub roles: Vec<String>,
    /// False for a person with no roles: no home is drawn and nothing is refused.
    pub restricted: bool,
    /// The home on screen: `Planning`, or `Planning and Creative director` for two roles.
    pub title: String,
    /// The home the role switcher put on screen, when it did.
    pub viewing: Option<String>,
    pub doors: Vec<Entry>,
    pub more: Vec<Entry>,
    pub map: Map,
    /// Every role's home, for admins and demos; none for anyone else.
    pub switcher: Option<Vec<RoleInfo>>,
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

    /// The departments `roles` may open, the person's own first.
    fn open_departments(&self, roles: &[String]) -> Vec<&Department> {
        let all = is_switcher(roles);
        let mut own: Vec<&str> = Vec::new();
        for r in roles {
            let dept = self
                .home_of(self.landing_role(r))
                .map(|h| h.department.as_str());
            if let Some(d) = dept {
                if !own.contains(&d) {
                    own.push(d);
                }
            }
        }
        let opens = |d: &Department| {
            all || own.contains(&d.id.as_str())
                || d.open_to.iter().any(|o| roles.iter().any(|r| r == o))
        };
        let mut out: Vec<&Department> = Vec::new();
        for id in &own {
            if let Some(d) = self.departments.iter().find(|d| d.id == *id) {
                out.push(d);
            }
        }
        for d in &self.departments {
            if opens(d) && !out.iter().any(|x| x.id == d.id) {
                out.push(d);
            }
        }
        out
    }

    /// The department a role belongs to, and the role whose home a circle opens.
    fn circle(&self, d: &Department, mine: bool) -> Circle {
        let opens = if d.id == "clients" {
            None
        } else {
            self.homes
                .iter()
                .find(|h| h.department == d.id)
                .map(|h| h.role.clone())
        };
        Circle {
            id: d.id.clone(),
            name: d.name.clone(),
            mine,
            opens,
        }
    }

    pub fn map_for(&self, roles: &[String]) -> Map {
        let own: Vec<String> = roles
            .iter()
            .filter_map(|r| self.home_of(self.landing_role(r)))
            .map(|h| h.department.clone())
            .collect();
        let open = self.open_departments(roles);
        let mut circles = Vec::new();
        let mut other = Vec::new();
        for (i, d) in open.iter().enumerate() {
            let c = self.circle(d, own.contains(&d.id));
            if i < MAX_CIRCLES {
                circles.push(c);
            } else {
                other.push(c);
            }
        }
        Map { circles, other }
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
        let (doors, more) = self.home_for(&shown);
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
            doors,
            more,
            map: self.map_for(roles),
            switcher,
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
    /// The agency dashboard: management (an admin or a demo opens everything).
    Management,
    Open,
}

impl Group {
    fn roles(self) -> &'static [&'static str] {
        match self {
            Group::Money => &["producer", "account-service", "management", "traffic"],
            Group::Brains => &["planning", "account-service", "agency-brain"],
            Group::Proprietary => &["agency-brain"],
            Group::Management => &["management"],
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
        Some("jobs")
            if matches!(
                rest.get(1).copied(),
                Some("scope" | "estimates" | "invoices" | "change-orders")
            ) =>
        {
            Group::Money
        }
        Some("scope" | "estimates" | "invoices" | "change-orders" | "time-money") => Group::Money,
        Some("client-brains" | "pitches") => Group::Brains,
        Some("proprietary") => Group::Proprietary,
        Some("dashboard") => Group::Management,
        _ => Group::Open,
    }
}

/// May a person with `roles` open `route`, for `client` (unused in Phase 1:
/// the signature is where per-client rules would go, so they do not need a new check)?
/// A person with no roles is unrestricted; an admin or a demo opens everything.
pub fn allowed(roles: &[String], route: &str, _client: Option<&str>) -> bool {
    if roles.is_empty() || is_switcher(roles) {
        return true;
    }
    let group = group_of(route);
    group == Group::Open || roles.iter().any(|r| group.roles().contains(&r.as_str()))
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
        let v = |role: &str| t.view(&r(&[role]), None);
        assert_eq!(
            names(&v("planning").doors),
            [
                "Brief",
                "Research",
                "Territories",
                "Client brains",
                "Presentations"
            ]
        );
        assert_eq!(
            names(&v("creative-director").doors),
            [
                "Ideas",
                "Ready for review",
                "Judge scores",
                "Approved work",
                "Direction notes"
            ]
        );
        assert_eq!(
            names(&v("account-service").doors),
            [
                "Clients",
                "Live jobs",
                "Approvals",
                "Scope and estimates",
                "Presentations"
            ]
        );
        assert_eq!(
            names(&v("management").doors),
            [
                "Agency dashboard",
                "Live jobs",
                "Time and money",
                "Clients",
                "Traffic board"
            ]
        );
        assert_eq!(
            names(&v("planning").more),
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
        assert_eq!(
            names(&v.doors),
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
            assert!(names(&v.more).contains(&lost), "{lost} is in More tools");
        }
        // Ideas is a full door for the creative director, so the planner's read-only line is not repeated
        assert!(!names(&v.more).contains(&"Ideas (read only)"));
    }

    #[test]
    fn the_o_shows_five_circles_and_lists_the_rest() {
        let t = Table::default();
        let admin = t.view(&r(&["admin"]), None);
        assert_eq!(admin.map.circles.len(), 5);
        assert_eq!(admin.map.other.len(), 2);
        assert_eq!(
            admin.map.circles[0].name, "Management",
            "an admin's own department first"
        );
        let planner = t.view(&r(&["planning"]), None);
        assert_eq!(planner.map.circles.len(), 1);
        assert!(planner.map.circles[0].mine);
        assert!(planner.map.other.is_empty());
        // a person's own department comes first, then the others they may open
        let am = t.view(&r(&["account-service"]), None);
        assert_eq!(
            am.map
                .circles
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            ["account-service", "clients"]
        );
        assert_eq!(
            am.map.circles[1].opens, None,
            "Clients opens the client desk"
        );
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
            names(&a.doors),
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
        for role in ["planning", "creative-director", "account-service", "producer", "traffic"] {
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
}
