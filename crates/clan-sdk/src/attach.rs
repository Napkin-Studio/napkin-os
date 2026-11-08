//! Attach: link one existing document into another that already exists
//! (`os-layer.md` §5.7).
//!
//! A spin-off makes a *new* document from an old one. Attach keeps the
//! document and brings a source in beside its own work: the source's data
//! frozen at `data.upstream.<source document_id>`, its pins and sources merged
//! by id into the document's own, its assets copied, its decision chain
//! carried, and `lineage.attached` recording what was taken so a host can say
//! later that the source has moved on. Nothing here names an app: the target
//! app's `app.attach.accepts` does. A research linked to a brief is the first
//! use; the Brand Clan (feat/brand-clan) is the same carry.
//!
//! The three verbs are one carry:
//!
//! - **attach**: the first time this source is attached.
//! - **update**: the same source again. The frozen copy is replaced whole and
//!   only the pins, sources, assets and decisions the document does not hold
//!   yet are added.
//! - **replace**: another source of an app the document holds one of
//!   (`app.attach.many` does not name it). The old frozen copy goes. Pins,
//!   sources and assets already merged stay: they are the document's own
//!   copies now, as after a spin-off. An app in `many` is never replaced:
//!   each source of it is its own record.
//!
//! A person's work is never overwritten. A seed (`app.attach.lift`) lands only
//! in a field that is still empty, or one that still holds exactly what the
//! previous copy seeded.

use chrono::Utc;
use serde_yaml::{Mapping, Value};

use crate::container::{ClanBuilder, ClanFile, MANIFEST_PATH};
use crate::decision::{Decision, DecisionChain};
use crate::error::{Error, Result};
use crate::instantiate::{
    carry_upstream, get_dotted, seed_decision, set_dotted, take_dotted, CHAIN_PATH, DATA_PATH,
    PROJECTION_KEY, UPSTREAM_KEY, UPSTREAM_PREFIX,
};
use crate::manifest::{Attached, Manifest};

/// Who writes an attach's own decisions.
pub const ATTACH_AGENT: &str = "napkin-attach";
const ATTACH_ACTOR: &str = "process:attach";

/// What [`attach`] did, besides the new document's bytes.
#[derive(Debug, Clone)]
pub struct AttachOutcome {
    /// The target's next revision, with the source attached.
    pub bytes: Vec<u8>,
    /// What was recorded in `lineage.attached`.
    pub record: Attached,
    /// `attached`, `updated` or `replaced`.
    pub verb: AttachVerb,
    /// Dotted keys the lifts wrote.
    pub seeded: Vec<String>,
    /// Dotted keys a lift left alone because a person had written there.
    pub kept: Vec<String>,
    /// How many of the source's decisions were new to the target's chain.
    pub carried_decisions: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachVerb {
    Attached,
    Updated,
    Replaced,
}

/// What [`detach`] did.
#[derive(Debug, Clone)]
pub struct DetachOutcome {
    pub bytes: Vec<u8>,
    /// The record that was removed.
    pub record: Attached,
    /// Dotted keys removed because they still held the seeded value.
    pub unseeded: Vec<String>,
}

fn is_empty(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Sequence(s)) => s.is_empty(),
        Some(Value::Mapping(m)) => m.is_empty(),
        _ => false,
    }
}

fn parse_data(file: &ClanFile, whose: &str) -> Result<Value> {
    match file.read_entry(DATA_PATH) {
        Ok(b) if b.iter().all(u8::is_ascii_whitespace) => Ok(Value::Mapping(Mapping::new())),
        Ok(b) => match serde_yaml::from_slice::<Value>(&b) {
            Ok(Value::Null) => Ok(Value::Mapping(Mapping::new())),
            Ok(v @ Value::Mapping(_)) => Ok(v),
            _ => Err(Error::OutputRejected(format!(
                "{whose} {DATA_PATH} is not a mapping"
            ))),
        },
        Err(_) => Ok(Value::Mapping(Mapping::new())),
    }
}

fn parse_chain(file: &ClanFile, whose: &str) -> Result<DecisionChain> {
    match file.read_entry(CHAIN_PATH) {
        Ok(b) => DecisionChain::from_yaml(&b).map_err(|e| {
            Error::OutputRejected(format!("{whose} decision chain does not parse: {e}"))
        }),
        Err(_) => Ok(DecisionChain::default()),
    }
}

