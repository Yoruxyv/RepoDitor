# Local R.E.P.O. asset research

Installed R.E.P.O. metadata links game objects to evidence-backed save identities.
Extracted pixels and generated inventories belong under ignored
`local-evidence/game-assets/`; game artwork is not redistributed.

The inventory below describes Steam build `23363152`. Build `26294889` has a
separate [installed artwork analysis](../reverse-engineering/truck_artwork.md).
Save mutation rules are documented in [reverse engineering](reverse-engineering.md);
asset discovery alone grants no write authority.

## Inspected build and tooling

| Detail                  | Observed value                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| Steam app/build         | `3241660` / `23363152`                                               |
| Installed update        | 2026-06-14 UTC                                                       |
| Unity player            | `2022.3.67f2`                                                        |
| Unity metadata reader   | UnityPy `1.25.3`                                                     |
| MonoBehaviour typetrees | TypeTreeGeneratorAPI `0.0.10` using the installed managed assemblies |
| Managed metadata        | dnfile `0.18.0` plus a printable UTF-16 string scan                  |

This inventory used UnityPy and metadata helpers in an isolated environment. The
production Sprite fallback separately packages UnityPy 1.25.4 and its native/data
resources; the inventory's older tool versions are provenance, not current dependencies.

The following installed containers were inspected:

- `globalgamemanagers` and `globalgamemanagers.assets`;
- `resources.assets` with its `.resS` and `.resource` companions;
- `sharedassets0.assets` with its `.resS` and `.resource` companions;
- `sharedassets1.assets`, `sharedassets2.assets`, and `level0` through `level2`;
- the Addressables `catalog.json`, `settings.json`, and all nine local Windows bundles;
- `Managed/Assembly-CSharp.dll` and the managed assembly set used for typetree generation.

No file in the game installation was opened for writing.

## Inventory summary

The main serialized containers contain 2,520 `Texture2D` objects and 146 `Sprite` objects. Most are
world materials, loading art, or unrelated UI; those counts are not an icon catalog.

The useful subset was:

- 67 decoded `Item` definitions: 60 active and seven marked disabled;
- 59 unique item/upgrade identifiers observed across the evidence save's `item`,
  `itemsUpgradesPurchased`, `itemsPurchased`, and `itemsPurchasedTotal` containers;
- 128 named characters in the game's item/UI emoji atlas;
- 35 `emojiIcon` enum values, of which 20 have an exact same-named atlas glyph;
- 13 save-item names with a semantically matching, purpose-built 64×64 glyph;
- 13 upgrade-related 512×512 albedo textures and seven 32×32 drone textures;
- 1,363 Addressables internal IDs, including 130 under `Items`, 553 under `Cosmetics`, 395 under
  `Level`, and 169 under `Valuables`.

The Addressables item total includes aliases and removed entries: 63 direct paths, 59
`Items/Items/...` aliases, and eight `Items/Removed Items/...` paths. The one active decoded item
definition not observed in the save-domain union was `Item Grenade Duct Taped`.

## Item-domain mapping

All 59 identifiers observed across the four item/purchase containers matched a same-named active
Unity `Item` definition with the same `prefabName` and `resourcePath`. That identity relationship is
**CONFIRMED**. It does not prove write behavior for any save container.

The object candidates are MonoBehaviour-backed `Item` definitions decoded from `resources.assets`;
their `resourcePath` values also align with the Addressables item paths. The visual candidates are
64×64 sprite characters cut from the `emojis Extraction Point` atlas in `sharedassets0.assets`.
The high-confidence rows require a purpose-specific glyph whose enum name matches the item concept;
reused or generic enum assignments remain ambiguous even when the underlying Unity object identity
is confirmed.

All game-derived icon candidates below are **LOCAL REFERENCE ONLY**. The shipping status does not
change with mapping confidence.

### High-confidence visual references

