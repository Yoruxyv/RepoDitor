//! Session-scoped native thumbnails. No paths, persistent pixels or mutation authority.
mod image;
use image::normalize;
pub use image::{parse, BatchImage, Image};

use crate::{error::BackendError, projections::upgrades::Upgrade};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use uuid::Uuid;

pub const MAX_IMAGES: usize = 16;
const MAX_COSMETIC_BATCH: usize = 112;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Upgrade,
    Item,
    Map,
    Cosmetic,
}
impl Scope {
    fn prefix(self) -> &'static str {
        match self {
            Self::Upgrade => "upgrade-artwork:",
            Self::Item => "item-artwork:",
            Self::Map => "map-artwork:",
            Self::Cosmetic => "cosmetic-artwork:",
        }
    }
    pub fn accepts(self, token: &str) -> bool {
        token.strip_prefix(self.prefix()).is_some_and(|id| {
            id.len() == 32
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    }
}
struct Entry {
    key: String,
    revision: Option<String>,
    cancelled: Arc<AtomicBool>,
}

pub struct ArtworkBatch {
    pub scope: Scope,
    pub save: Option<String>,
    pub fingerprint: String,
    pub members: Vec<BatchMember>,
    pub cancelled: Arc<AtomicBool>,
}

pub struct BatchMember {
    token: String,
    pub key: String,
    pub proof: Option<String>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Registry {
    pending_open: Option<(String, Arc<AtomicBool>)>,
    session: Option<(String, Uuid, String, Arc<AtomicBool>)>,
    fingerprint: String,
    upgrade_revision: Option<String>,
    entries: HashMap<String, Entry>,
    item_fingerprint: String,
    item_revision: Option<String>,
    items: HashMap<String, Entry>,
    maps: HashMap<String, Entry>,
    cosmetics: HashMap<String, Entry>,
    artwork_batch: Option<Arc<ArtworkBatch>>,
    cosmetic_generation: u64,
    cosmetics_warmed: bool,
    meta_fingerprint: String,
}
impl Registry {
    pub fn clear_all(&mut self) {
        if let Some((_, cancelled)) = &self.pending_open {
            cancelled.store(true, Ordering::SeqCst);
        }
        self.clear();
        revoke(&mut self.maps);
        self.revoke_cosmetics();
    }

    pub fn clear(&mut self) {
        revoke(&mut self.entries);
        revoke(&mut self.items);
        self.cancel_abandoned_batch();
        if let Some((_, _, _, cancelled)) = self.session.take() {
            cancelled.store(true, Ordering::SeqCst);
        }
        self.fingerprint.clear();
        self.upgrade_revision = None;
        self.item_fingerprint.clear();
        self.item_revision = None;
    }
    pub fn begin_open(&mut self, save: &str) -> Result<Arc<AtomicBool>, BackendError> {
        if self.pending_open.is_some() {
            return Err(BackendError::Failed);
        }
        self.clear();
        let cancelled = Arc::new(AtomicBool::new(false));
        self.pending_open = Some((save.into(), cancelled.clone()));
        Ok(cancelled)
    }
    pub fn finish_open(&mut self) {
        self.pending_open = None;
    }
    pub fn cancel_save(&mut self, save: &str) {
        if let Some((id, cancelled)) = &self.pending_open {
            if id == save {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
        if self.generation(save).is_some() {
            self.clear();
        }
    }
    pub fn open(&mut self, save: &str, fingerprint: &str) {
        self.clear();
        self.session = Some((
            save.into(),
            Uuid::new_v4(),
            fingerprint.into(),
            Arc::default(),
        ));
    }
    pub fn generation(&self, save: &str) -> Option<Uuid> {
        self.session
            .as_ref()
            .filter(|(id, _, _, _)| id == save)
            .map(|(_, generation, _, _)| *generation)
    }
    pub fn session_preparation(&self, save: &str) -> Option<(String, Arc<AtomicBool>)> {
        self.session
            .as_ref()
            .filter(|(id, _, _, _)| id == save)
            .map(|(_, _, fingerprint, cancelled)| (fingerprint.clone(), cancelled.clone()))
    }
    pub fn register(
        &mut self,
        save: &str,
        generation: Option<Uuid>,
        fingerprint: Option<&str>,
        artwork_revision: Option<&str>,
        upgrades: &mut [Upgrade],
    ) {
        if generation.is_none() || generation != self.generation(save) {
            return;
        }
        let revision = artwork_revision.filter(|revision| valid_revision(revision));
        let rows: Vec<_> = upgrades
            .iter_mut()
            .filter(|upgrade| {
                !upgrade.key.contains(['/', '\\']) && !upgrade.key.chars().any(char::is_control)
            })
            .take(MAX_IMAGES)
            .collect();
        let same_projection = revision == self.upgrade_revision.as_deref()
            && fingerprint == Some(self.fingerprint.as_str());
        if !same_projection {
            revoke(&mut self.entries);
        } else if revision.is_none() {
            // Keep active decodes. Settled images get fresh tokens so an installed asset
            // change can still be picked up when the artwork is read again.
            self.entries.retain(|_, entry| {
                let active = !entry.cancelled.load(Ordering::SeqCst)
                    && rows.iter().any(|row| row.key == entry.key);
                if !active {
                    entry.cancelled.store(true, Ordering::SeqCst);
                }
                active
            });
        }
        self.cancel_abandoned_batch();
        self.upgrade_revision = revision.map(str::to_owned);
        let Some(fingerprint) = fingerprint.filter(|s| valid_revision(s)) else {
            return;
        };
        self.fingerprint = fingerprint.into();
        for upgrade in rows {
            upgrade.icon_token = self.upgrade_token(&upgrade.key);
        }
    }

    fn upgrade_token(&mut self, key: &str) -> Option<String> {
        if key.contains(['/', '\\']) || key.chars().any(char::is_control) {
            return None;
        }
        if let Some((token, _)) = self.entries.iter().find(|(_, entry)| entry.key == key) {
            return Some(token.clone());
        }
        (self.entries.len() < MAX_IMAGES)
            .then(|| register(&mut self.entries, Scope::Upgrade, key, None))
    }

    #[cfg(feature = "production-health")]
    pub fn retain_upgrade_artwork(
        &mut self,
        save: &str,
        generation: Option<Uuid>,
        fingerprint: &str,
        artwork_revision: Option<&str>,
        upgrades: &mut [Upgrade],
    ) -> bool {
        let Some((id, current_generation, session_fingerprint, _)) = &mut self.session else {
            return false;
        };
        if id != save || generation != Some(*current_generation) {
            return false;
        }
        let retained = *session_fingerprint == self.fingerprint
            && artwork_revision.is_some()
            && artwork_revision == self.upgrade_revision.as_deref();
        *session_fingerprint = fingerprint.to_owned();
        if retained {
            // In-flight requests captured the old save fingerprint. Stop those
            // requests while retaining the authorizations for the confirmed source.
            for entry in self.entries.values() {
                entry.cancelled.store(true, Ordering::SeqCst);
            }
            for upgrade in upgrades.iter_mut().take(MAX_IMAGES) {
                upgrade.icon_token = self.upgrade_token(&upgrade.key);
            }
        } else {
            revoke(&mut self.entries);
            self.upgrade_revision = None;
        }
        self.cancel_abandoned_batch();
        self.fingerprint = fingerprint.to_owned();
        retained
    }

    fn bind_item_upgrades(&mut self, projection: &mut crate::projections::items::Advanced) {
        if self.entries.is_empty() {
            self.upgrade_revision = self.item_revision.clone();
        }
        for (key, icon) in projection.upgrade_icons() {
            *icon = self.upgrade_token(key);
        }
    }
    pub fn register_items(
        &mut self,
        save: &str,
        generation: Option<Uuid>,
        fingerprint: Option<&str>,
        artwork_revision: Option<&str>,
        projection: &mut crate::projections::items::Advanced,
    ) {
        if generation.is_none() || generation != self.generation(save) {
            return;
        }
        revoke(&mut self.items);
        self.cancel_abandoned_batch();
        let Some(fingerprint) = fingerprint.filter(|s| valid_revision(s)) else {
            return;
        };
        self.item_fingerprint = fingerprint.into();
        self.item_revision = artwork_revision
            .filter(|revision| valid_revision(revision))
            .map(str::to_owned);
        if self.entries.is_empty()
            && self
                .session
                .as_ref()
                .is_some_and(|(_, _, current, _)| current == fingerprint)
        {
            self.fingerprint = fingerprint.into();
        }
        if self.fingerprint == fingerprint
            && (self.upgrade_revision == self.item_revision || self.entries.is_empty())
        {
            self.bind_item_upgrades(projection);
        }
        // One token per type, bounded by the validated 2 MiB Items projection.
        let mut tokens = HashMap::new();
        for (name, icon) in projection.item_icons() {
            let token = tokens
                .entry(name)
                .or_insert_with_key(|name| register(&mut self.items, Scope::Item, name, None));
            *icon = Some(token.clone());
        }
    }
    #[cfg(feature = "production-health")]
    pub fn retain_item_artwork(
        &mut self,
        save: &str,
        generation: Option<Uuid>,
        fingerprint: &str,
        artwork_revision: Option<&str>,
        projection: &mut crate::projections::items::Advanced,
    ) -> bool {
        if generation.is_none()
            || generation != self.generation(save)
            || artwork_revision.is_none()
            || artwork_revision != self.item_revision.as_deref()
        {
            return false;
        }
        let tokens: HashMap<_, _> = self
            .items
            .iter()
            .map(|(token, entry)| (&entry.key, token))
            .collect();
        if projection
            .item_icons()
            .any(|(name, _)| !tokens.contains_key(&name))
        {
            return false;
        }
        for (name, icon) in projection.item_icons() {
            *icon = tokens.get(&name).map(|token| (*token).clone());
        }
        if self.fingerprint == fingerprint && self.upgrade_revision == self.item_revision {
            self.bind_item_upgrades(projection);
        }
        // Keep the already decoded tokens, while subsequent reads verify the new save bytes.
        self.item_fingerprint = fingerprint.into();
        true
    }
    pub fn register_maps(&mut self, projection: &mut crate::projections::maps::InstalledMaps) {
        revoke(&mut self.maps);
        self.cancel_abandoned_batch();
        for (family, revision, icon) in projection.artwork_rows() {
            *icon = Some(register(&mut self.maps, Scope::Map, family, Some(revision)));
        }
    }
    pub fn revoke_cosmetics(&mut self) -> u64 {
        revoke(&mut self.cosmetics);
        self.cancel_abandoned_batch();
        self.meta_fingerprint.clear();
        self.cosmetic_generation = self.cosmetic_generation.wrapping_add(1);
        self.cosmetic_generation
    }
    pub fn register_cosmetics(
        &mut self,
        generation: u64,
        projection: &mut crate::projections::cosmetics::Cosmetics,
    ) {
        if self.cosmetic_generation != generation {
            return;
        }
        self.cosmetics_warmed = true;
        self.meta_fingerprint = projection.fingerprint().to_owned();
        for (id, proof, preview, row) in projection.artwork_rows() {
            let mut parts = proof.split(':');
            let (Some(source), Some(filename), Some(file), Some(signature), None) = (
                parts.next(),
                parts.next(),
                parts.next(),
                parts.next(),
                parts.next(),
            ) else {
                continue;
            };
            if [source, filename, file, signature]
                .into_iter()
                .zip([64, 32, 64, 64])
                .all(|(part, size)| {
                    part.len() == size
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                })
            {
                // The fresh projection verifies both source and PNG identities. Keep its
                // private proof separate from the renderer's presentation-only key.
                row.icon_reuse_key =
                    Some(format!("{}:{id}:{source}:{file}", self.meta_fingerprint));
                let token = register(&mut self.cosmetics, Scope::Cosmetic, &id, Some(&proof));
                if let Some(image) = preview {
                    row.icon_preview = normalize(image, &id, &token, Some(source))
                        .ok()
                        .filter(|image| image.data_url.len() <= 256 * 1024);
                }
                row.icon_token = Some(token);
            }
        }
    }
    pub fn needs_warm_cosmetics(&self) -> bool {
        !self.cosmetics_warmed
    }
    pub fn begin(
        &mut self,
        token: &str,
    ) -> Result<(Option<String>, String, String, Arc<AtomicBool>), BackendError> {
        let map = Scope::Map.accepts(token);
        let cosmetic = Scope::Cosmetic.accepts(token);
        let save = if cosmetic {
            Some(self.meta_fingerprint.clone())
        } else if map {
            None
        } else {
            Some(
                self.session
                    .as_ref()
                    .ok_or(BackendError::Request)?
                    .0
                    .clone(),
            )
        };
        let (entries, fingerprint) = if cosmetic {
            (&mut self.cosmetics, "")
        } else if map {
            (&mut self.maps, "")
        } else if Scope::Item.accepts(token) {
            (&mut self.items, self.item_fingerprint.as_str())
        } else {
            (&mut self.entries, self.fingerprint.as_str())
        };
        let entry = entries.get_mut(token).ok_or(BackendError::Request)?;
        if !entry.cancelled.load(Ordering::SeqCst) {
            return Err(BackendError::Failed);
        }
        entry.cancelled = Arc::new(AtomicBool::new(false));
        Ok((
            save,
            entry.revision.as_deref().unwrap_or(fingerprint).to_owned(),
            entry.key.clone(),
            entry.cancelled.clone(),
        ))
    }
    pub fn cancel(&self, token: &str) {
        if let Some(entry) = self.entry(token) {
            entry.cancelled.store(true, Ordering::SeqCst);
        }
        self.cancel_abandoned_batch();
    }
    fn cancel_abandoned_batch(&self) {
        if let Some(batch) = &self.artwork_batch {
            if batch
                .members
                .iter()
                .all(|row| row.cancelled.load(Ordering::SeqCst))
            {
                batch.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
    pub fn finish(&self, token: &str, cancelled: &Arc<AtomicBool>) -> bool {
        let valid = self
            .entry(token)
            .is_some_and(|entry| Arc::ptr_eq(&entry.cancelled, cancelled))
            && !cancelled.load(Ordering::SeqCst);
        cancelled.store(true, Ordering::SeqCst);
        valid
    }
    pub fn retire_cosmetic(&mut self, token: &str) {
        self.cosmetics.remove(token);
    }

    pub fn begin_artwork_batch(
        &mut self,
        scope: Scope,
        tokens: Vec<String>,
    ) -> Result<Arc<ArtworkBatch>, BackendError> {
        let (save, fingerprint, entries) = match scope {
            Scope::Cosmetic => (None, self.meta_fingerprint.clone(), &mut self.cosmetics),
            Scope::Upgrade | Scope::Item => (
                Some(
                    self.session
                        .as_ref()
                        .ok_or(BackendError::Request)?
                        .0
                        .clone(),
                ),
                if scope == Scope::Item {
                    self.item_fingerprint.clone()
                } else {
                    self.fingerprint.clone()
                },
                if scope == Scope::Item {
                    &mut self.items
                } else {
                    &mut self.entries
                },
            ),
            Scope::Map => (
                None,
                tokens
                    .first()
                    .and_then(|token| self.maps.get(token))
                    .and_then(|entry| entry.revision.clone())
                    .ok_or(BackendError::Request)?,
                &mut self.maps,
            ),
        };
        let limit = match scope {
            Scope::Upgrade => MAX_IMAGES,
            Scope::Item => 64,
            Scope::Map => 5,
            Scope::Cosmetic => MAX_COSMETIC_BATCH,
        };
        if !(2..=limit).contains(&tokens.len())
            || !valid_revision(&fingerprint)
            || tokens.iter().enumerate().any(|(i, token)| {
                !scope.accepts(token)
                    || tokens[..i].contains(token)
                    || entries.get(token).is_none_or(|entry| {
                        scope == Scope::Map
                            && entry.revision.as_deref() != Some(fingerprint.as_str())
                    })
            })
        {
            return Err(BackendError::Request);
        }
        if self.artwork_batch.is_some()
            || tokens
                .iter()
                .any(|token| !entries[token].cancelled.load(Ordering::SeqCst))
        {
            return Err(BackendError::Failed);
        }
        let members = tokens
            .into_iter()
            .map(|token| {
                let entry = entries.get_mut(&token).expect("admitted batch token");
                entry.cancelled = Arc::new(AtomicBool::new(false));
                BatchMember {
                    token,
                    key: entry.key.clone(),
                    proof: entry.revision.clone(),
                    cancelled: entry.cancelled.clone(),
                }
            })
            .collect();
        let batch = Arc::new(ArtworkBatch {
            scope,
            save,
            fingerprint,
            members,
            cancelled: Arc::new(AtomicBool::new(false)),
        });
        self.artwork_batch = Some(batch.clone());
        Ok(batch)
    }

    pub fn finish_artwork_batch(
        &mut self,
        batch: &Arc<ArtworkBatch>,
        mut images: Option<&mut [BatchImage]>,
    ) {
        if self
            .artwork_batch
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, batch))
        {
            self.artwork_batch = None;
        }
        for (index, member) in batch.members.iter().enumerate() {
            if !self.finish(&member.token, &member.cancelled) {
                if let Some(rows) = images.as_deref_mut() {
                    rows[index] = BatchImage::Unavailable;
                }
            }
        }
    }
    fn entry(&self, token: &str) -> Option<&Entry> {
        if Scope::Cosmetic.accepts(token) {
            self.cosmetics.get(token)
        } else if Scope::Map.accepts(token) {
            self.maps.get(token)
        } else if Scope::Item.accepts(token) {
            self.items.get(token)
        } else {
            self.entries.get(token)
        }
    }
}

fn register(
    entries: &mut HashMap<String, Entry>,
    scope: Scope,
    key: &str,
    revision: Option<&str>,
) -> String {
    let token = format!("{}{}", scope.prefix(), Uuid::new_v4().simple());
    entries.insert(
        token.clone(),
        Entry {
            key: key.into(),
            revision: revision.map(str::to_owned),
            cancelled: Arc::new(AtomicBool::new(true)),
        },
    );
    token
}
fn revoke(entries: &mut HashMap<String, Entry>) {
    for entry in entries.values() {
        entry.cancelled.store(true, Ordering::SeqCst);
    }
    entries.clear();
}
pub(crate) fn valid_revision(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
#[path = "../../../tests/unit/backend/artwork.rs"]
mod tests;
