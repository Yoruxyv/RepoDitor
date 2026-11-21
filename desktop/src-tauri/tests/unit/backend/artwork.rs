use super::*;
use crate::projections::upgrades;
use serde_json::json;

fn upgrades(count: usize) -> Vec<Upgrade> {
    let rows: Vec<_> = (0..count).map(|i| json!({"key":format!("playerUpgradeTest{i}"),"label":"Test","presentationSource":"alias","gameplayCap":null,"iconKey":null,"values":[]})).collect();
    upgrades::parse(&serde_json::to_vec(&json!({"ok":true,"upgrades":rows})).unwrap()).unwrap()
}
fn png() -> Vec<u8> {
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[255, 0, 0, 255])
            .unwrap();
    }
    output
}

#[test]
fn cosmetic_png_requires_numeric_id_exact_revision_and_complete_bytes() {
    let token = format!("cosmetic-artwork:{}", "a".repeat(32));
    let revision = "b".repeat(64);
    let good = json!({"ok":true,"artwork":{"cosmeticId":556,"sourceIdentity":revision,
        "width":1,"height":1,"pngBase64":STANDARD.encode(png())}});
    let verify = |value: &serde_json::Value| {
        parse(
            &serde_json::to_vec(value).unwrap(),
            "556",
            &token,
            Some(&revision),
        )
    };
    assert!(verify(&good).unwrap().is_some());
    for (key, value) in [
        ("cosmeticId", json!(557)),
        ("cosmeticId", json!("556")),
        ("sourceIdentity", json!("c".repeat(64))),
        ("pngBase64", json!(STANDARD.encode(&png()[..56]))),
        ("pngBase64", json!(STANDARD.encode(b"malformed"))),
        ("pngBase64", json!("a".repeat(MAX_PNG * 2))),
    ] {
        let mut bad = good.clone();
        bad["artwork"][key] = value;
        assert!(verify(&bad).is_err());
    }
}

