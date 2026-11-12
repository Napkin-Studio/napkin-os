// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The clean specs: what a client's review link may show of each kind of document, and the pieces
//! (features/client-review-full.clan). Data, not code, and an allow list: a document type with no spec
//! gets no link, a field not named here is never drawn, an asset not named here is never served.
//!
//! A spec holds the exact text fields a client may read, each in the shape its schema gives it; the
//! keys of the schema that are never shown are listed too, so a test can hold every schema key to one
//! list or the other (`crates/napkin-web/tests/client_review.rs`). The web layer draws the text from
//! these (`napkin_web::clean`); the host works the *pieces* out from them, so that a link records
//! exactly what it was made for.
//!
//! A piece is what a reviewer looks at one at a time: a page of text, an image, a film or audio. The
//! host hashes each piece itself (an asset by its bytes) and never takes a hash, a kind or an address
//! from a request.

use clan_sdk::hash::sha256_prefixed;
use serde_json::{json, Value};

use crate::document::Document;

use super::assemble::data_of;
use super::gate::{BRIEF_MAKER, SCRIPT_EDITOR, VISUAL_BRIEF};
use super::sanitize_asset_name;

/// At most this many pieces in one round.
pub const MAX_PIECES: usize = 40;

/// What a text field holds, from its app's schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// A string.
    Text,
    /// A list of strings.
    Lines,
    /// An object with these string parts and no others: (key, label).
    Parts(&'static [(&'static str, &'static str)]),
    /// A script's beats: a list of objects, each read for [`BEAT_KEYS`] and nothing else.
    Beats,
}

/// The keys of a script beat a client reads, with their labels. A beat's `id` is internal.
pub const BEAT_KEYS: &[(&str, &str)] = &[
    ("kind", "Cue"),
    ("role", "Voice"),
    ("text", "Words"),
    ("visual_action", "Picture"),
    ("voiceover", "Voiceover"),
    ("dialogue", "Dialogue"),
    ("on_screen_text", "On screen"),
    ("sound_intention", "Sound"),
    ("duration_s", "Seconds"),
];

/// One kind of document a link may show.
pub struct Spec {
    pub app_id: &'static str,
    /// What the text page is called.
    pub page_label: &'static str,
    /// The fields a client may read, in the order they are read: (key, label).
    pub fields: &'static [(&'static str, &'static str)],
    /// The schema's keys the client is never shown. With `fields`, every top-level key of the schema.
    pub never: &'static [&'static str],
    /// Where the document's media are: the slot keys under `reference_frames`, or none.
    pub frames: &'static [&'static str],
}

/// The Brief Maker brief: the thirteen fields of Phase 1, unchanged.
pub const BRIEF_FIELDS: &[(&str, &str)] = &[
    ("client", "Client"),
    ("background", "Background"),
    ("audience", "Audience"),
    ("insight", "Insight"),
    ("single_minded_proposition", "The one thing to say"),
    ("tone_and_world", "Tone and world"),
    ("objectives", "Objectives"),
    ("desired_response", "What people should think, feel and do"),
    ("famous", "What would make it famous"),
    ("reasons_to_believe", "Reasons to believe"),
    ("measurement", "How we will know it worked"),
    ("budget_and_scope", "Budget and scope"),
    ("mandatories", "Mandatories"),
];

pub const BRIEF_NEVER: &[&str] = &[
    "project_name",
    "competitor_context",
    "job",
    "barrier",
    "objection",
    "media_roles",
    "open_questions",
    "reference_assets",
    "brief_input",
    "brief_style",
    "theme",
    "field_styles",
    "layout",
    "logos",
    "locked_fields",
    "confidential_fields",
    "locked",
    "materials",
    "capture",
    "review",
    "passages",
    "projection",
    "upstream",
];

pub const SPECS: &[Spec] = &[
    Spec {
        app_id: BRIEF_MAKER,
        page_label: "The brief",
        fields: BRIEF_FIELDS,
        never: BRIEF_NEVER,
        frames: &[],
    },
    Spec {
        app_id: VISUAL_BRIEF,
        page_label: "The visual brief",
        fields: &[
            ("territory", "Territory"),
            ("proposition", "The one thing to say"),
            ("tone", "Tone"),
            ("must_show", "Must show"),
            ("never_show", "Never show"),
        ],
        // `reference_frames` are the pieces, not text
        never: &["reference_frames"],
        frames: &["a", "b", "c"],
    },
    Spec {
        app_id: SCRIPT_EDITOR,
        page_label: "The script",
        fields: &[
            ("format", "Format"),
            ("slot_s", "Slot in seconds"),
            ("proposition", "The one thing to say"),
            ("cast", "Voices"),
            ("script", "The script"),
        ],
        // the banned list, tracked changes, hand-offs and the film copy are the agency's
        never: &["checks", "handoffs", "film"],
        frames: &[],
    },
];

