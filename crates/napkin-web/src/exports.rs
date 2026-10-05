// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Composed exports waiting to be fetched.
//!
//! The host composes a standalone document and hands back a temp file, then
//! raises `ExportRequest` so the shell can decide where it goes. The desktop
//! answers with a save dialog. The browser cannot be handed a server path, so
//! the temp file is stashed here behind an opaque handle and the event carries
//! that instead — which keeps the shell contract identical on both.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::tenant::TenantId;

/// An export the user never fetches is dead weight; a browser that is going to
/// fetch it does so immediately.
const TTL: Duration = Duration::from_secs(15 * 60);

struct Pending {
    tenant: TenantId,
    /// The app frame's token that asked for it, when an app did. Its handle
    /// goes out on the tenant's event stream, which every tab of the tenant
    /// (in accounts mode, the whole agency) hears; only this token claims it.
    owner: Option<String>,
    tmp_html: String,
    filename: String,
    expires: Instant,
}

#[derive(Default)]
pub struct ExportStore {
    pending: Mutex<HashMap<String, Pending>>,
}

impl ExportStore {
    /// Stash an export. `owner` is the asking frame's token for an app's own
    /// export; the OS export's handle goes back in the asking request's reply
    /// only, so it needs none.
    pub fn stash(
        &self,
        tenant: &TenantId,
        tmp_html: String,
        filename: String,
        owner: Option<&str>,
    ) -> String {
        let handle = uuid::Uuid::new_v4().simple().to_string();
        let mut pending = self.pending.lock().unwrap();
        self.sweep(&mut pending);
        pending.insert(
            handle.clone(),
            Pending {
                tenant: tenant.clone(),
                owner: owner.map(String::from),
                tmp_html,
                filename,
                expires: Instant::now() + TTL,
            },
        );
        handle
    }

    /// Claim an export. Single use: the temp file is consumed by rendering it.
    /// A handle of another tenant, or an owned one claimed without its
    /// owner's token, reads as absent and stays for its owner.
    pub fn take(
        &self,
        tenant: &TenantId,
        handle: &str,
        token: Option<&str>,
    ) -> Option<(String, String)> {
        let mut pending = self.pending.lock().unwrap();
        self.sweep(&mut pending);
        // Another tenant's handle reads as absent, not as forbidden.
        pending
            .get(handle)
            .filter(|p| &p.tenant == tenant)
            .filter(|p| p.owner.is_none() || p.owner.as_deref() == token)?;
        let p = pending.remove(handle)?;
        Some((p.tmp_html, p.filename))
    }

    /// Drop what has expired, deleting the temp files with it.
    fn sweep(&self, pending: &mut HashMap<String, Pending>) {
        let now = Instant::now();
        pending.retain(|_, p| {
            let live = p.expires > now;
            if !live {
                let _ = std::fs::remove_file(&p.tmp_html);
            }
            live
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_handle_is_single_use_and_tenant_scoped() {
        let store = ExportStore::default();
        let a = TenantId::mint();
        let b = TenantId::mint();

        let handle = store.stash(&a, "/tmp/x.html".into(), "brief".into(), None);
        assert!(
            store.take(&b, &handle, None).is_none(),
            "another tenant must not claim it"
        );
        assert_eq!(store.take(&a, &handle, None).unwrap().1, "brief");
        assert!(
            store.take(&a, &handle, None).is_none(),
            "a claimed export is gone"
        );
    }

    #[test]
    fn an_apps_export_is_claimed_only_with_its_frames_token() {
        let store = ExportStore::default();
        let a = TenantId::mint();
        let handle = store.stash(&a, "/tmp/y.html".into(), "brief".into(), Some("frame-a"));
        assert!(store.take(&a, &handle, None).is_none());
        assert!(store.take(&a, &handle, Some("frame-b")).is_none());
        // the failed claims leave it for its owner
        assert_eq!(store.take(&a, &handle, Some("frame-a")).unwrap().1, "brief");
    }
}
