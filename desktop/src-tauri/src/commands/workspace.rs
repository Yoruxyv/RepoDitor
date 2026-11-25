//! Verifies save identity and binds prepared projections to the open workspace.
use crate::{
    backend::{self, artwork, HostState, Operation},
    error::{self, BackendError, Outcome, Service},
    projections::{items, maps, players, run, saves, upgrades},
};
use std::{
    collections::VecDeque,
    sync::{atomic::Ordering, Arc, Mutex},
};
use tauri::Manager;

pub(super) fn check_entry_fingerprint(
    actual: Option<&str>,
    expected: Option<&str>,
) -> Result<(), BackendError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if !saves::valid_fingerprint(expected) {
        return Err(BackendError::Request);
    }
    let actual = actual
        .filter(|value| saves::valid_fingerprint(value))
        .ok_or(BackendError::Domain {
            code: "save_source_unverified",
            message: "The preview backend did not provide a valid source fingerprint.",
        })?;
    if actual != expected {
        return Err(BackendError::Domain {
            code: "save_stale",
            message: "The selected save changed during editor preparation. Open it again.",
        });
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn saves_open(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    verify_fingerprint: Option<String>,
) -> Outcome<saves::SaveOpenResult> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Save);
    };
    let state = app.state::<Arc<HostState>>().inner().clone();
    let cached = if verify_fingerprint.is_none() {
        app.state::<Mutex<EntryCache>>()
            .lock()
            .unwrap()
            .snapshots
            .iter()
            .find(|entry| entry.save == id)
            .cloned()
    } else {
        None
    };
    let (generation, cancelled) = {
        let mut registry = state.artwork.lock().unwrap();
        let cancelled = if let Some(expected) = verify_fingerprint.as_deref() {
            let Some((_, cancelled)) = registry
                .session_preparation(&id)
                .filter(|(fingerprint, _)| fingerprint == expected)
            else {
                return Outcome::for_service(Err(BackendError::Request), Service::Save);
            };
            cancelled
        } else {
            match registry.begin_open(&id) {
                Ok(cancelled) => cancelled,
                Err(error) => return Outcome::for_service(Err(error), Service::Save),
            }
        };
        (registry.generation(&id), cancelled)
    };
    let revision = cached.as_ref().map(|entry| entry.revision.clone());
    let initial_open = verify_fingerprint.is_none();
    let host = state.clone();
    let handle = app.clone();
    let result = backend::request(
        app,
        Operation::Open(id.clone(), revision, cancelled.clone()),
        move |bytes| {
            let opened = saves::parse(bytes, &id)?;
            let mut registry = host.artwork.lock().unwrap();
            if cancelled.load(Ordering::SeqCst) {
                return Err(BackendError::Cancelled);
            }
            if let Some(expected) = verify_fingerprint.as_deref() {
                if registry.generation(&id) != generation {
                    return Err(BackendError::Request);
                }
                check_entry_fingerprint(Some(opened.fingerprint()), Some(expected))?;
                return Ok(opened);
            }
            registry.open(&id, opened.fingerprint());
            let cache = handle.state::<Mutex<EntryCache>>();
            let mut cache = cache.lock().unwrap();
            cache.verified = cached
                .filter(|entry| {
                    opened.fingerprint() == entry.fingerprint
                        && opened.verified_entry_revision.as_ref() == Some(&entry.revision)
                        && cache
                            .snapshots
                            .iter()
                            .any(|current| Arc::ptr_eq(entry, current))
                })
                .and_then(|_| registry.generation(&id));
            #[cfg(feature = "health-transport")]
            host.open_editor(&id, opened.fingerprint());
            Ok(opened)
        },
    )
    .await;
    if initial_open {
        state.artwork.lock().unwrap().finish_open();
    }
    result
}

#[derive(serde::Serialize)]
pub(crate) struct EditorEntry {
    players: Outcome<Vec<players::Player>>,
    upgrades: Outcome<Vec<upgrades::Upgrade>>,
    run: Outcome<run::RunState>,
    items: Outcome<items::Advanced>,
    maps: Outcome<maps::InstalledMaps>,
}

#[derive(Default)]
pub(crate) struct EntryCache {
    snapshots: VecDeque<Arc<CachedEntry>>,
    verified: Option<uuid::Uuid>,
}

struct CachedEntry {
    save: String,
    fingerprint: String,
    revision: String,
    raw: serde_json::Value,
}

fn entry_projection<T>(
    raw: &serde_json::Value,
    parse: impl FnOnce(&[u8]) -> Result<T, BackendError>,
) -> Result<T, BackendError> {
    let bytes = serde_json::to_vec(raw).map_err(|_| BackendError::Invalid)?;
    if bytes.len() > backend::process::STDOUT_LIMIT {
        return Err(BackendError::Malformed);
    }
    parse(&bytes)
}