pub fn spec_for(app_id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.app_id == app_id)
}

/// The spec of an open document, by the app that made it.
pub fn spec_of(doc: &Document) -> Option<&'static Spec> {
    doc.clan()
        .manifest()
        .app
        .as_ref()
        .and_then(|a| spec_for(&a.app_id))
}

/// How a text field of `app_id` is read.
pub fn shape(app_id: &str, key: &str) -> Shape {
    match (app_id, key) {
        (BRIEF_MAKER, "tone_and_world" | "reasons_to_believe" | "measurement" | "mandatories") => {
            Shape::Lines
        }
        (BRIEF_MAKER, "objectives") => Shape::Parts(&[
            ("commercial", "Commercial"),
            ("behavioural", "Behavioural"),
            ("attitudinal", "Attitudinal"),
        ]),
        (BRIEF_MAKER, "desired_response") => {
            Shape::Parts(&[("think", "Think"), ("feel", "Feel"), ("do", "Do")])
        }
        (VISUAL_BRIEF, "tone" | "must_show" | "never_show") => Shape::Lines,
        (VISUAL_BRIEF, "territory") => Shape::Parts(&[("name", "Name"), ("line", "Line")]),
        (SCRIPT_EDITOR, "script") => Shape::Beats,
        _ => Shape::Text,
    }
}

/// One thing a reviewer looks at, as the issue records it.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    /// `text` for the page of words, else `human/assets/<name>`.
    pub address: String,
    /// `text`, `image`, `film` or `audio`.
    pub kind: String,
    pub label: String,
    /// The hash of the bytes the reviewer is shown (a page of words: of the document's content).
    pub sha256: String,
    /// `ai`, `none` or `not_recorded`: nothing is called AI-free without a record.
    pub ai: String,
    /// A film's or audio's length, when the host could read it.
    pub duration_ms: Option<u64>,
}

impl Piece {
    pub fn to_json(&self) -> Value {
        let mut v = json!({
            "address": self.address, "kind": self.kind, "label": self.label,
            "sha256": self.sha256, "ai": self.ai,
        });
        if let Some(ms) = self.duration_ms {
            v["duration_ms"] = json!(ms);
        }
        v
    }

    pub fn from_json(v: &Value) -> Option<Self> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(String::from);
        Some(Self {
            address: s("address")?,
            kind: s("kind")?,
            label: s("label")?,
            sha256: s("sha256")?,
            ai: s("ai").unwrap_or_else(|| "not_recorded".into()),
            duration_ms: v.get("duration_ms").and_then(Value::as_u64),
        })
    }

    /// What a link's version check compares: the same piece, the same bytes.
    pub fn same_as(&self, other: &Piece) -> bool {
        self.address == other.address && self.kind == other.kind && self.sha256 == other.sha256
    }
}

/// The kind of an asset and the content type it is served with, from its name alone and a fixed
/// list: never from the file, so a page named `.png` is still served as an image and never run.
pub fn kind_of(name: &str) -> Option<(&'static str, &'static str)> {
    let ext = name.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "svg" => ("image", "image/svg+xml"),
        "mp4" => ("film", "video/mp4"),
        "webm" => ("film", "video/webm"),
        "mp3" => ("audio", "audio/mpeg"),
        "wav" => ("audio", "audio/wav"),
        "m4a" => ("audio", "audio/mp4"),
        _ => return None,
    })
}

