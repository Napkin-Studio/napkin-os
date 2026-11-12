// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The one place mail leaves Napkin Studio OS (features/client-review-full.clan).
//!
//! Everything that sends mail goes through [`Mailer`], and nothing sends mail any other way. Today
//! one message is sent: the six-digit code that opens a client's review link ([`Message::Code`]).
//! Two later records add a message each and reuse the seam as it is: the reminder digest of
//! `approval-route` ([`Message::Digest`]) and the first-day and agency-setup invites
//! ([`Message::Invite`]). A message is typed and its words are fixed here; a caller supplies data,
//! never a subject or a body, so no outsider's text is ever the text of a mail.
//!
//! The shape a later record adds to:
//!
//! 1. add a variant to [`Message`] holding only the data its template needs;
//! 2. add its subject and body to [`render`];
//! 3. send it with [`Mail::send`], which checks the per-tenant daily cap first.
//!
//! The mailers: [`Off`] (the default: nothing is sent and the code option is not offered), [`Memory`]
//! (for tests: an inbox in memory, never a network call) and, later, SES. The SES sender needs a
//! sending domain and a person in AWS (features/client-review-full.clan, `rollout`); until it
//! exists `NAPKIN_MAIL=ses` is refused at start-up and the server runs with [`Off`].

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// A mail the server may send. Data only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    /// The code that opens a review link: six digits, to the address the link was sent to.
    Code {
        to: String,
        code: String,
        /// The agency's name, for the line "from <agency>".
        agency: Option<String>,
    },
    /// A link to review a round, sent from the agency's screen instead of copied (later).
    ReviewLink {
        to: String,
        url: String,
        agency: Option<String>,
    },
    /// A person's reminder digest (`approval-route`, later): the plain lines to send.
    Digest { to: String, lines: Vec<String> },
    /// An invite to an agency's workspace (`first-day` and `agency-setup`, later).
    Invite {
        to: String,
        agency: Option<String>,
        url: String,
    },
}

impl Message {
    pub fn to(&self) -> &str {
        match self {
            Message::Code { to, .. }
            | Message::ReviewLink { to, .. }
            | Message::Digest { to, .. }
            | Message::Invite { to, .. } => to,
        }
    }
}

