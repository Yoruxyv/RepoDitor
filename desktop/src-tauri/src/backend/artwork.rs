//! Session-scoped native thumbnails. No paths, persistent pixels or mutation authority.
use crate::{
    error::{json, BackendError},
    projections::upgrades::Upgrade,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use uuid::Uuid;

pub const MAX_IMAGES: usize = 16;
pub const MAX_PNG: usize = 1024 * 1024;
const MAX_COSMETIC_BATCH: usize = 64;

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
    entries: HashMap<String, Entry>,
    item_fingerprint: String,
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
        self.item_fingerprint.clear();
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
        upgrades: &mut [Upgrade],
    ) {
        if generation.is_none() || generation != self.generation(save) {
            return;
        }
        let rows: Vec<_> = upgrades
            .iter_mut()
            .filter(|upgrade| {
                !upgrade.key.contains(['/', '\\']) && !upgrade.key.chars().any(char::is_control)
            })
            .take(MAX_IMAGES)
            .collect();
        if fingerprint == Some(self.fingerprint.as_str()) {
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
        } else {
            revoke(&mut self.entries);
        }
        self.cancel_abandoned_batch();
        let Some(fingerprint) = fingerprint.filter(|s| valid_revision(s)) else {
            return;
        };
        self.fingerprint = fingerprint.into();
        for upgrade in rows {
            let existing = self
                .entries
                .iter()
                .find(|(_, entry)| entry.key == upgrade.key)
                .map(|(token, _)| token.clone());
            upgrade.icon_token = Some(existing.unwrap_or_else(|| {
                register(&mut self.entries, Scope::Upgrade, &upgrade.key, None)
            }));
        }
    }
    pub fn register_items(
        &mut self,
        save: &str,
        generation: Option<Uuid>,
        fingerprint: Option<&str>,
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
        if self.fingerprint == fingerprint {
            for (key, icon) in projection.upgrade_icons() {
                *icon = self
                    .entries
                    .iter()
                    .find(|(_, entry)| entry.key == key)
                    .map(|(token, _)| token.clone());
            }
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PythonImage {
    source_identity: String,
    width: u32,
    height: u32,
    png_base64: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    token: String,
    revision: String,
    data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum BatchImage {
    Ready(Image),
    Deferred(bool),
    Unavailable,
}

impl ArtworkBatch {
    pub fn parse(&self, bytes: &[u8]) -> Result<Vec<BatchImage>, BackendError> {
        let mut raw = json(bytes)?;
        if raw["ok"] != true {
            return Err(BackendError::Invalid);
        }
        let images = raw
            .get_mut("artworks")
            .and_then(serde_json::Value::as_array_mut)
            .filter(|rows| rows.len() == self.members.len())
            .ok_or(BackendError::Invalid)?;
        // Re-encoding a validated PNG can grow it. Keep the renderer frame bounded too.
        let frame_limit = match self.scope {
            Scope::Item | Scope::Map => super::process::LARGE_ARTWORK_BATCH_STDOUT_LIMIT,
            _ => super::process::STDOUT_LIMIT,
        };
        let mut remaining = frame_limit - 4096;
        Ok(images
            .iter_mut()
            .zip(&self.members)
            .map(|(image, member)| {
                if member.cancelled.load(Ordering::SeqCst) {
                    return BatchImage::Unavailable;
                }
                if image.is_null() {
                    return BatchImage::Unavailable;
                }
                if *image == false {
                    return BatchImage::Deferred(false);
                }
                let revision = match self.scope {
                    Scope::Map => Some(self.fingerprint.as_str()),
                    Scope::Cosmetic => member
                        .proof
                        .as_deref()
                        .and_then(|p| p.split_once(':'))
                        .map(|(revision, _)| revision),
                    _ => None,
                };
                if self.scope == Scope::Cosmetic && revision.is_none() {
                    return BatchImage::Unavailable;
                }
                let Ok(image) = normalize(image.take(), &member.key, &member.token, revision)
                else {
                    return if self.scope == Scope::Cosmetic {
                        BatchImage::Unavailable
                    } else {
                        BatchImage::Deferred(true) // Individual response rejected by validation.
                    };
                };
                if image.data_url.len() > remaining {
                    return BatchImage::Deferred(false);
                }
                remaining -= image.data_url.len();
                BatchImage::Ready(image)
            })
            .collect())
    }
}
pub fn parse(
    bytes: &[u8],
    key: &str,
    token: &str,
    expected_revision: Option<&str>,
) -> Result<Option<Image>, BackendError> {
    let mut raw = json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let value = raw.get_mut("artwork").ok_or(BackendError::Invalid)?.take();
    if value.is_null() {
        return Ok(None);
    }
    normalize(value, key, token, expected_revision).map(Some)
}

fn normalize(
    mut value: serde_json::Value,
    key: &str,
    token: &str,
    expected_revision: Option<&str>,
) -> Result<Image, BackendError> {
    let item = Scope::Item.accepts(token);
    let map = Scope::Map.accepts(token);
    let cosmetic = Scope::Cosmetic.accepts(token);
    let multi_chunk = item || map || cosmetic;
    let key_field = if cosmetic {
        "cosmeticId"
    } else if map {
        "mapFamily"
    } else if item {
        "itemName"
    } else {
        "upgradeKey"
    };
    let response_key = value
        .as_object_mut()
        .and_then(|value| value.remove(key_field))
        .ok_or(BackendError::Invalid)?;
    let matches_key = if cosmetic {
        response_key
            .as_i64()
            .is_some_and(|id| id.to_string() == key)
    } else {
        response_key.as_str() == Some(key)
    };
    if !matches_key {
        return Err(BackendError::Invalid);
    }
    let image: PythonImage = serde_json::from_value(value).map_err(|_| BackendError::Invalid)?;
    if !valid_revision(&image.source_identity)
        || expected_revision.is_some_and(|revision| revision != image.source_identity)
        || image.png_base64.len() > MAX_PNG.div_ceil(3) * 4
    {
        return Err(BackendError::Invalid);
    }
    let png = STANDARD
        .decode(&image.png_base64)
        .map_err(|_| BackendError::Invalid)?;
    // Upgrade PNGs keep the three-chunk contract. Installed previews can use multiple IDAT chunks.
    if !(57..=MAX_PNG).contains(&png.len())
        || !png.starts_with(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")
        || if multi_chunk {
            !complete_png(&png)
        } else {
            &png[37..41] != b"IDAT"
                || u32::from_be_bytes(png[33..37].try_into().unwrap()) as usize != png.len() - 57
        }
        || !png.ends_with(b"\0\0\0\0IEND\xaeB`\x82")
    {
        return Err(BackendError::Invalid);
    }
    let mut decoder = png::Decoder::new(Cursor::new(&png));
    if multi_chunk {
        decoder.set_ignore_text_chunk(true);
        decoder.set_ignore_iccp_chunk(true);
    }
    decoder.set_limits(png::Limits {
        bytes: 8 * 1024 * 1024,
    });
    let mut reader = decoder.read_info().map_err(|_| BackendError::Invalid)?;
    let info = reader.info();
    if info.width != image.width
        || info.height != image.height
        || info.width == 0
        || info.height == 0
        || info.width > 2048
        || info.height > 2048
        || u64::from(info.width) * u64::from(info.height) > 1024 * 1024
        || info.bit_depth != png::BitDepth::Eight
        || !(info.color_type == png::ColorType::Rgba
            || (item || cosmetic) && info.color_type == png::ColorType::Rgb)
        || multi_chunk && info.interlaced
        || info.animation_control.is_some()
    {
        return Err(BackendError::Invalid);
    }
    let size = reader
        .output_buffer_size()
        .filter(|s| *s <= 4 * 1024 * 1024)
        .ok_or(BackendError::Invalid)?;
    let color = info.color_type;
    let mut pixels = vec![0; size];
    reader
        .next_frame(&mut pixels)
        .map_err(|_| BackendError::Invalid)?;
    reader.finish().map_err(|_| BackendError::Invalid)?;
    let encoded = if multi_chunk {
        let mut output = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut output, image.width, image.height);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().map_err(|_| BackendError::Invalid)?;
            writer
                .write_image_data(&pixels)
                .map_err(|_| BackendError::Invalid)?;
            writer.finish().map_err(|_| BackendError::Invalid)?;
        }
        if output.len() > MAX_PNG {
            return Err(BackendError::Invalid);
        }
        STANDARD.encode(output)
    } else {
        image.png_base64
    };
    Ok(Image {
        token: token.into(),
        revision: image.source_identity,
        data_url: format!("data:image/png;base64,{encoded}"),
    })
}

fn complete_png(png: &[u8]) -> bool {
    let mut chunks = &png[8..];
    for _ in 0..4096 {
        if chunks.len() < 12 {
            return false;
        }
        let size = u32::from_be_bytes(chunks[..4].try_into().unwrap()) as usize;
        if size > chunks.len() - 12 {
            return false;
        }
        if &chunks[4..8] == b"IEND" {
            return size == 0 && chunks.len() == 12;
        }
        chunks = &chunks[12 + size..];
    }
    false
}

#[cfg(test)]
#[path = "../../tests/unit/backend/artwork.rs"]
mod tests;