| Save/domain name               | Unity object | Atlas glyph                | Identity  | Icon confidence | Shipping             |
| ------------------------------ | ------------ | -------------------------- | --------- | --------------- | -------------------- |
| `Item Drone Battery`           | same name    | `drone_battery`            | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Feather`           | same name    | `drone_feather`            | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Indestructible`    | same name    | `drone_indestructible`     | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Torque`            | same name    | `drone_torque`             | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Zero Gravity`      | same name    | `drone_zero_gravity`       | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Grenade Explosive`       | same name    | `grenade_explosive`        | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Grenade Stun`            | same name    | `grenade_stun`             | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Baseball Bat`      | same name    | `weapon_baseball_bat`      | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Frying Pan`        | same name    | `weapon_frying_pan`        | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Inflatable Hammer` | same name    | `weapon_inflatable_hammer` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Sledge Hammer`     | same name    | `weapon_sledgehammer`      | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Sword`             | same name    | `weapon_sword`             | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Orb Zero Gravity`        | same name    | `orb_zero_gravity`         | CONFIRMED | HIGH CONFIDENCE | Local reference only |

### Assigned but visually ambiguous glyphs

These definitions contain the listed `emojiIcon` value, but the visual is reused or does not
describe the item closely enough for RepoDitor to present it as a reliable item-specific icon.

| Save/domain names                                                 | Assigned glyph        | Identity  | Icon confidence | Shipping             |
| ----------------------------------------------------------------- | --------------------- | --------- | --------------- | -------------------- |
| `Item Cart Medium`, `Item Cart Small`                             | `orb_zero_gravity`    | CONFIRMED | AMBIGUOUS       | Local reference only |
| `Item Melee Stun Baton`                                           | `weapon_baseball_bat` | CONFIRMED | AMBIGUOUS       | Local reference only |
| `Item Power Crystal`                                              | `orb_battery`         | CONFIRMED | AMBIGUOUS       | Local reference only |
| `Item Staff Torque`, `Item Staff Void`, `Item Staff Zero Gravity` | `weapon_sword`        | CONFIRMED | AMBIGUOUS       | Local reference only |
| All 12 purchased upgrade item names                               | `orb_battery`         | CONFIRMED | AMBIGUOUS       | Local reference only |

The 12 purchased upgrade names are Death Head Battery, Map Player Count, Crouch Rest, Energy,
Extra Jump, Grab Range, Grab Strength, Health, Sprint Speed, Tumble Climb, Tumble Launch, and
Tumble Wings, each with the `Item Upgrade ...` prefix used in the save.

### No direct item glyph mapping

The same-named Unity item definitions are confirmed, but no matching item-atlas glyph was found
for:

- Cart Cannon, Cart Laser, Duck Bucket, Extraction Tracker;
- Grenade Human, Grenade Shockwave;
- Gun Handgun, Gun Laser, Gun Shockwave, Gun Shotgun, Gun Stun, and Gun Tranq;
- Health Pack Large, Health Pack Medium, and Health Pack Small;
- Leaf Blower, Mine Explosive, Mine Shockwave, Mine Stun, Phase Bridge, ReviveItem, and Rubber Duck;
- Valuable Tracker, both Semiscooters, WalkieTalkie, and WalkieTalkieBox.

These are **UNMAPPED** for icon presentation, even though their save-to-Unity object identity is
confirmed.

## Player-upgrade references

The discovered upgrade textures are complete 512×512 material albedo sheets. They contain useful
visual reference artwork but are not clean UI icons and are not shippable.