fn upstream_map(data: &mut Value) -> &mut Mapping {
    let m = data.as_mapping_mut().expect("data is a mapping");
    let key = Value::String(UPSTREAM_KEY.into());
    if !matches!(m.get(&key), Some(Value::Mapping(_))) {
        m.insert(key.clone(), Value::Mapping(Mapping::new()));
    }
    m.get_mut(&key)
        .and_then(Value::as_mapping_mut)
        .expect("just ensured")
}

fn entry_pairs(file: &ClanFile) -> Result<Vec<(String, Vec<u8>)>> {
    Ok(file
        .read_all_entries()?
        .into_iter()
        .filter(|(p, _)| p != MANIFEST_PATH && p != DATA_PATH && p != CHAIN_PATH)
        .collect())
}

/// Attach `source` to `target`: the target's next revision, with the source
/// carried in beside its own work. See the module docs.
///
/// Refused when the target's app declares no `attach`, does not accept the
/// source's app, has no lineage, or the source is the target itself. Locking
/// and tenancy are the host's to check.
pub fn attach(target: &ClanFile, source: &ClanFile) -> Result<AttachOutcome> {
    let tgt = target.manifest();
    let app = tgt.app.clone().ok_or_else(|| {
        Error::OutputRejected("the target has no `app` block, so it attaches nothing".into())
    })?;
    let spec = app.attach.clone().unwrap_or_default();
    let src = source.manifest();
    let src_app = src
        .app
        .as_ref()
        .map(|a| a.app_id.clone())
        .ok_or_else(|| Error::OutputRejected("the source is an app-less document".into()))?;
    if !spec.accepts.contains(&src_app) {
        return Err(Error::OutputRejected(format!(
            "{} attaches {:?}, but the source is {src_app}",
            app.name, spec.accepts
        )));
    }
    if let Some(to) = spec
        .lift
        .values()
        .find(|to| to.split('.').next() == Some(UPSTREAM_KEY))
    {
        return Err(Error::OutputRejected(format!(
            "{} lifts into {to:?}, but upstream is the frozen copy and is read-only",
            app.name
        )));
    }
    let tgt_doc = tgt.document_id().to_string();
    let src_doc = src.document_id().to_string();
    if tgt_doc == src_doc {
        return Err(Error::OutputRejected(
            "a document cannot be attached to itself".into(),
        ));
    }
    if tgt.lineage.is_none() {
        return Err(Error::OutputRejected(
            "the target has no lineage to record the attachment in".into(),
        ));
    }
    let now = Utc::now().to_rfc3339();

    // ── the data: the frozen copy, and the seeds ──────────────────────────
    let mut data = parse_data(target, "the target's")?;
    let mut src_data = parse_data(source, "the source's")?;
    let hoisted = src_data.as_mapping_mut().and_then(|m| {
        m.remove(PROJECTION_KEY);
        m.remove(UPSTREAM_KEY)
    });
    let version = get_dotted(&src_data, "kit.version").and_then(Value::as_u64);

    let many = spec.many.contains(&src_app);
    // The record this attach follows: the same source (an update), or, for an
    // app held one at a time, the one of that app (a replace).
    let prev = tgt
        .attached()
        .iter()
        .find(|a| a.carried.document_id == src_doc)
        .or_else(|| {
            (!many)
                .then(|| tgt.attached().iter().find(|a| a.app_id == src_app))
                .flatten()
        })
        .cloned();
    let verb = match &prev {
        None => AttachVerb::Attached,
        Some(p) if p.carried.document_id == src_doc => AttachVerb::Updated,
        Some(_) => AttachVerb::Replaced,
    };
    // Which version of it this document now holds: 1 on attach, one more
    // on each update.
    let taken = match (&prev, verb) {
        (Some(p), AttachVerb::Updated) => p.taken.unwrap_or(1) + 1,
        _ => 1,
    };
    // The copy the previous attach froze: what its seeds came from.
    let old_frozen = prev.as_ref().and_then(|p| {
        data.get(UPSTREAM_KEY)
            .and_then(|u| u.get(&p.carried.document_id))
            .cloned()
    });
    if let Some(p) = &prev {
        upstream_map(&mut data).remove(Value::String(p.carried.document_id.clone()));
    }

    let mut seeded = Vec::new();
    let mut kept = Vec::new();
    let mut seeds = Vec::new();
    for (from, to) in &spec.lift {
        let Some(v) = get_dotted(&src_data, from)
            .filter(|v| !v.is_null())
            .cloned()
        else {
            continue;
        };
        let cur = get_dotted(&data, to);
        let still_seeded = old_frozen
            .as_ref()
            .and_then(|o| get_dotted(o, from))
            .is_some_and(|ov| cur == Some(ov));
        if cur == Some(&v) {
            continue;
        }
        if is_empty(cur) || still_seeded {
            set_dotted(&mut data, to, v);
            seeded.push(to.clone());
            seeds.push(seed_decision(
                ATTACH_AGENT,
                ATTACH_ACTOR,
                &tgt_doc,
                &src_doc,
                &src.title,
                &app.name,
                from,
                to,
                &now,
            ));
        } else {
            kept.push(to.clone());
        }
    }

    let up = upstream_map(&mut data);
    up.insert(Value::String(src_doc.clone()), src_data);
    if let Some(Value::Mapping(older)) = hoisted {
        for (k, v) in older {
            if !up.contains_key(&k) {
                up.insert(k, v);
            }
        }
    }
    let data_bytes = serde_yaml::to_string(&data)
        .map_err(|e| Error::OutputRejected(format!("failed to serialise attached data: {e}")))?
        .into_bytes();

    // ── the chain: the target's own, then the source's, after a boundary ──
    let src_chain = parse_chain(source, "the source's")?;
    let mut chain = parse_chain(target, "the target's")?;
    let held: std::collections::BTreeSet<String> = chain
        .decisions
        .iter()
        .filter_map(|d| d.id.clone())
        .collect();
    let last_decision = src_chain.decisions.iter().find_map(|d| d.id.clone());
    let new_decisions: Vec<Decision> = src_chain
        .decisions
        .into_iter()
        .filter(|d| d.id.as_ref().map_or(true, |id| !held.contains(id)))
        .collect();
    let carried_decisions = new_decisions.len();
    if !new_decisions.is_empty() {
        let mut boundary = Decision::new(
            ATTACH_AGENT,
            format!("carried from \"{}\"", src.title),
            format!(
                "The {carried_decisions} decision(s) below this entry were made in \"{}\" ({}), \
                 not in this document. They stay as that document wrote them.",
                src.title,
                &src.id[..8.min(src.id.len())]
            ),
            now.clone(),
        );
        boundary.pinned = true;
        chain.decisions.push(boundary);
        chain.decisions.extend(new_decisions);
    }
    let noun = noun_of(src);
    let action = match verb {
        AttachVerb::Attached => "attach".to_string(),
        AttachVerb::Updated => format!("update_from_{noun}"),
        AttachVerb::Replaced => "replace".to_string(),
    };
    let version = version.or(Some(taken));
    let mut marker = Decision::new(
        ATTACH_AGENT,
        action,
        format!(
            "Took \"{}\" ({}){}: its data frozen under upstream.{src_doc}, its pins, sources \
             and assets merged, and {carried_decisions} decision(s) carried at the end of this \
             chain. It stays binding here until something in this document supersedes it.",
            src.title,
            src_app,
            version.map(|v| format!(" at v{v}")).unwrap_or_default(),
        ),
        now.clone(),
    );
    marker.pinned = true;
    marker.kind = Some("edit".into());
    marker.targets = vec![format!("{tgt_doc}#{UPSTREAM_KEY}.{src_doc}")];
    marker.version = Some(src.id.clone());
    chain.prepend(marker);
    chain.decisions.splice(0..0, seeds);
    let chain_bytes = chain.to_yaml()?;

    // ── the manifest and the entries ──────────────────────────────────────
    let mut manifest = tgt.clone();
    manifest.next_revision();
    manifest.updated_at = now.clone();
    let mut entries = entry_pairs(target)?;
    let src_entries = source.read_all_entries()?;
    let carried = carry_upstream(
        &mut manifest.files,
        &mut entries,
        source,
        &src_entries,
        &src_doc,
        source.read_entry(DATA_PATH).unwrap_or_default().as_slice(),
        last_decision,
        // An update brings the source's newer files over the older copies.
        verb == AttachVerb::Updated,
    )?;
    let record = Attached {
        app_id: src_app.clone(),
        version,
        at: now,
        title: Some(src.title.clone()),
        revision: Some(src.id.clone()),
        taken: Some(taken),
        carried,
    };
    let lineage = manifest.lineage.as_mut().expect("checked above");
    let gone = prev.as_ref().map(|p| p.carried.document_id.clone());
    lineage
        .attached
        .retain(|a| Some(&a.carried.document_id) != gone.as_ref());
    lineage.attached.push(record.clone());

    let mut builder = ClanBuilder::new(manifest);
    for (path, bytes) in entries {
        builder.add_entry(path, bytes);
    }
    builder.add_entry(DATA_PATH, data_bytes);
    builder.add_entry(CHAIN_PATH, chain_bytes);
    Ok(AttachOutcome {
        bytes: builder.build()?,
        record,
        verb,
        seeded,
        kept,
        carried_decisions,
    })
}

