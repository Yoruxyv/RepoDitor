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
#[derive(Default)]
pub struct Registry {
    session: Option<(String, Uuid)>,
    fingerprint: String,
    entries: HashMap<String, Entry>,
    item_fingerprint: String,
    items: HashMap<String, Entry>,
    maps: HashMap<String, Entry>,
    cosmetics: HashMap<String, Entry>,
    cosmetic_generation: u64,
    meta_fingerprint: String,
}
impl Registry {
    pub fn clear_all(&mut self) {
        self.clear();
        revoke(&mut self.maps);
        self.revoke_cosmetics();
    }

    pub fn clear(&mut self) {
        revoke(&mut self.entries);
        revoke(&mut self.items);
        self.session = None;
        self.fingerprint.clear();
        self.item_fingerprint.clear();
    }
    pub fn open(&mut self, save: &str) {
        self.clear();
        self.session = Some((save.into(), Uuid::new_v4()));
    }
    pub fn generation(&self, save: &str) -> Option<Uuid> {
        self.session
            .as_ref()
            .filter(|(id, _)| id == save)
            .map(|(_, generation)| *generation)
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
        revoke(&mut self.entries);
        let Some(fingerprint) = fingerprint.filter(|s| valid_revision(s)) else {
            return;
        };
        self.fingerprint = fingerprint.into();
        for upgrade in upgrades
            .iter_mut()
            .filter(|upgrade| {
                !upgrade.key.contains(['/', '\\']) && !upgrade.key.chars().any(char::is_control)
            })
            .take(MAX_IMAGES)
        {
            upgrade.icon_token = Some(register(
                &mut self.entries,
                Scope::Upgrade,
                &upgrade.key,
                None,
            ));
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
        let Some(fingerprint) = fingerprint.filter(|s| valid_revision(s)) else {
            return;
        };
        self.item_fingerprint = fingerprint.into();
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
        for (family, revision, icon) in projection.artwork_rows() {
            *icon = Some(register(&mut self.maps, Scope::Map, family, Some(revision)));
        }
    }
    pub fn revoke_cosmetics(&mut self) -> u64 {
        revoke(&mut self.cosmetics);
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
        self.meta_fingerprint = projection.fingerprint().to_owned();
        for (id, proof, icon) in projection.artwork_rows() {
            if proof.len() == 227
                && proof.split(':').zip([64, 32, 64, 64]).all(|(part, size)| {
                    part.len() == size
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                })
                && proof.split(':').count() == 4
            {
                *icon = Some(register(
                    &mut self.cosmetics,
                    Scope::Cosmetic,
                    &id,
                    Some(&proof),
                ));
            }
        }
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
fn valid_revision(value: &str) -> bool {
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    token: String,
    revision: String,
    data_url: String,
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
    let mut value = raw.get_mut("artwork").ok_or(BackendError::Invalid)?.take();
    if value.is_null() {
        return Ok(None);
    }
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
    Ok(Some(Image {
        token: token.into(),
        revision: image.source_identity,
        data_url: format!("data:image/png;base64,{encoded}"),
    }))
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