fn bind_editor_entry(
    raw: &serde_json::Value,
    registry: &mut artwork::Registry,
    save: &str,
    fingerprint: &str,
    generation: Option<uuid::Uuid>,
) -> Result<(EditorEntry, bool), BackendError> {
    if raw["ok"] == false {
        return Err(saves::domain_error(raw)?);
    }
    if raw["ok"] != true {
        return Err(BackendError::Invalid);
    }
    check_entry_fingerprint(raw["fingerprint"].as_str(), Some(fingerprint))?;
    if generation.is_none() || registry.generation(save) != generation {
        return Err(BackendError::Request);
    }
    let players = entry_projection(&raw["players"], players::parse);
    let run = entry_projection(&raw["run"], run::parse);
    let mut upgrades = entry_projection(&raw["upgrades"], upgrades::parse);
    let mut items = entry_projection(&raw["items"], items::parse);
    let mut maps = entry_projection(&raw["maps"], maps::parse);
    let revision = raw["artworkRevision"]
        .as_str()
        .filter(|revision| raw["maps"]["entryArtworkRevision"] == *revision);
    if let Ok(rows) = &mut upgrades {
        registry.register(save, generation, Some(fingerprint), revision, rows);
    }
    if let Ok(rows) = &mut items {
        registry.register_items(save, generation, Some(fingerprint), revision, rows);
    }
    if let Ok(catalog) = &mut maps {
        registry.register_maps(catalog);
        catalog.entry_save_verified = Some(true);
    }
    let complete =
        players.is_ok() && run.is_ok() && upgrades.is_ok() && items.is_ok() && maps.is_ok();
    Ok((
        EditorEntry {
            players: Outcome::for_service(players, Service::Player),
            upgrades: Outcome::for_service(upgrades, Service::Upgrade),
            run: Outcome::for_service(run, Service::Run),
            items: Outcome::for_service(items, Service::Items),
            maps: Outcome::for_service(maps, Service::Maps),
        },
        complete,
    ))
}

#[tauri::command]
pub(crate) async fn editor_entry(
    app: tauri::AppHandle,
    save_id: String,
    fingerprint: String,
) -> Outcome<EditorEntry> {
    let host = app.state::<Arc<HostState>>().inner().clone();
    let (generation, preparation) = {
        let registry = host.artwork.lock().unwrap();
        (
            registry.generation(&save_id),
            registry.session_preparation(&save_id),
        )
    };
    let Some((_, cancelled)) = preparation.filter(|(opened, _)| opened == &fingerprint) else {
        return Outcome::for_service(Err(BackendError::Request), Service::Save);
    };
    let cached = {
        let cache = app.state::<Mutex<EntryCache>>();
        let cache = cache.lock().unwrap();
        cache
            .snapshots
            .iter()
            .find(|entry| {
                cache.verified == generation
                    && entry.save == save_id
                    && entry.fingerprint == fingerprint
            })
            .cloned()
    };
    if let Some(cached) = cached {
        let result = bind_editor_entry(
            &cached.raw,
            &mut host.artwork.lock().unwrap(),
            &save_id,
            &fingerprint,
            generation,
        );
        return Outcome::for_service(result.map(|(entry, _)| entry), Service::Save);
    }
    let operation = Operation::Entry(save_id.clone(), fingerprint.clone(), cancelled);
    let handle = app.clone();
    backend::request(app, operation, move |bytes| {
        let raw = error::json(bytes)?;
        let mut registry = host.artwork.lock().unwrap();
        let (entry, complete) =
            bind_editor_entry(&raw, &mut registry, &save_id, &fingerprint, generation)?;
        let cache = handle.state::<Mutex<EntryCache>>();
        let mut cache = cache.lock().unwrap();
        cache.verified = None;
        cache.snapshots.retain(|entry| entry.save != save_id);
        let snapshot = raw["cacheRevision"]
            .as_str()
            .filter(|revision| {
                complete
                    && saves::valid_fingerprint(revision)
                    && raw["maps"]["entryArtworkRevision"] == *revision
            })
            .map(str::to_owned)
            .map(|revision| {
                Arc::new(CachedEntry {
                    save: save_id,
                    fingerprint,
                    revision,
                    raw,
                })
            });
        if let Some(snapshot) = snapshot {
            cache.snapshots.push_front(snapshot);
            cache.snapshots.truncate(2);
        }
        Ok(entry)
    })
    .await
}

#[cfg(test)]
#[path = "../../tests/unit/entry.rs"]
mod tests;