| Save domain                     | Unity object candidate              | Texture candidate                   | Confidence      | Shipping             |
| ------------------------------- | ----------------------------------- | ----------------------------------- | --------------- | -------------------- |
| `playerUpgradeCrouchRest`       | `Item Upgrade Player Crouch Rest`   | `Upgrade_Crouch-Rest_Albedo`        | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeDeathHeadBattery` | `Item Upgrade Death Head Battery`   | `Upgrade_Death-Head-Battery_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeExtraJump`        | `Item Upgrade Player Extra Jump`    | `Upgrade_Extra-Jump_Albedo`         | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeHealth`           | `Item Upgrade Player Health`        | `Upgrade_Health_Albedo`             | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeLaunch`           | `Item Upgrade Player Tumble Launch` | `Upgrade_Tumble-Launch_Albedo`      | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeMapPlayerCount`   | `Item Upgrade Map Player Count`     | `Upgrade_Map-Player-Count_Albedo`   | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeRange`            | `Item Upgrade Player Grab Range`    | `Upgrade_Grab-Range_Albedo`         | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeSpeed`            | `Item Upgrade Player Sprint Speed`  | `Upgrade_Speed_Albedo`              | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeStamina`          | `Item Upgrade Player Energy`        | `Upgrade_Energy_Albedo`             | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeStrength`         | `Item Upgrade Player Grab Strength` | `Upgrade_Grab-Strength_Albedo`      | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeThrow`            | no active decoded `Item` definition | `Upgrade_Grab-Throw_Albedo`         | POSSIBLE        | Local reference only |
| `playerUpgradeTumbleClimb`      | `Item Upgrade Player Tumble Climb`  | `Upgrade_Tumble-Climb_Albedo`       | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeTumbleWings`      | `Item Upgrade Player Tumble Wings`  | `Upgrade_Tumble-Wings_Albedo`       | HIGH CONFIDENCE | Local reference only |

`playerUpgradeThrow` also has an Addressables path and `ItemUpgradePlayerGrabThrow` managed class,
but it lacks the same active decoded `Item` definition observed for the other twelve upgrades, so
it remains a weaker mapping.

## Maps

The existing RepoDitor map service already discovers the Addressables loading-graphics families.
No second map asset mechanism is needed.

