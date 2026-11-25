//! Validate sidecar image identity and bound decoded PNG and renderer frames.
use super::{valid_revision, ArtworkBatch, Scope};
use crate::error::{json, BackendError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{io::Cursor, sync::atomic::Ordering};

pub(super) const MAX_PNG: usize = 1024 * 1024;

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
    pub(super) data_url: String,
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
            Scope::Cosmetic => crate::backend::process::COSMETIC_BATCH_STDOUT_LIMIT,
            Scope::Item | Scope::Map => crate::backend::process::LARGE_ARTWORK_BATCH_STDOUT_LIMIT,
            _ => crate::backend::process::STDOUT_LIMIT,
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

pub(super) fn normalize(
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