#[test]
fn cosmetic_batch_validates_members_and_isolates_failure_and_cancellation() {
    let revision = "b".repeat(64);
    let proof = format!(
        "{revision}:{}:{}:{}",
        "c".repeat(32),
        "d".repeat(64),
        "e".repeat(64)
    );
    let mut registry = Registry {
        meta_fingerprint: "a".repeat(64),
        ..Registry::default()
    };
    let tokens: Vec<_> = (0..4)
        .map(|id| {
            register(
                &mut registry.cosmetics,
                Scope::Cosmetic,
                &id.to_string(),
                Some(&proof),
            )
        })
        .collect();
    for bad in [
        vec![tokens[0].clone(); 2],
        vec![tokens[0].clone(), tokens[1].replace("cosmetic-", "item-")],
        vec![tokens[0].clone(); 5],
    ] {
        assert_eq!(
            registry.begin_artwork_batch(Scope::Cosmetic, bad).err(),
            Some(BackendError::Request)
        );
    }
    let batch = registry
        .begin_artwork_batch(Scope::Cosmetic, tokens.clone())
        .unwrap();
    assert!(registry.begin(&tokens[0]).is_err());
    assert!(registry
        .begin_artwork_batch(Scope::Cosmetic, tokens.clone())
        .is_err());
    assert_eq!(
        batch
            .parse(br#"{"ok":true,"artworks":[null]}"#)
            .unwrap_err(),
        BackendError::Invalid
    );
    let valid = json!({"cosmeticId":0,"sourceIdentity":revision,"width":1,"height":1,"pngBase64":STANDARD.encode(png())});
    let message = json!({"ok":true,"artworks":[valid,valid,false,null]});
    let mut images = batch.parse(&serde_json::to_vec(&message).unwrap()).unwrap();
    assert!(matches!(images[0], BatchImage::Ready(_)));
    assert!(matches!(images[1], BatchImage::Unavailable));
    assert!(matches!(images[2], BatchImage::Deferred(false)));
    registry.cancel(&tokens[2]);
    assert!(!batch.cancelled.load(Ordering::SeqCst));
    registry.finish_artwork_batch(&batch, Some(&mut images));
    assert!(matches!(images[0], BatchImage::Ready(_)));
    assert!(matches!(images[2], BatchImage::Unavailable));

    let batch = registry
        .begin_artwork_batch(Scope::Cosmetic, tokens.clone())
        .unwrap();
    for token in &tokens {
        registry.cancel(token);
    }
    assert!(batch.cancelled.load(Ordering::SeqCst));
    registry.finish_artwork_batch(&batch, None);

    let batch = registry
        .begin_artwork_batch(Scope::Cosmetic, tokens.clone())
        .unwrap();
    registry.revoke_cosmetics();
    assert!(batch.cancelled.load(Ordering::SeqCst));
    assert!(batch
        .parse(&serde_json::to_vec(&message).unwrap())
        .unwrap()
        .iter()
        .all(|image| matches!(image, BatchImage::Unavailable)));
    registry.finish_artwork_batch(&batch, None);
    assert!(registry
        .begin_artwork_batch(Scope::Cosmetic, tokens)
        .is_err());
}

#[test]
fn upgrade_batches_bind_to_the_save_and_drop_images_after_a_session_change() {
    let fp = "a".repeat(64);
    let mut registry = Registry::default();
    let mut values = upgrades(2);
    registry.open("save", &fp);
    registry.register("save", registry.generation("save"), Some(&fp), &mut values);
    let tokens: Vec<_> = values
        .iter()
        .map(|row| row.icon_token.clone().unwrap())
        .collect();
    assert!(registry
        .begin_artwork_batch(Scope::Cosmetic, tokens.clone())
        .is_err());
    let batch = registry
        .begin_artwork_batch(Scope::Upgrade, tokens.clone())
        .unwrap();
    assert_eq!(batch.save.as_deref(), Some("save"));
    assert_eq!(batch.fingerprint, fp);
    let image = json!({"upgradeKey":values[0].key,"sourceIdentity":"d".repeat(64),"width":1,"height":1,"pngBase64":STANDARD.encode(png())});
    let response = serde_json::to_vec(&json!({"ok":true,"artworks":[image,image]})).unwrap();
    let mut images = batch.parse(&response).unwrap();
    assert!(matches!(images[0], BatchImage::Ready(_)));
    assert!(matches!(images[1], BatchImage::Deferred(true)));
    registry.open("other", &fp);
    assert!(batch.cancelled.load(Ordering::SeqCst));
    registry.finish_artwork_batch(&batch, Some(&mut images));
    assert!(images
        .iter()
        .all(|row| matches!(row, BatchImage::Unavailable)));
    assert!(registry
        .begin_artwork_batch(Scope::Upgrade, tokens)
        .is_err());
}

#[test]
fn scopes_tokens_to_current_save_and_revokes_inflight_work() {
    let mut registry = Registry::default();
    let mut rows = upgrades(20);
    registry.register("save", None, Some(&"a".repeat(64)), &mut rows);
    assert!(rows.iter().all(|row| row.icon_token.is_none()));
    registry.open("save", &"a".repeat(64));
    registry.register(
        "save",
        registry.generation("save"),
        Some(&"a".repeat(64)),
        &mut rows,
    );
    assert_eq!(registry.entries.len(), MAX_IMAGES);
    assert!(rows[MAX_IMAGES].icon_token.is_none());
    let token = rows[0].icon_token.as_ref().unwrap().clone();
    assert!(Scope::Upgrade.accepts(&token));
    for bad in [
        "../file",
        "map:token",
        "https://example.test",
        "upgrade-artwork:forged",
    ] {
        assert!(!Scope::Upgrade.accepts(bad));
        assert!(registry.begin(bad).is_err());
    }
    assert!(registry
        .begin(&format!("upgrade-artwork:{}", "0".repeat(32)))
        .is_err());
    let (_, fingerprint, key, cancelled) = registry.begin(&token).unwrap();
    assert_eq!(fingerprint, "a".repeat(64));
    assert_eq!(key, rows[0].key);
    assert!(registry.begin(&token).is_err());
    registry.cancel(&token);
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(!registry.finish(&token, &cancelled));
    let (_, _, _, current) = registry.begin(&token).unwrap();
    registry.open("other", &"a".repeat(64));
    assert!(current.load(Ordering::SeqCst));
    assert!(!registry.finish(&token, &current));
    assert!(registry.begin(&token).is_err());
}

#[test]
fn rereading_unchanged_upgrades_keeps_artwork_active_until_the_save_changes() {
    let mut registry = Registry::default();
    let fingerprint = "a".repeat(64);
    registry.open("save", &fingerprint);
    let generation = registry.generation("save");
    let mut rows = upgrades(1);
    registry.register("save", generation, Some(&fingerprint), &mut rows);
    let token = rows[0].icon_token.take().unwrap();
    let (_, _, _, decoding) = registry.begin(&token).unwrap();

    registry.register("save", generation, Some(&fingerprint), &mut rows);
    assert_eq!(rows[0].icon_token.as_ref(), Some(&token));
    assert!(!decoding.load(Ordering::SeqCst));
    assert!(registry.finish(&token, &decoding));

    registry.register("save", generation, Some(&fingerprint), &mut rows);
    let refreshed = rows[0].icon_token.take().unwrap();
    assert_ne!(refreshed, token);
    assert!(registry.begin(&token).is_err());
    let (_, _, _, old) = registry.begin(&refreshed).unwrap();
    registry.open("other", &fingerprint);
    assert!(old.load(Ordering::SeqCst));
    assert!(!registry.finish(&refreshed, &old));
    assert!(registry.begin(&refreshed).is_err());
}
#[test]
fn stale_lists_cannot_register_and_refresh_revokes_old_tokens() {
    let mut registry = Registry::default();
    registry.open("save", &"a".repeat(64));
    let generation = registry.generation("save");
    registry.open("other", &"a".repeat(64));
    let mut rows = upgrades(1);
    registry.register("save", generation, Some(&"a".repeat(64)), &mut rows);
    assert!(rows[0].icon_token.is_none());
    registry.open("save", &"a".repeat(64));
    let generation = registry.generation("save");
    registry.register("save", generation, Some(&"a".repeat(64)), &mut rows);
    let old = rows[0].icon_token.clone().unwrap();
    registry.register("save", generation, Some(&"b".repeat(64)), &mut rows);
    assert_ne!(rows[0].icon_token.as_deref(), Some(old.as_str()));
    assert!(registry.begin(&old).is_err());
}

#[test]
fn item_tokens_cover_the_bounded_projection_and_reuse_one_entry_per_type() {
    let domains: Vec<_> = [
        "items",
        "currentCharge",
        "batteryUpgrades",
        "purchasedUpgrades",
        "purchasedItems",
        "purchasedItemsTotal",
    ]
    .iter()
    .map(|key| {
        json!({"key":key,"label":key,"status":"confirmed","entryCount":null,
            "capabilities":{"canRead":true,"canEdit":false,"canAdd":false,"canDelete":false,
                "canDuplicate":false,"canRefillToFull":false}})
    })
    .collect();
    let mut rows: Vec<_> = (0..71)
        .map(|i| {
            let name = format!("Tool {}", i % 70);
            json!({"name":name,"saveKey":format!("Item {name}/{i}"),"instanceId":i.to_string(),
            "isUpgrade":false,"storedCharge":null,"chargeState":"unknown",
            "rechargeCapability":"unknown","canRefillToFull":false,"iconKey":null})
        })
        .collect();
    rows.push(
        json!({"name":"Upgrade Test0","saveKey":"Item Upgrade Test0/71","instanceId":"71",
        "isUpgrade":true,"storedCharge":null,"chargeState":"unknown","rechargeCapability":"unknown",
        "canRefillToFull":false,"iconKey":null,"upgradeVisualKey":"playerUpgradeTest0"}),
    );
    let mut raw = serde_json::to_vec(&json!({"ok":true,"advanced":{"domains":domains,
        "items":rows,"unlinkedChargeEntryCount":0}}))
    .unwrap();
    let mut items = crate::projections::items::parse(&raw).unwrap();
    raw.resize(crate::backend::process::STDOUT_LIMIT + 1, b' ');
    assert!(crate::projections::items::parse(&raw).is_err());
    let mut registry = Registry::default();
    registry.open("save", &"a".repeat(64));
    let generation = registry.generation("save");
    let mut upgraded = upgrades(1);
    registry.register("save", generation, Some(&"a".repeat(64)), &mut upgraded);
    registry.register_items("save", generation, Some(&"b".repeat(64)), None, &mut items);
    assert_eq!(*items.upgrade_icons().next().unwrap().1, None);
    registry.register_items("save", generation, Some(&"a".repeat(64)), None, &mut items);
    assert_eq!(
        *items.upgrade_icons().next().unwrap().1,
        upgraded[0].icon_token
    );
    registry.register_items("save", generation, Some(&"b".repeat(64)), None, &mut items);
    let tokens: Vec<_> = items
        .item_icons()
        .map(|(_, token)| token.clone().unwrap())
        .collect();
    assert_eq!(registry.items.len(), 70);
    assert_eq!(tokens[0], tokens[70]);
    let token = &tokens[69];
    assert!(Scope::Item.accepts(token));
    assert!(!Scope::Upgrade.accepts(token));
    assert!(registry.begin(&token.replace("item-", "upgrade-")).is_err());
    let (_, fingerprint, key, cancelled) = registry.begin(token).unwrap();
    assert_eq!(key, "Item Tool 69");
    assert_eq!(fingerprint, "b".repeat(64));
    let pair = vec![tokens[0].clone(), tokens[1].clone()];
    assert!(registry
        .begin_artwork_batch(Scope::Upgrade, pair.clone())
        .is_err());
    let batch = registry.begin_artwork_batch(Scope::Item, pair).unwrap();
    assert_eq!(batch.fingerprint, fingerprint);
    assert_eq!(batch.members[0].key, "Item Tool 0");
    registry.register_items("save", generation, Some(&"c".repeat(64)), None, &mut items);
    assert!(batch.cancelled.load(Ordering::SeqCst));
    registry.finish_artwork_batch(&batch, None);
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(registry.begin(token).is_err());
    assert_eq!(registry.items.len(), 70);
    #[cfg(feature = "production-health")]
    {
        let before = "a".repeat(64);
        let after = "b".repeat(64);
        let revision = "c".repeat(64);
        registry.register_items(
            "save",
            generation,
            Some(&before),
            Some(&revision),
            &mut items,
        );
        let token = items.item_icons().next().unwrap().1.clone().unwrap();
        assert!(!registry.retain_item_artwork(
            "save",
            generation,
            &after,
            Some(&before),
            &mut items
        ));
        assert!(!registry.retain_item_artwork(
            "other",
            generation,
            &after,
            Some(&revision),
            &mut items
        ));
        assert!(registry.retain_item_artwork(
            "save",
            generation,
            &after,
            Some(&revision),
            &mut items
        ));
        assert_eq!(
            items.item_icons().next().unwrap().1.as_deref(),
            Some(token.as_str())
        );
        assert_eq!(registry.begin(&token).unwrap().1, after);
    }
    registry.open("save", &"a".repeat(64));
    assert!(registry.items.is_empty());
}

#[test]
fn item_png_validates_scope_and_reencodes_without_ancillary_text() {
    let mut original = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut original, 1, 1);
        encoder.set_color(png::ColorType::Rgb);
        encoder
            .add_text_chunk("note".into(), "private metadata".into())
            .unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[7, 8, 9]).unwrap();
        writer.finish().unwrap();
    }
    let token = format!("item-artwork:{}", "c".repeat(32));
    let raw = json!({"ok":true,"artwork":{"itemName":"Item Tool","sourceIdentity":"b".repeat(64),
        "width":1,"height":1,"pngBase64": STANDARD.encode(&original)}});
    let bytes = serde_json::to_vec(&raw).unwrap();
    let image = parse(&bytes, "Item Tool", &token, None).unwrap().unwrap();
    let decoded = STANDARD
        .decode(image.data_url.split_once(',').unwrap().1)
        .unwrap();
    assert!(!decoded.windows(4).any(|bytes| bytes == b"tEXt"));
    assert!(parse(&bytes, "Item Other", &token, None).is_err());
    assert!(parse(
        &bytes,
        "Item Tool",
        &token.replace("item-", "upgrade-"),
        None
    )
    .is_err());
    original.extend_from_slice(&original[original.len() - 12..].to_vec());
    let mut trailing = raw;
    trailing["artwork"]["pngBase64"] = json!(STANDARD.encode(original));
    assert!(parse(
        &serde_json::to_vec(&trailing).unwrap(),
        "Item Tool",
        &token,
        None
    )
    .is_err());
}
#[test]
fn validates_png_pixels_dimensions_revision_and_drops_untrusted_paths() {
    let token = format!("upgrade-artwork:{}", "a".repeat(32));
    let raw = json!({"ok":true,"artwork":{"upgradeKey":"playerUpgradeHealth","sourceIdentity":"a".repeat(64),"width":1,"height":1,"pngBase64": STANDARD.encode(png())}});
    let bytes = serde_json::to_vec(&raw).unwrap();
    let result =
        serde_json::to_value(parse(&bytes, "playerUpgradeHealth", &token, None).unwrap()).unwrap();
    assert!(result["dataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(result["token"], token);
    for (field, value) in [
        ("width", json!(2049)),
        ("width", json!(2)),
        ("sourceIdentity", json!("../path")),
        ("upgradeKey", json!("other")),
        ("path", json!("C:/private/game/file")),
        ("pngBase64", json!("A".repeat(MAX_PNG * 2))),
        ("pngBase64", json!(STANDARD.encode(b"not PNG"))),
    ] {
        let mut changed = raw.clone();
        changed["artwork"][field] = value;
        assert!(
            parse(
                &serde_json::to_vec(&changed).unwrap(),
                "playerUpgradeHealth",
                &token,
                None
            )
            .is_err(),
            "{field}"
        );
    }
    let mut trailing = png();
    trailing.extend_from_slice(b"unexpected payload");
    let mut with_trailer = raw.clone();
    with_trailer["artwork"]["pngBase64"] = json!(STANDARD.encode(trailing));
    assert!(parse(
        &serde_json::to_vec(&with_trailer).unwrap(),
        "playerUpgradeHealth",
        &token,
        None
    )
    .is_err());
    let mut corrupt = png();
    corrupt[45] ^= 255;
    let mut changed = raw;
    changed["artwork"]["pngBase64"] = json!(STANDARD.encode(corrupt));
    assert!(parse(
        &serde_json::to_vec(&changed).unwrap(),
        "playerUpgradeHealth",
        &token,
        None
    )
    .is_err());
    assert!(parse(
        br#"{"ok":true,"artwork":null}"#,
        "playerUpgradeHealth",
        &token,
        None
    )
    .unwrap()
    .is_none());
}

#[test]
fn map_tokens_bind_to_catalog_revision_and_ignore_save_lifecycle() {
    let revision = "a".repeat(64);
    let raw = json!({"ok":true,"available":true,"catalogPath":"E:/private/level0","maps":[
        {"internalName":"Arctic","displayName":"Preview","knownLabel":true,"artworkRevision":revision},
        {"internalName":"Other","displayName":"Preview","knownLabel":false,"iconToken":"forged"}
    ]});
    let mut projection =
        crate::projections::maps::parse(&serde_json::to_vec(&raw).unwrap()).unwrap();
    let mut registry = Registry::default();
    registry.register_maps(&mut projection);
    let serialized = serde_json::to_value(projection).unwrap();
    let token = serialized["maps"][0]["iconToken"].as_str().unwrap();
    assert!(serialized["maps"][1]["iconToken"].is_null());
    assert!(serialized["catalogPath"].is_null());
    assert!(Scope::Map.accepts(token));
    assert!(!Scope::Item.accepts(token));
    assert!(registry.begin(&token.replace("map-", "item-")).is_err());
    let (save, identity, family, work) = registry.begin(token).unwrap();
    assert!(save.is_none());
    assert_eq!(identity, revision);
    assert_eq!(family, "Arctic");
    registry.open("save", &"a".repeat(64));
    registry.clear();
    assert!(!work.load(Ordering::SeqCst));
    let image = json!({"ok":true,"artwork":{"mapFamily":family,"sourceIdentity":identity,
        "width":1,"height":1,"pngBase64":STANDARD.encode(png())}});
    let bytes = serde_json::to_vec(&image).unwrap();
    assert!(parse(&bytes, &family, token, Some(&revision))
        .unwrap()
        .is_some());
    assert!(parse(&bytes, "Other", token, Some(&revision)).is_err());
    assert!(parse(&bytes, &family, token, Some(&"b".repeat(64))).is_err());
    let mut corrupt = image;
    corrupt["artwork"]["pngBase64"] = json!(STANDARD.encode(b"not PNG"));
    assert!(parse(
        &serde_json::to_vec(&corrupt).unwrap(),
        &family,
        token,
        Some(&revision)
    )
    .is_err());
    let mut missing = crate::projections::maps::parse(
        br#"{"ok":true,"available":false,"catalogPath":null,"maps":[]}"#,
    )
    .unwrap();
    registry.register_maps(&mut missing);
    assert!(work.load(Ordering::SeqCst));
    assert!(!registry.finish(token, &work));
    assert!(registry.begin(token).is_err());
    let mut reopened = crate::projections::maps::parse(&serde_json::to_vec(&raw).unwrap()).unwrap();
    registry.register_maps(&mut reopened);
    let projection = serde_json::to_value(reopened).unwrap();
    let token = projection["maps"][0]["iconToken"].as_str().unwrap();
    let (_, _, _, closing) = registry.begin(token).unwrap();
    registry.clear_all();
    assert!(closing.load(Ordering::SeqCst));
    assert!(registry.begin(token).is_err());
}

#[test]
fn map_batch_checks_every_revision_and_drops_results_after_catalog_refresh() {
    let revision = "a".repeat(64);
    let raw = json!({"ok":true,"available":true,"catalogPath":"E:/fixture/level0","maps":[
        {"internalName":"Arctic","displayName":"Station","knownLabel":true,"artworkRevision":revision},
        {"internalName":"Manor","displayName":"Manor","knownLabel":true,"artworkRevision":revision},
        {"internalName":"Other","displayName":"Other","knownLabel":false,"artworkRevision":"b".repeat(64)}
    ]});
    let bytes = serde_json::to_vec(&raw).unwrap();
    let mut projection = crate::projections::maps::parse(&bytes).unwrap();
    let mut registry = Registry::default();
    registry.register_maps(&mut projection);
    let data = serde_json::to_value(projection).unwrap();
    let token = |i: usize| data["maps"][i]["iconToken"].as_str().unwrap().to_owned();
    assert!(registry
        .begin_artwork_batch(Scope::Map, vec![token(0), token(2)])
        .is_err());
    let batch = registry
        .begin_artwork_batch(Scope::Map, vec![token(0), token(1)])
        .unwrap();
    let image = |family, digest| json!({"mapFamily":family,"sourceIdentity":digest,"width":1,"height":1,"pngBase64":STANDARD.encode(png())});
    let reply =
        json!({"ok":true,"artworks":[image("Arctic", revision), image("Manor", "b".repeat(64))]});
    let mut images = batch.parse(&serde_json::to_vec(&reply).unwrap()).unwrap();
    assert!(matches!(images[0], BatchImage::Ready(_)));
    assert!(matches!(images[1], BatchImage::Deferred(true)));
    registry.register_maps(&mut crate::projections::maps::parse(&bytes).unwrap());
    assert!(batch.cancelled.load(Ordering::SeqCst));
    registry.finish_artwork_batch(&batch, Some(&mut images));
    assert!(matches!(images[0], BatchImage::Unavailable));
}