| RepoDitor/internal name | Candidate assets                                                    | Confidence      | Shipping             |
| ----------------------- | ------------------------------------------------------------------- | --------------- | -------------------- |
| `Arctic`                | `Level/Arctic/Loading Graphics/...`, `level arctic 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |
| `Manor`                 | `Level/Manor/Loading Graphics/...`, `level manor 01`–`03` sprites   | HIGH CONFIDENCE | Local reference only |
| `Museum`                | `Level/Museum/Loading Graphics/...`, `level museum 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |
| `Wizard`                | `Level/Wizard/Loading Graphics/...`, `level wizard 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |

### Installed roster and previews

The Desktop Maps view lists normal extraction maps and displays their original
loading Sprites from the local installation. It exposes no scene loading, map
selection, save mutation or game-control API. No game images ship with RepoDitor.

#### Asset discovery

For Steam build `26294889`, Unity `6000.3.17f1`, `RunManager.levels` in `level0`
is the normal-map roster. Its `Level` references resolve into `sharedassets0.assets`.
`NarrativeName` supplies the public label; the asset name supplies the family.
`LoadingGraphic01`–`03` supply authored Sprite `PrefabRef.resourcePath` values.
Special levels use separate fields/vectors and do not enter this roster.
The reviewed `Assembly-CSharp.dll` SHA-256 is
`aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888`.

`Level - Desert` is **Sunstone Valley Resort**. It belongs to `RunManager.levels`
even though its status field is zero. The installed JSON catalog omits Desert;
the binary catalog also lacks its loading-image locations. Filtering JSON keys
alone therefore misses a valid normal map. Roster discovery does not filter on
status or append a hardcoded Desert entry.

The narrow reader follows script identities and serialized references rather
than fixed object IDs or byte offsets. It checks build, assembly identity, Unity
version, path ownership, object bounds, vector bounds, duplicate identities and
source stability. Unknown families in the supported layout remain discoverable
with their authored names. Other builds retain the existing JSON
`Level/<family>/Loading Graphics/` discovery, excluding Arena and Shop; its four
known labels are presentation aliases, not membership rules. Unsupported builds
receive no native artwork. A malformed supported roster reports a sanitized error.

| Family | Authored public label  | First loading resource                          |
| ------ | ---------------------- | ----------------------------------------------- |
| Arctic | McJannek Station       | `Level/Arctic/Loading Graphics/level arctic 01` |
| Manor  | Headman Manor          | `Level/Manor/Loading Graphics/level manor 01`   |
| Museum | Museum of Human Art    | `Level/Museum/Loading Graphics/level museum 01` |
| Desert | Sunstone Valley Resort | `Level/Desert/Loading Graphics/level desert 01` |
| Wizard | Swiftbroom Academy     | `Level/Wizard/Loading Graphics/level wizard 01` |

Each Level also references loading images `02` and `03`. The preview uses the first
authored reference. This table records installed evidence; production contains no
map list, Sprite-ID table, texture offsets or PNG filename mapping.

#### Decoding and validation

`services/game/map_artwork.py` resolves the authored resource key through the
class-147 ResourceManager in `globalgamemanagers`. Texture2D and Sprite entries
share the same key: the adapter selects the unique class-213 Sprite, then follows
its local class-28 texture reference. Objects reside in `resources.assets`, with
texture bytes streamed from `resources.assets.resS`. These are serialized assets,
not standalone PNGs. The older four-map JSON locations identify
`LegacyResourcesProvider`; binary cosmetic AssetBundle discovery is a different
source and is not used here.

The five representative mappings remain useful verification evidence:

| Sprite            | Sprite PathID | Texture PathID | Cropped native size |
| ----------------- | ------------: | -------------: | ------------------: |
| `level arctic 01` |         13387 |           3832 |            1169×830 |
| `level manor 01`  |         13368 |           2627 |             972×593 |
| `level museum 01` |         13396 |           4270 |            1613×821 |
| `level desert 01` |         13362 |           2320 |            1847×943 |
| `level wizard 01` |         13390 |           3856 |            1225×946 |

UnityPy `1.25.4`, already included in the packaged backend, decodes the original
Sprite crop, tight mesh mask, alpha and vertical orientation. Pillow downsizes
with Lanczos to at most 1024 pixels per side without changing the aspect ratio.
The inspected source textures are 2252×1128 DXT5, one mip, with 2,540,256-byte
stream ranges. Atlas-backed, split-alpha, external-texture, unsupported-format,
ambiguous and missing sources fail soft. No custom rendering or camera tuning is
involved.

The decoder admits one serialized file of at most 512 MiB, Sprite/Texture records
of at most 64 KiB, texture dimensions up to 4096, and stream ranges up to 16 MiB.
Each PNG is bounded to 2 MiB; the batch is bounded to 8 MiB of PNG data and 128 map
entries. Electron gives the finite subprocess 90 seconds and 16 MiB of stdout.
Files are opened read-only; dependencies are admitted explicitly rather than
letting UnityPy scan the installation directory. Source checks run before and
after decoding, and partial initialization releases file handles and mappings.

The original `resources.assets` contains 2,287,237 object-table entries. The
standard reader validates that table without materializing Python objects for
unrelated assets. `_MapSpriteIndex.native_subset` copies the original format-22
type metadata and admitted Sprite/Texture2D records into bounded, temporary memory
files. It preserves path IDs, types and object bytes. UnityPy first parses the
selected Sprites to identify their local textures, then receives those Sprites
and texture descriptors together: five plus ten object readers for this build.
The original script/external reference tables are omitted because the adapter
admits only native objects with local texture references. Atlas and split-alpha
sources remain unsupported. The subset admits at most 256 records of 64 KiB each
and 64 KiB of type metadata; it is never written to disk. The approved shared
readers and capability fingerprints remain unchanged.

Source texture images are closed and removed from UnityPy's environment cache
after each preview. Batch memory therefore does not retain every decoded source
texture. Sprite cropping, mask generation, resampling, PNG encoding and output
validation use the same implementations as before the optimization.

#### Transport, cache and presentation

`maps-list` returns source revision metadata to Electron. Electron validates it
and registers a map identity in the existing opaque icon registry. React receives
an `iconToken`, never an asset path or executable capability. The existing
GET-only `repoditor-icon://local/<token>` handler serves bounded PNGs with
`no-store` and `nosniff`; unknown, stale, malformed and cross-domain requests fail.

