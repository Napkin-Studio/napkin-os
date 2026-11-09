//! What the template-app packers share: the OS's fields, the agent sphere every
//! Napkin app draws, and the app's mark.
//!
//! Included by `make_brief_maker.rs` and `make_campaign_research.rs` with
//! `#[path = "shared/app_ui.rs"] mod app_ui;` (cargo does not build this
//! directory as an example of its own).

use std::fs;
use std::path::Path;

/// Where a template asks for the OS's fields: `<clan-field>` and the rest, the
/// evidence drawer, the needs-you tray and the layout vocabulary an agent
/// composes a report from.
pub const FIELDS_MARKER: &str = "<!-- @napkin:clan-fields -->";

/// Splice `app/templates/shared/clan-fields.html` into the template at its
/// marker, when it has one (an app that shows no recorded data needs none).
/// Checked like the sphere: no closing `</body>` inside it.
pub fn inline_fields(templates: &Path, html: &str) -> Result<String, Box<dyn std::error::Error>> {
    match html.matches(FIELDS_MARKER).count() {
        0 => return Ok(html.to_string()),
        1 => {}
        _ => return Err(format!("the template has more than one {FIELDS_MARKER}").into()),
    }
    let snippet = fs::read_to_string(templates.join("shared/clan-fields.html"))
        .map_err(|e| format!("app/templates/shared/clan-fields.html: {e}"))?;
    if snippet.to_ascii_lowercase().contains("</body") {
        return Err("the fields snippet contains </body>".into());
    }
    if snippet.contains(FIELDS_MARKER) {
        return Err("the fields snippet contains its own marker".into());
    }
    Ok(html.replacen(FIELDS_MARKER, snippet.trim_end(), 1))
}

/// Where a template's `<body>` asks for the agent sphere (the mock's loading stage).
pub const SPHERE_MARKER: &str = "<!-- @napkin:agent-sphere -->";

/// The agent engine's scripts, in their order: the shared finish, the one WebGL
/// scene, the agent view (design/new-ui/identity-v4/agents/lib), the mock's extra
/// geometries, and the roles (the lookup, the words, the sphere at any size).
/// The shell loads the same files (app/src/shell/agents/engine.ts).
const SPHERE_FILES: [&str; 5] = [
    "finish.js",
    "scene.js",
    "agent-view.js",
    "extra.js",
    "roles.js",
];

/// Splice `app/templates/shared/agent-sphere/*.js` into the template at its
/// marker, as one `<script>`, when it has one. The scene appends its canvas to
/// `document.body`, so the marker sits in the body, before the app's script.
pub fn inline_sphere(templates: &Path, html: &str) -> Result<String, Box<dyn std::error::Error>> {
    match html.matches(SPHERE_MARKER).count() {
        0 => return Ok(html.to_string()),
        1 => {}
        _ => return Err(format!("the template has more than one {SPHERE_MARKER}").into()),
    }
    let mut js = String::new();
    for f in SPHERE_FILES {
        let src = fs::read_to_string(templates.join("shared/agent-sphere").join(f))
            .map_err(|e| format!("app/templates/shared/agent-sphere/{f}: {e}"))?;
        let low = src.to_ascii_lowercase();
        if low.contains("</script") || low.contains("</body") {
            return Err(format!("agent-sphere/{f} closes a script or the body").into());
        }
        js.push_str(&src);
        js.push('\n');
    }
    Ok(html.replacen(SPHERE_MARKER, &format!("<script>\n{js}</script>"), 1))
}

/// Where an app's mark lives in its archive. The manifest's `app.icon` names
/// this member (spec §28: an archive path); the host hands it to the home
/// screen inline, as a `data:` URI, because a page cannot read into an archive.
pub const ICON_PATH: &str = "app/icon.svg";

/// The app's mark, `icon.svg` beside its index.html: a single shape on a
/// transparent ground. The home screen uses it as a mask and paints it in the
/// app's zone colours, so one mark reads in light and dark.
pub fn icon_svg(template: &Path) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let svg = fs::read(template.join("icon.svg"))?;
    if !String::from_utf8_lossy(&svg)
        .trim_start()
        .starts_with("<svg")
    {
        return Err("icon.svg must be a bare <svg> document".into());
    }
    Ok(svg)
}
