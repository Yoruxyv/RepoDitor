//! Session-scoped upgrade thumbnails. No paths, persistent pixels or mutation authority.
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
struct Entry {
    key: String,
    cancelled: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct Registry {
    session: Option<(String, Uuid)>,
    fingerprint: String,
    entries: HashMap<String, Entry>,
}
impl Registry {
    pub fn clear(&mut self) {
        for entry in self.entries.values() {
            entry.cancelled.store(true, Ordering::SeqCst);
        }
        self.entries.clear();
        self.session = None;
        self.fingerprint.clear();
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
        for entry in self.entries.values() {
            entry.cancelled.store(true, Ordering::SeqCst);
        }
        self.entries.clear();
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
            let token = format!("upgrade-artwork:{}", Uuid::new_v4().simple());
            self.entries.insert(
                token.clone(),
                Entry {
                    key: upgrade.key.clone(),
                    cancelled: Arc::new(AtomicBool::new(true)),
                },
            );
            upgrade.icon_token = Some(token);
        }
    }
    pub fn begin(
        &mut self,
        token: &str,
    ) -> Result<(String, String, String, Arc<AtomicBool>), BackendError> {
        let entry = self.entries.get_mut(token).ok_or(BackendError::Request)?;
        if !entry.cancelled.load(Ordering::SeqCst) {
            return Err(BackendError::Failed);
        }
        entry.cancelled = Arc::new(AtomicBool::new(false));
        Ok((
            self.session
                .as_ref()
                .ok_or(BackendError::Request)?
                .0
                .clone(),
            self.fingerprint.clone(),
            entry.key.clone(),
            entry.cancelled.clone(),
        ))
    }
    pub fn cancel(&self, token: &str) {
        if let Some(entry) = self.entries.get(token) {
            entry.cancelled.store(true, Ordering::SeqCst);
        }
    }
    pub fn finish(&self, token: &str, cancelled: &Arc<AtomicBool>) -> bool {
        let valid = self
            .entries
            .get(token)
            .is_some_and(|entry| Arc::ptr_eq(&entry.cancelled, cancelled))
            && !cancelled.load(Ordering::SeqCst);
        cancelled.store(true, Ordering::SeqCst);
        valid
    }
}

pub fn valid_token(token: &str) -> bool {
    token.strip_prefix("upgrade-artwork:").is_some_and(|id| {
        id.len() == 32
            && id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
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
    upgrade_key: String,
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
pub fn parse(bytes: &[u8], key: &str, token: &str) -> Result<Option<Image>, BackendError> {
    let mut raw = json(bytes)?;
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    let value = raw.get_mut("artwork").ok_or(BackendError::Invalid)?.take();
    if value.is_null() {
        return Ok(None);
    }
    let image: PythonImage = serde_json::from_value(value).map_err(|_| BackendError::Invalid)?;
    if image.upgrade_key != key
        || !valid_revision(&image.source_identity)
        || image.png_base64.len() > MAX_PNG.div_ceil(3) * 4
    {
        return Err(BackendError::Invalid);
    }
    let png = STANDARD
        .decode(&image.png_base64)
        .map_err(|_| BackendError::Invalid)?;
    // The Python encoder emits exactly IHDR, one IDAT and IEND. Exclude ancillary payloads and trailers.
    if !(57..=MAX_PNG).contains(&png.len())
        || !png.starts_with(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")
        || &png[37..41] != b"IDAT"
        || u32::from_be_bytes(png[33..37].try_into().unwrap()) as usize != png.len() - 57
        || !png.ends_with(b"\0\0\0\0IEND\xaeB`\x82")
    {
        return Err(BackendError::Invalid);
    }
    let mut decoder = png::Decoder::new(Cursor::new(&png));
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
        || info.color_type != png::ColorType::Rgba
        || info.animation_control.is_some()
    {
        return Err(BackendError::Invalid);
    }
    let size = reader
        .output_buffer_size()
        .filter(|s| *s <= 4 * 1024 * 1024)
        .ok_or(BackendError::Invalid)?;
    reader
        .next_frame(&mut vec![0; size])
        .map_err(|_| BackendError::Invalid)?;
    reader.finish().map_err(|_| BackendError::Invalid)?;
    Ok(Some(Image {
        token: token.into(),
        revision: image.source_identity,
        data_url: format!("data:image/png;base64,{}", image.png_base64),
    }))
}

#[cfg(test)]
#[path = "../../tests/unit/backend/artwork.rs"]
mod tests;