`mapArtwork.cts` is a source adapter, not an artwork manager. Concurrent misses
share one `maps-artwork` batch. It reuses `SpriteArtworkStore`, extracted from the
existing cosmetic cache without changing its format-1 manifest or cosmetic
filename scheme. The separate `presentation/maps` namespace stores family-keyed
PNGs; cosmetics retain their own IDs and source rules. Upgrade and baked caches
remain separate because their formats, source priorities and invalidation differ.

A revision hashes the decoder version and path/size/nanosecond-mtime watches for
the Steam manifest, managed assembly, `level0`, `sharedassets0.assets`,
`globalgamemanagers.assets`, `globalgamemanagers`, `resources.assets` and its
`.resS` stream. Electron revalidates sources on memory and disk hits, rejects
links and redirected paths, checks PNG hashes and contents, and persists PNGs and
manifests atomically. Replaced cache generations are removed after manifest
publication. Cache writes may fail without blocking presentation. A completed
failed batch is not repeated for every image; refreshing the catalog permits a
retry. Source changes produce new registrations and invalidate old URLs. A refresh
generation also rejects obsolete requests waiting on cache I/O or an earlier
batch, preventing those requests from starting overlapping decoders.

Dependency boundaries before and after the feature:

```text
Before
MapsView → typed maps.list → Electron IPC → Python maps-list → JSON catalog
GameIcon → opaque icon protocol → baked / upgrade / cosmetic source selection
                                             cosmetic cache → PNG storage

After
MapsView → typed maps.list → Electron IPC → Python maps-list → normal-level roster
   ↓                              ↓                         ↘ legacy JSON fallback
GameIcon → same icon protocol → map source adapter → finite Python maps-artwork
                                      ↓                      ↓
                               SpriteArtworkStore       bounded Unity readers
                                      ↑                      ↓
                         cosmetic cache adapter       UnityPy Sprite decoding
```

| Boundary                                                                   | Treatment                              |
| -------------------------------------------------------------------------- | -------------------------------------- |
| Typed preload API, IPC validation, opaque icon registry/protocol, GameIcon | EXTEND                                 |
| Shared serialized reader and source-validated Sprite PNG storage           | REUSE                                  |
| Baked selection, cosmetic preparation, upgrade cache and save authority    | KEEP                                   |
| Map membership and Sprite source adapter                                   | EXTEND the existing Maps service       |
| New artwork manager, duplicate protocol/cache framework, permanent worker  | REJECT                                 |
| Missing-item reconstruction renderer                                       | DEFER; the seven item fallbacks remain |

The extracted store removes duplicated manifest, PNG persistence and source-watch
responsibilities. Domain-specific source selection and preparation remain with
their owners. The first batch may finish after navigating away so returning to
Maps can use ready artwork; application disposal kills outstanding Python work.

Cards preserve Sprite aspect ratio, use responsive columns, and keep images
supplementary to visible map headings. Initial metadata loading uses matching
card skeletons. Optional artwork has its own thumbnail skeleton; missing or
rejected artwork immediately uses the Phosphor map fallback. Successful tokens
retain loaded state across navigation without an artificial loading delay.
Refreshing keeps existing cards visible and ignores superseded responses.

#### Reproduction and limitations

Use the locked Python package environment from the repository root:

```powershell
$env:PYTHONPATH = 'desktop/python'
uv run --locked --group package python -m repo_save_editor.desktop_api maps-list
uv run --locked --group package python -c "from repo_save_editor.services.game.map_artwork import decode_map_artwork; print([(k,v['width'],v['height']) for k,v in decode_map_artwork().items()])"
```

For opt-in integration checks, point `REPODITOR_MAPS_GAME_ROOT` at the verified
installation and run `npm run test:e2e` from `desktop`. Test saves, LocalLow and app
profiles remain disposable fixtures. The installed-artwork test can also run
against the unpacked app using `REPODITOR_E2E_EXECUTABLE` and
`playwright test e2e/electron/maps.spec.ts`. Comparison images and screenshots must stay in
ignored local output; they must never enter fixtures, Git or application resources.

