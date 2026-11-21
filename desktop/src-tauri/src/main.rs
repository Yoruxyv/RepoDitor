#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
mod error;
mod legacy_install;
mod projections;
#[cfg(feature = "health-transport")]
mod synthetic;

use backend::{artwork, HostState, Operation};
use error::{BackendError, Outcome, Service};
use projections::{cosmetics, discovery, game, items, maps, players, run, saves, upgrades};
use std::{
    collections::VecDeque,
    sync::{atomic::Ordering, Arc, Mutex},
    time::Instant,
};
#[cfg(feature = "health-transport")]
use synthetic::recovery;
use tauri::Manager;

const PROJECT_SOURCE_URL: &str = "https://github.com/Yoruxyv/RepoDitor";

fn handle_project_window(url: &tauri::Url, open: impl FnOnce(&str)) {
    let target = url.as_str();
    let release = target
        .strip_prefix(PROJECT_SOURCE_URL)
        .and_then(|path| path.strip_prefix("/releases/tag/"))
        .is_some_and(|tag| {
            !tag.is_empty()
                && tag.len() <= 129
                && tag
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
        });
    if target == PROJECT_SOURCE_URL
        || target.strip_prefix(PROJECT_SOURCE_URL) == Some("/releases")
        || release
    {
        open(target);
    }
}

fn open_system_url(target: &str) -> bool {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let url: Vec<_> = target.encode_utf16().chain(Some(0)).collect();
    // WebView2 dispatches this handler on its COM-initialized UI thread.
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            windows_sys::w!("open"),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        ) as isize
            > 32
    }
}

#[tauri::command]
fn legacy_install_registered() -> bool {
    legacy_install::is_registered()
}

#[tauri::command]
fn open_installed_apps() -> bool {
    open_system_url("ms-settings:appsfeatures")
}

#[cfg(all(windows, feature = "native-ui-test"))]
fn ui_test_args(template: &str, e2e: &str, port: &str) -> Result<String, &'static str> {
    if e2e != "1"
        || !port.parse::<u16>().is_ok_and(|value| value >= 1024)
        || template.matches("{{CDP_PORT}}").count() != 1
    {
        return Err("Invalid isolated UI test configuration");
    }
    Ok(template.replace("{{CDP_PORT}}", port))
}

fn allowed_navigation(url: &tauri::Url) -> bool {
    url.path() == "/tauri.html"
        && ((url.port().is_none()
            && ((url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))))
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(1420)))
}

#[derive(Default)]
struct InitialDiscovery(
    Mutex<Option<tauri::async_runtime::JoinHandle<Outcome<discovery::EnvironmentDiscovery>>>>,
);

#[tauri::command]
async fn environment_detect(app: tauri::AppHandle) -> Outcome<discovery::EnvironmentDiscovery> {
    let initial = app.state::<InitialDiscovery>().0.lock().unwrap().take();
    if let Some(initial) = initial {
        return initial.await.unwrap_or_else(|_| {
            Outcome::for_service(Err(BackendError::Failed), Service::Discovery)
        });
    }
    backend::request(app, Operation::Discovery, discovery::parse).await
}

