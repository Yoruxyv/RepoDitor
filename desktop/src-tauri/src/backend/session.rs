//! Managed host state, including the editor generation and write grant.
use super::{artwork, operation::OPERATIONS};
#[cfg(feature = "health-transport")]
use crate::error::BackendError;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Default)]
pub struct HostState {
    pub(super) requests: [AtomicBool; OPERATIONS],
    pub(super) domain_worker: Mutex<()>,
    pub closing: Arc<AtomicBool>,
    pub artwork: Mutex<artwork::Registry>,
    pub(super) cosmetic_key: OnceLock<String>,
    #[cfg(feature = "health-transport")]
    pub(super) editor_session: Mutex<(u64, Option<(String, String)>)>,
    #[cfg(feature = "private-editing")]
    pub private_run_scope: Mutex<Option<String>>,
    #[cfg(feature = "health-transport")]
    pub meta_session: Mutex<crate::transactions::meta::Session>,
}
#[cfg(feature = "health-transport")]
#[derive(Clone)]
pub struct EditorWrite {
    pub save: String,
    pub fingerprint: String,
    pub token: String,
}

impl HostState {
    #[cfg(feature = "health-transport")]
    pub fn open_editor(&self, save: &str, fingerprint: &str) {
        let mut session = self.editor_session.lock().unwrap();
        session.0 += 1;
        session.1 = Some((save.into(), fingerprint.into()));
    }
    #[cfg(feature = "health-transport")]
    pub fn close_editor(&self, save: &str) {
        if let Ok(mut session) = self.editor_session.lock() {
            if session.1.as_ref().is_some_and(|(id, _)| id == save) {
                session.0 += 1;
                session.1 = None;
            }
        }
    }
    #[cfg(feature = "health-transport")]
    pub fn upgrade_session(&self, save: &str) -> Option<String> {
        let session = self.editor_session.lock().ok()?;
        (session.1.as_ref()?.0 == save).then(|| format!("{}-{}", std::process::id(), session.0))
    }
    #[cfg(feature = "health-transport")]
    pub fn accepts_upgrade(&self, save: &str, fingerprint: &str, token: &str) -> bool {
        let Ok(session) = self.editor_session.lock() else {
            return false;
        };
        Self::editor_matches(&session, save, fingerprint, token)
    }
    #[cfg(feature = "health-transport")]
    fn editor_matches(
        session: &(u64, Option<(String, String)>),
        save: &str,
        fingerprint: &str,
        token: &str,
    ) -> bool {
        session
            .1
            .as_ref()
            .is_some_and(|(id, fp)| id == save && fp == fingerprint)
            && token == format!("{}-{}", std::process::id(), session.0)
    }
    #[cfg(feature = "health-transport")]
    pub(super) fn launch_editor_write<T>(
        &self,
        editor: &EditorWrite,
        spawn: impl FnOnce() -> Result<T, BackendError>,
    ) -> Result<T, BackendError> {
        let session = self
            .editor_session
            .lock()
            .map_err(|_| BackendError::Request)?;
        if !Self::editor_matches(&session, &editor.save, &editor.fingerprint, &editor.token) {
            return Err(BackendError::Request);
        }
        // Close and open share this lock through process creation, then the writer owns recovery.
        spawn()
    }
    #[cfg(feature = "health-transport")]
    pub fn update_editor(&self, save: &str, fingerprint: &str, token: &str) {
        if let Ok(mut session) = self.editor_session.lock() {
            if token == format!("{}-{}", std::process::id(), session.0) {
                if let Some((id, fp)) = &mut session.1 {
                    if id == save {
                        *fp = fingerprint.into();
                    }
                }
            }
        }
    }
    #[cfg(feature = "synthetic-health-recovery")]
    pub fn health_busy(&self) -> bool {
        self.requests[9].load(Ordering::SeqCst) || self.requests[10].load(Ordering::SeqCst)
    }
    pub fn idle(&self) -> bool {
        self.requests
            .iter()
            .all(|slot| !slot.load(Ordering::SeqCst))
    }
}
