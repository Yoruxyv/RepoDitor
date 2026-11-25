//! Read commands for editor tabs after a workspace is opened.
use super::workspace::check_entry_fingerprint;
use crate::{
    backend::{self, HostState, Operation},
    error::{self, BackendError, Outcome, Service},
    projections::{cosmetics, items, maps, players, run, saves, upgrades},
};
use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;

#[tauri::command]
pub(crate) async fn players_list(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    prepare_fingerprint: Option<String>,
) -> Outcome<Vec<players::Player>> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Player);
    };
    backend::request(app, Operation::Players(id), move |bytes| {
        let values = players::parse(bytes)?;
        if let Some(expected) = prepare_fingerprint.as_deref() {
            check_entry_fingerprint(error::json(bytes)?["fingerprint"].as_str(), Some(expected))?;
        }
        Ok(values)
    })
    .await
}

#[tauri::command]
pub(crate) async fn players_avatar(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    player_id: Option<serde_json::Value>,
) -> Outcome<players::Avatar> {
    let ids = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .zip(
            player_id
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .filter(|id| players::valid_id(id)),
        );
    let Some((save, player)) = ids else {
        return Outcome::for_service(Err(BackendError::Request), Service::Player);
    };
    let player = player.to_owned();
    let cancelled = app
        .state::<Arc<HostState>>()
        .artwork
        .lock()
        .unwrap()
        .session_preparation(save)
        .map(|(_, cancelled)| cancelled);
    let active = cancelled.clone();
    backend::request(
        app,
        Operation::Avatar(save.to_owned(), player.clone(), cancelled),
        move |bytes| {
            if active.is_some_and(|cancelled| cancelled.load(Ordering::SeqCst)) {
                return Err(BackendError::Cancelled);
            }
            players::parse_avatar(bytes, &player)
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn upgrades_list(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    background: Option<bool>,
    prepare_fingerprint: Option<String>,
) -> Outcome<Vec<upgrades::Upgrade>> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Upgrade);
    };
    let state = app.state::<Arc<HostState>>().inner().clone();
    // Synthetic transaction reads keep their existing worker ordering.
    let preparing = background == Some(true) && !cfg!(feature = "synthetic-health-recovery");
    let (generation, preparation) = {
        let registry = state.artwork.lock().unwrap();
        (
            registry.generation(&id),
            preparing
                .then(|| registry.session_preparation(&id))
                .flatten(),
        )
    };
    if preparing && preparation.is_none() {
        return Outcome::for_service(Err(BackendError::Request), Service::Upgrade);
    }
    let cancelled = preparation.map(|(_, cancelled)| cancelled);
    backend::request(
        app,
        Operation::Upgrades(id.clone(), cancelled),
        move |bytes| {
            let mut values = upgrades::parse(bytes)?;
            let raw = error::json(bytes)?;
            let mut registry = state.artwork.lock().unwrap();
            if generation.is_some() && registry.generation(&id) != generation {
                return Err(BackendError::Cancelled);
            }
            let current = registry
                .session_preparation(&id)
                .map(|(fingerprint, _)| fingerprint);
            let fingerprint = raw["fingerprint"].as_str();
            if preparing {
                check_entry_fingerprint(fingerprint, current.as_deref())?;
            }
            check_entry_fingerprint(fingerprint, prepare_fingerprint.as_deref())?;
            // Read-only queries can return updated values without issuing artwork
            // tokens for bytes outside the open workspace's validated snapshot.
            if cfg!(feature = "synthetic-health-recovery") || fingerprint == current.as_deref() {
                registry.register(
                    &id,
                    generation,
                    fingerprint,
                    raw["artworkRevision"].as_str(),
                    &mut values,
                );
            }
            Ok(values)
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn cosmetics_get(app: tauri::AppHandle) -> Outcome<cosmetics::Cosmetics> {
    let state = app.state::<Arc<HostState>>().inner().clone();
    let (generation, warm_artwork) = {
        let mut registry = state.artwork.lock().unwrap();
        (registry.revoke_cosmetics(), registry.needs_warm_cosmetics())
    };
    backend::request(app, Operation::Cosmetics(warm_artwork), move |bytes| {
        let mut data = cosmetics::parse(bytes)?;
        state
            .artwork
            .lock()
            .unwrap()
            .register_cosmetics(generation, &mut data);
        Ok(data)
    })
    .await
}

#[tauri::command]
pub(crate) async fn maps_list(
    app: tauri::AppHandle,
    entry_proof: Option<bool>,
    validate_only: Option<bool>,
    verify_save_id: Option<String>,
    verify_fingerprint: Option<String>,
) -> Outcome<maps::InstalledMaps> {
    let state = app.state::<Arc<HostState>>().inner().clone();
    let proof = entry_proof == Some(true);
    let save_proof = match (verify_save_id, verify_fingerprint) {
        (None, None) => None,
        (Some(id), Some(fingerprint)) if proof && saves::valid_id(&id) => {
            let registry = state.artwork.lock().unwrap();
            if !registry
                .session_preparation(&id)
                .is_some_and(|(current, _)| current == fingerprint)
            {
                return Outcome::for_service(Err(BackendError::Request), Service::Maps);
            }
            let generation = registry.generation(&id);
            Some((id, fingerprint, generation))
        }
        _ => return Outcome::for_service(Err(BackendError::Request), Service::Maps),
    };
    backend::request(
        app,
        Operation::Maps(proof, save_proof.as_ref().map(|(id, _, _)| id.clone())),
        move |bytes| {
            let mut data = maps::parse(bytes)?;
            let mut registry = state.artwork.lock().unwrap();
            if let Some((id, expected, generation)) = save_proof {
                if registry.generation(&id) != generation {
                    return Err(BackendError::Request);
                }
                let raw = error::json(bytes)?;
                // Older fixture sidecars omit the combined proof. The caller still verifies separately.
                if let Some(actual) = raw.get("entrySaveFingerprint") {
                    check_entry_fingerprint(actual.as_str(), Some(&expected))?;
                    data.entry_save_verified = Some(true);
                }
            }
            if validate_only != Some(true) {
                registry.register_maps(&mut data);
            }
            Ok(data)
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn run_get(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    prepare_fingerprint: Option<String>,
) -> Outcome<run::RunState> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Run);
    };
    backend::request(app, Operation::Run(id), move |bytes| {
        let value = run::parse(bytes)?;
        if let Some(expected) = prepare_fingerprint.as_deref() {
            check_entry_fingerprint(error::json(bytes)?["fingerprint"].as_str(), Some(expected))?;
        }
        Ok(value)
    })
    .await
}

#[tauri::command]
pub(crate) async fn advanced_get(
    app: tauri::AppHandle,
    save_id: Option<serde_json::Value>,
    prepare_fingerprint: Option<String>,
    background: Option<bool>,
) -> Outcome<items::Advanced> {
    let Some(id) = save_id
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|id| saves::valid_id(id))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), Service::Items);
    };
    let state = app.state::<Arc<HostState>>().inner().clone();
    let refreshing = !cfg!(feature = "synthetic-health-recovery") && background == Some(true);
    let (generation, cancelled) = {
        let registry = state.artwork.lock().unwrap();
        let cancelled = registry
            .session_preparation(&id)
            .map(|(_, cancelled)| cancelled);
        (registry.generation(&id), cancelled)
    };
    if refreshing && (cancelled.is_none() || prepare_fingerprint.is_none()) {
        return Outcome::for_service(Err(BackendError::Request), Service::Items);
    }
    backend::request(
        app,
        Operation::Items(id.clone(), cancelled, refreshing),
        move |bytes| {
            let mut values = items::parse(bytes)?;
            let raw = error::json(bytes)?;
            let mut registry = state.artwork.lock().unwrap();
            if generation.is_some() && registry.generation(&id) != generation {
                return Err(BackendError::Cancelled);
            }
            check_entry_fingerprint(raw["fingerprint"].as_str(), prepare_fingerprint.as_deref())?;
            if refreshing {
                let current = registry
                    .session_preparation(&id)
                    .map(|(fingerprint, _)| fingerprint);
                check_entry_fingerprint(raw["fingerprint"].as_str(), current.as_deref())?;
            }
            registry.register_items(
                &id,
                generation,
                raw["fingerprint"].as_str(),
                raw["artworkRevision"].as_str(),
                &mut values,
            );
            Ok(values)
        },
    )
    .await
}