fn check_entry_fingerprint(
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
async fn saves_open(
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

#[tauri::command]
async fn game_status(app: tauri::AppHandle) -> Outcome<game::GameState> {
    backend::request(app, Operation::Game, game::parse).await
}

#[derive(serde::Serialize)]
struct EditorEntry {
    players: Outcome<Vec<players::Player>>,
    upgrades: Outcome<Vec<upgrades::Upgrade>>,
    run: Outcome<run::RunState>,
    items: Outcome<items::Advanced>,
    maps: Outcome<maps::InstalledMaps>,
}

#[derive(Default)]
struct EntryCache {
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
    if let Ok(rows) = &mut upgrades {
        registry.register(save, generation, Some(fingerprint), rows);
    }
    if let Ok(rows) = &mut items {
        let revision = raw["cacheRevision"]
            .as_str()
            .filter(|revision| raw["maps"]["entryArtworkRevision"] == *revision);
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
async fn editor_entry(
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

#[tauri::command]
async fn players_list(
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
async fn players_avatar(
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
async fn upgrades_list(
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
    let (fingerprint, cancelled) = preparation.unzip();
    backend::request(
        app,
        Operation::Upgrades(id.clone(), cancelled),
        move |bytes| {
            let mut values = upgrades::parse(bytes)?;
            let raw = error::json(bytes)?;
            let mut registry = state.artwork.lock().unwrap();
            if preparing && registry.generation(&id) != generation {
                return Err(BackendError::Cancelled);
            }
            check_entry_fingerprint(raw["fingerprint"].as_str(), fingerprint.as_deref())?;
            check_entry_fingerprint(raw["fingerprint"].as_str(), prepare_fingerprint.as_deref())?;
            registry.register(&id, generation, raw["fingerprint"].as_str(), &mut values);
            Ok(values)
        },
    )
    .await
}

#[tauri::command]
async fn upgrade_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
) -> ArtworkOutcome {
    get_artwork_response(
        app,
        token,
        tokens,
        artwork::Scope::Upgrade,
        Service::Upgrade,
    )
    .await
}

#[tauri::command]
async fn item_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
) -> ArtworkOutcome {
    get_artwork_response(app, token, tokens, artwork::Scope::Item, Service::Items).await
}

#[tauri::command]
async fn map_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
) -> ArtworkOutcome {
    get_artwork_response(app, token, tokens, artwork::Scope::Map, Service::Maps).await
}

#[tauri::command]
async fn cosmetic_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
) -> ArtworkOutcome {
    get_artwork_response(
        app,
        token,
        tokens,
        artwork::Scope::Cosmetic,
        Service::Cosmetics,
    )
    .await
}

async fn get_artwork_response(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
    scope: artwork::Scope,
    service: Service,
) -> ArtworkOutcome {
    match (token, tokens) {
        (None, Some(tokens)) => {
            ArtworkOutcome::Batch(get_artwork_batch(app, tokens, scope, service).await)
        }
        (token, None) => ArtworkOutcome::Single(get_artwork(app, token, scope, service).await),
        (Some(_), Some(_)) => {
            ArtworkOutcome::Single(Outcome::for_service(Err(BackendError::Request), service))
        }
    }
}

#[derive(serde::Serialize)]
#[serde(untagged)]
enum ArtworkOutcome {
    Single(Outcome<Option<artwork::Image>>),
    Batch(Outcome<Vec<artwork::BatchImage>>),
}

async fn get_artwork_batch(
    app: tauri::AppHandle,
    tokens: Vec<String>,
    scope: artwork::Scope,
    service: Service,
) -> Outcome<Vec<artwork::BatchImage>> {
    let state = app.state::<Arc<HostState>>().inner().clone();
    let admission = state
        .artwork
        .lock()
        .unwrap()
        .begin_artwork_batch(scope, tokens);
    let batch = match admission {
        Ok(batch) => batch,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
    let parser = batch.clone();
    let mut response =
        backend::request(app, Operation::ArtworkBatch(batch.clone()), move |bytes| {
            parser.parse(bytes)
        })
        .await;
    let images = match &mut response {
        Outcome::Success { data, .. } => Some(data.as_mut_slice()),
        Outcome::Failure { .. } => None,
    };
    state
        .artwork
        .lock()
        .unwrap()
        .finish_artwork_batch(&batch, images);
    response
}

async fn get_artwork(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    scope: artwork::Scope,
    service: Service,
) -> Outcome<Option<artwork::Image>> {
    let Some(token) = token
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .filter(|token| scope.accepts(token))
        .map(str::to_owned)
    else {
        return Outcome::for_service(Err(BackendError::Request), service);
    };
    let state = app.state::<Arc<HostState>>().inner().clone();
    let request = state.artwork.lock().unwrap().begin(&token);
    let (save, fingerprint, key, cancelled) = match request {
        Ok(request) => request,
        Err(error) => return Outcome::for_service(Err(error), service),
    };
    let token_check = token.clone();
    let revision = match scope {
        artwork::Scope::Map => Some(fingerprint.clone()),
        artwork::Scope::Cosmetic => fingerprint
            .split_once(':')
            .map(|(revision, _)| revision.to_owned()),
        _ => None,
    };
    let response = backend::request(
        app,
        Operation::Artwork(scope, save, fingerprint, key.clone(), cancelled.clone()),
        move |bytes| artwork::parse(bytes, &key, &token_check, revision.as_deref()),
    )
    .await;
    let mut registry = state.artwork.lock().unwrap();
    if registry.finish(&token, &cancelled) {
        if scope == artwork::Scope::Cosmetic
            && matches!(&response, Outcome::Success { data: None, .. })
        {
            registry.retire_cosmetic(&token);
        }
        response
    } else {
        Outcome::for_service(Err(BackendError::Cancelled), service)
    }
}

#[tauri::command]
fn upgrade_artwork_cancel(app: tauri::AppHandle, token: Option<String>, save_id: Option<String>) {
    let state = app.state::<Arc<HostState>>();
    let mut registry = state.artwork.lock().unwrap();
    if let Some(token) = token
        .as_deref()
        .filter(|token| artwork::Scope::Upgrade.accepts(token))
    {
        registry.cancel(token);
    } else if token.is_none() {
        if let Some(id) = save_id.as_deref().filter(|id| saves::valid_id(id)) {
            #[cfg(feature = "health-transport")]
            state.close_editor(id);
            registry.cancel_save(id);
        }
    }
}

#[tauri::command]
fn item_artwork_cancel(app: tauri::AppHandle, token: String) {
    if artwork::Scope::Item.accepts(&token) {
        app.state::<Arc<HostState>>()
            .artwork
            .lock()
            .unwrap()
            .cancel(&token);
    }
}

#[tauri::command]
fn map_artwork_cancel(app: tauri::AppHandle, token: String) {
    if artwork::Scope::Map.accepts(&token) {
        app.state::<Arc<HostState>>()
            .artwork
            .lock()
            .unwrap()
            .cancel(&token);
    }
}

#[tauri::command]
fn cosmetic_artwork_cancel(app: tauri::AppHandle, token: Option<String>) {
    let state = app.state::<Arc<HostState>>();
    let mut registry = state.artwork.lock().unwrap();
    match token {
        Some(token) if artwork::Scope::Cosmetic.accepts(&token) => registry.cancel(&token),
        None => {
            registry.revoke_cosmetics();
        }
        _ => {}
    }
}

#[tauri::command]
async fn cosmetics_get(app: tauri::AppHandle) -> Outcome<cosmetics::Cosmetics> {
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
async fn maps_list(
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
async fn run_get(
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
async fn advanced_get(
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

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_meta_state(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::State {
    synthetic::meta::state(app, request, false).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_meta_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::Result {
    synthetic::meta::write(app, request, false).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_meta_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::Result {
    synthetic::meta::recover(app, request, false).await
}

#[tauri::command]
fn preview_close(app: tauri::AppHandle) -> Result<(), &'static str> {
    app.get_webview_window("main")
        .ok_or("Preview window unavailable")?
        .close()
        .map_err(|_| "Preview could not close")
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_health_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_upgrades_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write_upgrades(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_run_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write_run(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_items_refill(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::write_refills(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_health_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::recover(app, request).await
}

#[cfg(feature = "synthetic-health-recovery")]
#[tauri::command]
async fn test_health_state(app: tauri::AppHandle, save_id: String) -> recovery::HealthState {
    recovery::state(app, save_id).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
async fn production_meta_state(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::State {
    synthetic::meta::state(app, request, true).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
async fn production_meta_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::Result {
    synthetic::meta::write(app, request, true).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
async fn production_meta_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> synthetic::meta::Result {
    synthetic::meta::recover(app, request, true).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
fn production_meta_close(app: tauri::AppHandle) {
    app.state::<std::sync::Arc<backend::HostState>>()
        .meta_session
        .lock()
        .unwrap()
        .close();
}

#[cfg(feature = "production-health")]
#[tauri::command]
async fn production_health_write(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::production_write(app, request).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
async fn production_health_recover(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> recovery::Transaction {
    recovery::production_recover(app, request).await
}

#[cfg(feature = "production-health")]
#[tauri::command]
async fn production_health_state(app: tauri::AppHandle, save_id: String) -> recovery::HealthState {
    recovery::production_state(app, save_id).await
}

fn main() {
    let started = Instant::now();
    let fixture = std::env::var("REPODITOR_E2E").as_deref() == Ok("1");
    let _cache_activity =
        backend::cache_activity::retain(fixture).expect("Unable to coordinate artwork cache use");
    tauri::Builder::default()
        .manage(Arc::new(HostState::default()))
        .manage(InitialDiscovery::default())
        .manage(Mutex::new(EntryCache::default()))
        .invoke_handler(tauri::generate_handler![
            environment_detect,
            legacy_install_registered,
            open_installed_apps,
            saves_open,
            editor_entry,
            game_status,
            players_list,
            players_avatar,
            upgrades_list,
            upgrade_artwork_get,
            upgrade_artwork_cancel,
            item_artwork_get,
            item_artwork_cancel,
            map_artwork_get,
            map_artwork_cancel,
            cosmetic_artwork_get,
            cosmetic_artwork_cancel,
            run_get,
            advanced_get,
            maps_list,
            cosmetics_get,
            preview_close,
            #[cfg(feature = "production-health")]
            production_health_write,
            #[cfg(feature = "production-health")]
            production_health_recover,
            #[cfg(feature = "production-health")]
            production_meta_state,
            #[cfg(feature = "production-health")]
            production_meta_write,
            #[cfg(feature = "production-health")]
            production_meta_recover,
            #[cfg(feature = "production-health")]
            production_meta_close,
            #[cfg(feature = "production-health")]
            production_health_state,
            #[cfg(feature = "synthetic-health-recovery")]
            test_health_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_upgrades_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_run_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_items_refill,
            #[cfg(feature = "synthetic-health-recovery")]
            test_meta_state,
            #[cfg(feature = "synthetic-health-recovery")]
            test_meta_write,
            #[cfg(feature = "synthetic-health-recovery")]
            test_meta_recover,
            #[cfg(feature = "synthetic-health-recovery")]
            test_health_recover,
            #[cfg(feature = "synthetic-health-recovery")]
            test_health_state,
        ])
        .setup(move |app| {
            backend::timing::span("host_setup", started);
            let profile = if fixture {
                std::path::PathBuf::from(
                    std::env::var_os("LOCALAPPDATA").ok_or("Missing isolated test profile")?,
                )
                .join("RepoDitorPreview")
            } else {
                app.path().app_local_data_dir()?
            };
            let url = if cfg!(debug_assertions) {
                tauri::WebviewUrl::External("http://127.0.0.1:1420/tauri.html".parse()?)
            } else {
                tauri::WebviewUrl::App("tauri.html".into())
            };
            let window = tauri::WebviewWindowBuilder::new(app, "main", url);
            #[cfg(all(windows, feature = "native-ui-test"))]
            let window = {
                let template = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "main")
                    .and_then(|window| window.additional_browser_args.as_deref())
                    .ok_or("Missing isolated UI test browser arguments")?;
                window.additional_browser_args(&ui_test_args(
                    template,
                    &std::env::var("REPODITOR_E2E").unwrap_or_default(),
                    &std::env::var("REPODITOR_TEST_CDP_PORT").unwrap_or_default(),
                )?)
            };
            let handle = app.handle().clone();
            *app.state::<InitialDiscovery>().0.lock().unwrap() =
                Some(tauri::async_runtime::spawn(async move {
                    backend::request(handle, Operation::Discovery, discovery::parse).await
                }));
            let webview_started = Instant::now();
            window
                .title("RepoDitor")
                .inner_size(1200.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .data_directory(profile)
                .on_navigation(allowed_navigation)
                .on_new_window(|url, _| {
                    handle_project_window(&url, |target| {
                        open_system_url(target);
                    });
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            backend::timing::span("webview_build", webview_started);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<HostState>>().inner().clone();
                let already_closing = state.closing.swap(true, Ordering::SeqCst);
                state.artwork.lock().unwrap().clear_all();
                if !state.idle() {
                    api.prevent_close();
                    if !already_closing {
                        let window = window.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            // Permit release follows child reaping and pipe-reader joins.
                            while !state.idle() {
                                std::thread::sleep(std::time::Duration::from_millis(5));
                            }
                            let _ = window.close();
                        });
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Unable to start RepoDitor");
}

#[cfg(test)]
#[path = "../tests/unit/entry.rs"]
mod tests;
