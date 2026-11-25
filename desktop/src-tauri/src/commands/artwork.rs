//! Typed artwork requests, cancellation, and response delivery.
use crate::{
    backend::{self, artwork, HostState, Operation},
    error::{BackendError, Outcome, Service},
    projections::saves,
};
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
pub(crate) async fn upgrade_artwork_get(
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
pub(crate) async fn item_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
) -> ArtworkOutcome {
    get_artwork_response(app, token, tokens, artwork::Scope::Item, Service::Items).await
}

#[tauri::command]
pub(crate) async fn map_artwork_get(
    app: tauri::AppHandle,
    token: Option<serde_json::Value>,
    tokens: Option<Vec<String>>,
) -> ArtworkOutcome {
    get_artwork_response(app, token, tokens, artwork::Scope::Map, Service::Maps).await
}

#[tauri::command]
pub(crate) async fn cosmetic_artwork_get(
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
pub(crate) enum ArtworkOutcome {
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
pub(crate) fn upgrade_artwork_cancel(
    app: tauri::AppHandle,
    token: Option<String>,
    save_id: Option<String>,
) {
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
pub(crate) fn item_artwork_cancel(app: tauri::AppHandle, token: String) {
    if artwork::Scope::Item.accepts(&token) {
        app.state::<Arc<HostState>>()
            .artwork
            .lock()
            .unwrap()
            .cancel(&token);
    }
}

#[tauri::command]
pub(crate) fn map_artwork_cancel(app: tauri::AppHandle, token: String) {
    if artwork::Scope::Map.accepts(&token) {
        app.state::<Arc<HostState>>()
            .artwork
            .lock()
            .unwrap()
            .cancel(&token);
    }
}

#[tauri::command]
pub(crate) fn cosmetic_artwork_cancel(app: tauri::AppHandle, token: Option<String>) {
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