/// The subject and the plain-text body of a message. Fixed wording; no em dashes.
pub fn render(m: &Message) -> (String, String) {
    let from = |a: &Option<String>| match a {
        Some(a) if !a.trim().is_empty() => a.trim().to_string(),
        _ => "your agency".to_string(),
    };
    match m {
        Message::Code { code, agency, .. } => (
            format!("Your code: {code}"),
            format!(
                "Your code to open the review from {} is {code}.\n\nIt works for ten minutes. If you did not ask for it, you can ignore this mail.\n",
                from(agency)
            ),
        ),
        Message::ReviewLink { url, agency, .. } => (
            format!("{} asks you to review something", from(agency)),
            format!("Open your own link to review it:\n\n{url}\n\nThe link is yours. Please do not forward it.\n"),
        ),
        Message::Digest { lines, .. } => (
            "What is waiting on you".to_string(),
            format!("{}\n", lines.join("\n")),
        ),
        Message::Invite { agency, url, .. } => (
            format!("You are invited to {}", from(agency)),
            format!("Open your workspace:\n\n{url}\n"),
        ),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MailError {
    /// No sender is configured: nothing was sent.
    Off,
    /// The tenant has sent as many today as it may.
    OverCap,
    /// The sender refused or could not be reached.
    Failed,
}

/// Something that can send a [`Message`].
pub trait Mailer: Send + Sync {
    /// Is there a real way to send? When false the code option is not offered at all.
    fn enabled(&self) -> bool;
    fn send(&self, m: &Message) -> Result<(), MailError>;
}

/// The default: nothing is sent.
pub struct Off;

impl Mailer for Off {
    fn enabled(&self) -> bool {
        false
    }
    fn send(&self, _m: &Message) -> Result<(), MailError> {
        Err(MailError::Off)
    }
}

/// A test's sender: every mail kept in memory, none sent. `fn outbox()` reads them back.
#[derive(Default)]
pub struct Memory {
    sent: Mutex<Vec<Message>>,
}

impl Memory {
    pub fn outbox(&self) -> Vec<Message> {
        self.sent.lock().unwrap().clone()
    }
}

impl Mailer for Memory {
    fn enabled(&self) -> bool {
        true
    }
    fn send(&self, m: &Message) -> Result<(), MailError> {
        self.sent.lock().unwrap().push(m.clone());
        Ok(())
    }
}

/// A development sender for the e2e stack and a laptop: every mail is appended to a file as one JSON line
/// (`{"to","subject","body"}`) and nothing leaves the machine. `NAPKIN_MAIL_OUTBOX=<path>`. Not a
/// deployment's sender: there, mail is off until the real one exists.
pub struct Outbox(pub std::path::PathBuf);

impl Mailer for Outbox {
    fn enabled(&self) -> bool {
        true
    }
    fn send(&self, m: &Message) -> Result<(), MailError> {
        use std::io::Write;
        let (subject, body) = render(m);
        let line = serde_json::json!({ "to": m.to(), "subject": subject, "body": body });
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.0)
            .and_then(|mut f| writeln!(f, "{line}"))
            .map_err(|_| MailError::Failed)
    }
}

/// The sender the environment asks for, and its daily cap per tenant. `NAPKIN_MAIL_OUTBOX` names a
/// file (development); `NAPKIN_MAIL=ses` is not built yet (it needs a sending domain and a person in
/// AWS) and is refused with a log line, so the server runs with mail off rather than half on. Anything
/// else is off.
pub fn from_env(
    mode: Option<&str>,
    outbox: Option<&str>,
    cap: Option<&str>,
) -> (Arc<dyn Mailer>, u32) {
    let cap = cap
        .and_then(|c| c.trim().parse::<u32>().ok())
        .unwrap_or(DEFAULT_DAILY_CAP);
    if let Some(path) = outbox.filter(|p| !p.trim().is_empty()) {
        return (Arc::new(Outbox(path.into())), cap);
    }
    if mode.is_some_and(|m| m.trim().eq_ignore_ascii_case("ses")) {
        tracing::error!("NAPKIN_MAIL=ses is not built yet: running with mail off");
    }
    (Arc::new(Off), cap)
}

/// The most mails one tenant sends in a UTC day unless `NAPKIN_MAIL_DAILY_CAP` says otherwise.
pub const DEFAULT_DAILY_CAP: u32 = 200;

/// A mailer with the per-tenant daily cap in front of it. Every send in the server goes through this.
pub struct Mail {
    inner: Arc<dyn Mailer>,
    cap: u32,
    /// (tenant, day number) -> sent today
    counts: Mutex<HashMap<(String, u64), u32>>,
}

impl Mail {
    pub fn new(inner: Arc<dyn Mailer>, cap: u32) -> Self {
        Self {
            inner,
            cap,
            counts: Mutex::new(HashMap::new()),
        }
    }

    /// No mail at all.
    pub fn off() -> Self {
        Self::new(Arc::new(Off), DEFAULT_DAILY_CAP)
    }

    pub fn enabled(&self) -> bool {
        self.inner.enabled()
    }

    /// Send `m` for `tenant` on day `day` (Unix seconds / 86,400), unless the tenant is at its cap.
    /// The cap is checked, and counted, before the sender is called.
    pub fn send(&self, tenant: &str, day: u64, m: &Message) -> Result<(), MailError> {
        if !self.inner.enabled() {
            return Err(MailError::Off);
        }
        {
            let mut c = self.counts.lock().unwrap();
            c.retain(|(_, d), _| *d + 1 >= day);
            let n = c.entry((tenant.to_string(), day)).or_insert(0);
            if *n >= self.cap {
                return Err(MailError::OverCap);
            }
            *n += 1;
        }
        self.inner.send(m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cap_counts_per_tenant_and_per_day() {
        let mem = Arc::new(Memory::default());
        let mail = Mail::new(mem.clone(), 2);
        let m = Message::Digest {
            to: "a@x.example".into(),
            lines: vec![],
        };
        assert!(mail.send("t1", 5, &m).is_ok());
        assert!(mail.send("t1", 5, &m).is_ok());
        assert_eq!(mail.send("t1", 5, &m), Err(MailError::OverCap));
        assert!(mail.send("t2", 5, &m).is_ok());
        assert!(mail.send("t1", 6, &m).is_ok());
        assert_eq!(mem.outbox().len(), 4);
    }

    #[test]
    fn off_sends_nothing_and_says_so() {
        let mail = Mail::off();
        assert!(!mail.enabled());
        let m = Message::Code {
            to: "a@x.example".into(),
            code: "123456".into(),
            agency: None,
        };
        assert_eq!(mail.send("t", 1, &m), Err(MailError::Off));
    }

    #[test]
    fn the_words_are_fixed_and_carry_no_em_dash() {
        let (s, b) = render(&Message::Code {
            to: "a@x.example".into(),
            code: "123456".into(),
            agency: Some("Wk".into()),
        });
        assert!(s.contains("123456") && b.contains("from Wk"));
        assert!(!s.contains('\u{2014}') && !b.contains('\u{2014}'));
    }
}