/// The length of an MP4 in milliseconds, from its `moov/mvhd` box; `None` when it does not say.
pub fn mp4_duration_ms(b: &[u8]) -> Option<u64> {
    fn boxes(b: &[u8]) -> Vec<(&[u8], &[u8])> {
        let mut out = Vec::new();
        let mut i = 0usize;
        while i + 8 <= b.len() {
            let size = u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
            let kind = &b[i + 4..i + 8];
            // a size of 0 runs to the end; the 64-bit form (1) is not read
            let end = if size == 0 { b.len() } else { i + size };
            if size == 1 || end > b.len() || end < i + 8 {
                break;
            }
            out.push((kind, &b[i + 8..end]));
            i = end;
        }
        out
    }
    let moov = boxes(b).into_iter().find(|(k, _)| *k == b"moov")?.1;
    let mvhd = boxes(moov).into_iter().find(|(k, _)| *k == b"mvhd")?.1;
    let (timescale, duration) = match *mvhd.first()? {
        0 => (
            u32::from_be_bytes(mvhd.get(12..16)?.try_into().ok()?) as u64,
            u32::from_be_bytes(mvhd.get(16..20)?.try_into().ok()?) as u64,
        ),
        1 => (
            u32::from_be_bytes(mvhd.get(20..24)?.try_into().ok()?) as u64,
            u64::from_be_bytes(mvhd.get(24..32)?.try_into().ok()?),
        ),
        _ => return None,
    };
    (timescale > 0).then(|| duration.saturating_mul(1000) / timescale)
}

/// The words of a frame's AI mark, as the document records them (`ai`); anything else is not recorded.
fn ai_of(frame: &Value) -> &'static str {
    match frame.get("ai").and_then(Value::as_str) {
        Some("ai") => "ai",
        Some("none") => "none",
        _ => "not_recorded",
    }
}

/// The document's content as the text page is hashed: canonical, so the same words hash the same.
pub fn content_hash_of(doc: &Document) -> Option<String> {
    Some(super::client_review::content_hash(
        &data_of(doc.clan()).ok()?,
    ))
}

/// What a reviewer looks at in `doc`, in order, or `None` when its type has no clean spec.
/// A document with media (a visual brief's frames) is its media, one piece each; any other is one
/// page of words. A medium is listed only when its file is in the document and its type is a known one.
pub fn pieces_of(doc: &Document) -> Option<Vec<Piece>> {
    let spec = spec_of(doc)?;
    let data = data_of(doc.clan()).ok()?;
    let mut out: Vec<Piece> = Vec::new();
    for slot in spec.frames {
        let Some(frame) = data.get("reference_frames").and_then(|f| f.get(*slot)) else {
            continue;
        };
        let Some(name) = frame
            .get("asset")
            .and_then(Value::as_str)
            .and_then(sanitize_asset_name)
        else {
            continue;
        };
        let Some((kind, _)) = kind_of(&name) else {
            continue;
        };
        let path = format!("human/assets/{name}");
        let Ok(bytes) = doc.clan().read_entry(&path) else {
            continue;
        };
        let label = frame
            .get("caption")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .map(String::from)
            .unwrap_or_else(|| format!("Reference {}", slot.to_ascii_uppercase()));
        out.push(Piece {
            address: path,
            kind: kind.into(),
            label,
            sha256: sha256_prefixed(&bytes),
            ai: ai_of(frame).into(),
            duration_ms: (kind == "film" && name.to_ascii_lowercase().ends_with(".mp4"))
                .then(|| mp4_duration_ms(&bytes))
                .flatten(),
        });
        if out.len() >= MAX_PIECES {
            break;
        }
    }
    if out.is_empty() {
        out.push(Piece {
            address: "text".into(),
            kind: "text".into(),
            label: spec.page_label.into(),
            sha256: content_hash_of(doc)?,
            ai: "not_recorded".into(),
            duration_ms: None,
        });
    }
    Some(out)
}

/// The bytes of a piece, read fresh from the document, and the content type it is served with:
/// only when the bytes hash to what the issue recorded.
pub fn bytes_of(doc: &Document, piece: &Piece) -> Option<(&'static str, Vec<u8>)> {
    let name = piece.address.strip_prefix("human/assets/")?;
    let name = sanitize_asset_name(name)?;
    let (kind, ctype) = kind_of(&name)?;
    if kind != piece.kind {
        return None;
    }
    let bytes = doc
        .clan()
        .read_entry(&format!("human/assets/{name}"))
        .ok()?;
    (sha256_prefixed(&bytes) == piece.sha256).then_some((ctype, bytes))
}

/// A brief point a comment may be tagged to: a field the spec shows and the document has not
/// marked confidential.
pub fn point_allowed(doc: &Document, tag: &str) -> bool {
    let Some(spec) = spec_of(doc) else {
        return false;
    };
    if !spec.fields.iter().any(|(k, _)| *k == tag) {
        return false;
    }
    let data = data_of(doc.clan()).unwrap_or(Value::Null);
    !data
        .get("confidential_fields")
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|k| k.as_str() == Some(tag)))
}