/// The attached record `which` names: a source's `document_id`, or, for an
/// app held one at a time, its `app_id`.
pub fn attached_record<'a>(manifest: &'a Manifest, which: &str) -> Option<&'a Attached> {
    let all = manifest.attached();
    all.iter()
        .find(|a| a.carried.document_id == which)
        .or_else(|| {
            let of_app: Vec<&Attached> = all.iter().filter(|a| a.app_id == which).collect();
            (of_app.len() == 1).then(|| of_app[0])
        })
}

/// Detach the source `which` (a `document_id`, or the `app_id` of the one
/// source of that app) from `target`: the frozen copy and its
/// record go, and so does every seed that still holds the value the copy
/// seeded. Pins, sources and assets already merged stay: they are the
/// document's own copies now.
pub fn detach(target: &ClanFile, which: &str) -> Result<DetachOutcome> {
    let tgt = target.manifest();
    let app = tgt.app.clone().ok_or_else(|| {
        Error::OutputRejected("the target has no `app` block, so it attaches nothing".into())
    })?;
    let spec = app.attach.clone().unwrap_or_default();
    let record = attached_record(tgt, which)
        .cloned()
        .ok_or_else(|| Error::OutputRejected(format!("nothing of {which} is attached")))?;
    let app_id = record.app_id.clone();
    let src_doc = record.carried.document_id.clone();
    let tgt_doc = tgt.document_id().to_string();
    let now = Utc::now().to_rfc3339();

    let mut data = parse_data(target, "the target's")?;
    let frozen = data
        .get(UPSTREAM_KEY)
        .and_then(|u| u.get(&src_doc))
        .cloned();
    let mut unseeded = Vec::new();
    if let Some(frozen) = &frozen {
        for (from, to) in &spec.lift {
            let seeded = get_dotted(frozen, from);
            if seeded.is_some() && get_dotted(&data, to) == seeded {
                take_dotted(&mut data, to);
                unseeded.push(to.clone());
            }
        }
    }
    {
        let up = upstream_map(&mut data);
        up.remove(Value::String(src_doc.clone()));
        if up.is_empty() {
            data.as_mapping_mut()
                .expect("data is a mapping")
                .remove(Value::String(UPSTREAM_KEY.into()));
        }
    }
    let data_bytes = serde_yaml::to_string(&data)
        .map_err(|e| Error::OutputRejected(format!("failed to serialise detached data: {e}")))?
        .into_bytes();

    let mut chain = parse_chain(target, "the target's")?;
    let mut marker = Decision::new(
        ATTACH_AGENT,
        "detach",
        format!(
            "Let go of {app_id} {src_doc}: its frozen copy and {} unedited seed(s) removed. \
             The pins, sources and assets already merged stay as this document's own.",
            unseeded.len()
        ),
        now.clone(),
    );
    marker.pinned = true;
    marker.targets = vec![format!("{tgt_doc}#{UPSTREAM_KEY}.{src_doc}")];
    chain.prepend(marker);
    let chain_bytes = chain.to_yaml()?;

    let mut manifest = tgt.clone();
    manifest.next_revision();
    manifest.updated_at = now;
    let gone = format!("{UPSTREAM_PREFIX}{src_doc}/");
    manifest.files.retain(|f| !f.path.starts_with(&gone));
    if let Some(l) = manifest.lineage.as_mut() {
        l.attached.retain(|a| a.carried.document_id != src_doc);
    }
    let mut builder = ClanBuilder::new(manifest);
    for (path, bytes) in entry_pairs(target)? {
        if !path.starts_with(&gone) {
            builder.add_entry(path, bytes);
        }
    }
    builder.add_entry(DATA_PATH, data_bytes);
    builder.add_entry(CHAIN_PATH, chain_bytes);
    Ok(DetachOutcome {
        bytes: builder.build()?,
        record,
        unseeded,
    })
}

/// What one document of `m`'s app is called, as a decision action names it:
/// `research`, `brief`. The app's name when its home card names no noun.
pub fn noun_of(m: &Manifest) -> String {
    m.app
        .as_ref()
        .and_then(|a| a.home.as_ref())
        .and_then(|h| h.noun.first().cloned())
        .or_else(|| m.app.as_ref().map(|a| a.name.clone()))
        .unwrap_or_else(|| "document".into())
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}