Cold measurements mean a new backend process and an empty RepoDitor presentation
cache; the operating-system file cache was not flushed. Profile instrumentation
was excluded from the timings below except for the stated phase counters.

| Measurement, five previews                        | Full UnityPy file indexing | Selected native objects |
| ------------------------------------------------- | -------------------------: | ----------------------: |
| Python batch wall time                            |                    16.42 s |                  3.81 s |
| Python peak RSS / Windows peak working set        |                 894.85 MiB |              296.47 MiB |
| RSS immediately after batch return                |                 728.37 MiB |              109.05 MiB |
| RSS after releasing results and collecting cycles |                 111.40 MiB |              110.43 MiB |
| Adapter cold load, sequential requests            |                    21.72 s |                  5.32 s |
| Adapter cold load, concurrent requests            |                    18.19 s |                  5.29 s |
| Adapter memory-cache load                         |                   22–26 ms |                   26 ms |
| Adapter disk-cache load in a fresh adapter        |                   36–38 ms |                33–38 ms |

The peak is the backend process's total working set, including mapped file pages;
it is not private-heap growth, Electron memory, or memory retained between app
launches. Both sequential and concurrent requests started exactly one finite
batch. Warm and fresh-adapter disk reads started no decoder. The five cached PNGs
total 1,484,167 bytes. Before/after PNG hashes, dimensions and decoded RGBA hashes
were identical for every map, including alpha; the existing cache identity stays
valid.

The dominant original cost was creating 2.29 million UnityPy `ObjectReader`
instances: opening the installed serialized file took 12.62 s. After selection,
the two UnityPy metadata loads took about 2.4 ms combined. Other measured phases
were installed discovery/provenance/roster validation (68–69 ms), source watches
(22–25 ms), UnityPy import (1.8–2.0 s), Sprite decode/crop/mask (90–102 ms), resizing
(119–125 ms), and PNG encoding (205–233 ms). These phases are inclusive where they
call each other and must not be added twice. A Python no-op process took roughly
0.20 s in the same adapter harness. CLI startup, command imports and output framing
are included in the adapter cold times, not in the batch-only row.

Five atomic PNG writes took 18–25 ms and the manifest write about 3 ms. Source
validation, PNG checks, caching and the existing finite preparation scheduling
were retained. No background decoder runs at startup; images are requested when
Maps is displayed. Navigation can continue while a cold batch runs, application
relaunch reuses the disk cache, and closing the app terminates pending Python
work. The opt-in E2E tests exercise these boundaries without changing game files.
Save-entry timing also includes independent item and upgrade preparation; it is
not a measurement of map decoding.

Remaining cost is principally Python/library startup and validation of the large
installed object table. Measurements are machine-specific and source/output
bounds are not an OS-level process-memory cap. There is no permanent worker or
new rendering runtime.

To inspect CPU call costs without emitting artwork, use the existing decoder:

```powershell
uv run --locked --group package python -c "import cProfile; from repo_save_editor.services.game.map_artwork import decode_map_artwork; cProfile.run('decode_map_artwork()', sort='cumtime')"
```

Native membership and artwork are verified only for the pinned installed build.
Future game schemas, shaders and texture formats are not inferred from version
strings. Legacy catalog discovery may omit maps absent from that catalog; native
previews remain unavailable until the new source layout is reviewed. Missing
optional images never suppress the map listing or grant mutation capabilities.

## Static managed-code findings

Static metadata, without executing the game, showed:

- `Item` owns `itemName`, `emojiIcon`, prefab/resource references, pricing/amount fields, and
  physical-item metadata.
- `ItemAttributes` owns `hasIcon`, `icon`, `itemAssetName`, and `GenerateIcon`; `SemiIconMaker`
  owns a camera/render texture and icon-generation methods. Embedded diagnostic text instructs
  developers to add `SemiIconMaker` or assign a custom icon. This explains why many items have no
  standalone purpose-built 2D icon asset.
- `ItemBattery` exposes runtime battery/charging fields and methods, but this does not establish
  `.es3` key semantics or safe mutation rules.
- `CosmeticAsset` contains `assetName`, type, rarity, prefab, `icon`, and `assetId`; its methods
  include `GetIcon` and an icon-path getter. `CosmeticTypeAsset` has `defaultIcon`.
- `MetaManager` contains cosmetic tokens, unlocks, history, equipped cosmetics/colors, presets,
  and save/load/verify methods. Managed strings explicitly reference `MetaSave`.

The cosmetics findings support a future, separate MetaSave evidence study. They do not prove a
serialized schema, normal run-save ownership, or a safe edit operation.

## Redistribution assessment

The installed game contains no license, EULA, notice, or fan-content policy granting permission to
redistribute extracted artwork. The [official Steam listing](https://store.steampowered.com/app/3241660/)
identifies semiwork as developer and publisher but provides no asset redistribution grant.
Attribution or a disclaimer would not create one.

Therefore:

- every extracted texture, sprite, atlas crop, loading image, and cosmetic asset is local reference
  only;
- no extracted game asset may be copied into tracked RepoDitor directories or Electron resources;
- only explicit written permission from the rights holder would change that assessment;
- RepoDitor may ship its existing original artwork, Phosphor icons under their existing license,
  and newly created RepoDitor-original item/upgrade icons.

## Presentation and mutation boundaries

RepoDitor uses Phosphor for semantic fallbacks. Local game artwork can replace
content thumbnails only when independently mapped and validated; missing artwork
must never hide an item or imply that a save mutation is supported. Any shipped
replacement artwork must have its own redistribution rights. The source-priority,
cache and protocol contracts live in the [architecture guide](../architecture/architecture.md#desktop-local-presentation-assets).

## Capability evidence

Asset discovery does not establish save-mutation semantics. Independent installed
metadata provides a read-only item capability source: on the validated Steam
build `23363152` / Unity `2022.3.67f2`, 60 active `Item` definitions mapped to 197 installed
prefab variants and an independent UnityPy oracle and standard-library parser agreed exactly on
the 30 item types containing `ItemBattery`. The production parser ships no extracted metadata or
prefab path IDs and does not depend on UnityPy or TypeTreeGenerator. It dynamically verifies the
installed `Item` identity and same-name prefab variants, and any unsupported/incomplete/conflicting
metadata becomes `unknown`. `Item Drone Battery` remains `unknown` because its exceptional observed
flag semantics are still unproven.

Controlled save evidence supports one narrow item mutation: exact-instance **Refill to Full**
removes an existing `itemStatBattery` leaf through the normal safe-write pipeline, but only after
the installed capability layer confirms that item type as rechargeable. Numeric charge edits,
battery upgrades, purchase mutations, and item add/delete/duplicate remain unsupported.

Controlled MetaSave evidence supports guarded bulk ownership changes and paired
**Clear All Presets**. Arbitrary cosmetic equipment, token, color, and preset creation/editing
remain unsupported. Those capabilities do not change this document's redistribution
finding: locally discovered R.E.P.O. assets are research references and are not bundled.

The upgrade fallback resolves installed upgrade identity through prefab, material
and Texture2D metadata, validates local stream ranges, and decodes supported
DXT1/DXT5 payloads. Historical cache format 2 watched artifact-producing Unity files
without Steam compatibility metadata. Format 3 also watches the assembly and Steam
manifest so source changes force admission validation before pixel reuse. See
[upgrade cache diagnostics](../architecture/architecture.md#upgrade-cache-diagnostics).

The all-black `WalkieTalkieBox` LocalLow output was an unusable research candidate.
Regular-item and cosmetic resolution no longer reads that cache: installed baked
artwork and decoded cosmetic Sprites use independently validated source paths.
