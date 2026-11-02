# Installed item and cosmetic artwork

RepoDitor resolves local artwork from installed canonical identities and serves
validated images through opaque Electron tokens. It does not bundle game artwork.
This analysis covers Steam build `26294889` / Unity `6000.3.17f1`; the
[RectTransform analysis](sunstone-truck-artwork.md) explains hierarchy parsing.

Artwork identity and save-mutation permission are independent. The artwork-only
validation used the historical 547-ID policy. Current 557-ID cosmetic approval and
its in-game coverage are documented in [cosmetic compatibility](../research/current-game-compatibility.md).

## Provenance and identity proof

The inspected Steam build is 26294889, Unity 6000.3.17f1. The reviewed
`REPO_Data/Managed/Assembly-CSharp.dll` SHA-256 is:

```text
aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888
```

That assembly identity is shared by the existing upgrade reader and the baked
reader. Supporting this assembly for artwork does not broaden Recharge support.

Read-only managed IL inspection established these relationships:

1. `SemiIconMaker.BakedIconPath(category, key)` calls `Hash128.Compute(key)` and
   produces `BakedIcons/<category>/<hash>.png`.
2. `ItemAttributes.GenerateIconNow` passes category `Items` and the concatenation
   `Item.name + "|" + GameObject.name.Replace("(Clone)", "")`. The relevant
   state-machine call is at IL offsets `0x017c` to `0x01a9`.
3. `MenuElementCosmeticButton.LoadIconAsync` passes category `Cosmetics` and
   `cosmeticAsset.name`, with no lowercase transformation. Its relevant call is at
   offsets `0x006b` to `0x0088`.
4. `PrefabRef<T>.SetPrefab(T, string)` records `Object.name` in `prefabName`.
   Installed `Item.prefab.prefabName` therefore supplies the authored name needed
   by the item key, without requiring renderer traversal. Item definitions and
   their `PrefabRef` fields are selected through their verified MonoScript class.
   All 57 inspected regular Item references have null bundle pointers. The reader
   rejects non-null bundle references because their separate naming contract has
   not been approved.
5. Cosmetic IDs come exclusively from the existing ordered `MetaManager`
   `CosmeticAsset` vector. The key uses each referenced object's `m_Name`, not its
   display `assetName`, a translated label, or its numeric ID.

Unity documents Hash128 as SpookyHash V2. Exact filename comparisons established
UTF-8 input, zero seeds, and little-endian output bytes for every matched installed
identity, including `Cosmetic - Hat - Bølle`.

References: [Unity Hash128](https://docs.unity.com/en-us/engine/6000.0/script-reference/unityengine/hash128),
[Bob Jenkins' public-domain SpookyV2 implementation](https://burtleburtle.net/bob/c/SpookyV2.cpp).
The dependency-free implementation deliberately supports only inputs below
192 UTF-8 bytes; longer or malformed inputs fail to the existing fallback. Tests
include independent boundary vectors and installed filename vectors. No production
mapping consists of hardcoded PNG names.

The metadata sources are `REPO_Data/level0`, `resources.assets`,
`globalgamemanagers.assets`, `sharedassets0.assets`, the managed assembly, and the
authoritative Steam app manifest. `globalgamemanagers.assets` is distinct from the
extensionless ResourceManager file used by the upgrade visual pipeline.

## Reconciliation

| Domain        | Canonical identities | Installed baked PNGs | Matched identities / files | Missing | Extra files | Shared/ambiguous matches |
| ------------- | -------------------: | -------------------: | -------------------------: | ------: | ----------: | -----------------------: |
| Regular items |                   57 |                   50 |                         50 |       7 |           0 |                        0 |
| Cosmetics     |                  557 |                  559 |                        557 |       0 |           2 |                        0 |

All 607 matched PNGs also passed the Electron reader's full structural, checksum,
decompression, size, and source-identity validation. The 12 player-upgrade Item
definitions continue to use the existing upgrade pipeline and are not counted as
missing regular-item baked artwork.

The seven regular items without installed baked files are:

- `Item Cart Cannon`
- `Item Cart Laser`
- `Item Cart Medium`
- `Item Leaf Blower`
- `Item Power Crystal`
- `Item Vehicle Semiscooter`
- `Item Vehicle Semiscooter Small`

The eight previously unresolved ResourceManager lookups correspond to authored
paths under `Items/Removed Items/`, rather than `Items/<name>`:

- `Item Drone Heal`
- `Item Orb Battery`
- `Item Orb Feather`
- `Item Orb Heal`
- `Item Orb Indestructible`
- `Item Orb Magnet`
- `Item Orb Torque`
- `Item WalkieTalkie`

Their exact stored prefab names produce matching baked filenames. This establishes
artwork identity independently of the earlier renderer traversal limitation. The
folder name is an observation; it does not independently establish current shop,
save, or mutation availability.

The two extra cosmetic files have exact hash matches to installed GameObjects in
`resources.assets`:

| PNG                                    | GameObject name                        | PathID |
| -------------------------------------- | -------------------------------------- | -----: |
| `f9280367fb16f28d151b7b69e787a636.png` | `Cosmetic - Head Bottom - Constructor` | 178041 |
| `1ecf315f940994aa8f95c5a0c6e3f298.png` | `Cosmetic - Grabber Mesh - Petals 2`   | 178093 |

A read-only search of GameObject/MonoBehaviour names in the installed root
serialized files found these exact matches. Neither extra name is in the
authoritative 557-entry CosmeticAsset vector. Their keys match these installed
GameObject names and remain outside the supported catalog, not evidence for IDs
557 and 558. Whether they are unused, reserved, or otherwise intended for future
use remains unproven.

Confidence is high for the mapping algorithm and the complete 557/50 matched
coverage in this exact build. The extra prefab names are proven; their gameplay
status is not.

## Source resolution and readiness

Python validates Steam provenance and the reviewed managed assembly, then derives
canonical hash inputs. Schema-8 `baked-artwork.json` stores identities and cosmetic
display metadata without PNG pixels. Electron serves installed PNGs in place and
keeps source-bound validation stamps in `presentation/baked/manifest.json`.

Cosmetics prefer baked PNGs, then their validated decoded Sprite cache and bounded
installed Sprite extraction. Regular items use baked PNGs or Phosphor. Neither
reads LocalLow artwork; player upgrades retain their separate source order.
The [architecture guide](../architecture/architecture.md#desktop-local-presentation-assets)
owns cache locations, source invalidation, transport and preparation contracts.

Readiness checks verify output existence and validity before publishing progress.
Publishing `checking` before that work, or treating it as a blocking state, caused
unnecessary preparation screens. Fully validated sessions enter the catalog
directly. Partial catalogs stay usable while a finite missing-Sprite batch runs;
navigation shares that batch and failed optional requests do not repeatedly scan
the game. A genuinely cold missing batch can use the preparation panel and
continue in the background.

Persisted baked validation is loaded before image serving to avoid rewriting the
manifest on every relaunch. The upgrade LocalLow reader accepts native Windows
filename case differences while still rejecting redirected paths.

## Validation boundaries

Python rejects unsafe paths and reparse points and rechecks source snapshots.
Electron requires canonical filenames, validates regular files and compares file
identities around descriptor reads. Size changes during a race remain bounded.
Baked PNG validation checks structure, CRCs, decompressed scanlines, dimensions,
row filters and the reviewed 8-bit RGB/RGBA non-interlaced layout.

Python/Node file identity uses libuv's low 32-bit Windows volume serial. Python
3.14.6 and Node 24.18.0 otherwise reported different device IDs for the same file.
A real cross-runtime regression protects this normalization. See
[libuv's assignment](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/fs.c)
and [CPython's assignment](https://raw.githubusercontent.com/python/cpython/3.14/Python/fileutils.c).

Unknown builds or changed managed assemblies fall back. Supporting another
build requires renewed assembly/layout evidence; schema changes invalidate old
metadata or validation caches. Synthetic PNGs cover error paths without corrupting
installed files. No extracted PNG enters fixtures, packages or Web assets.

## Geometry probe limitations

The read-only geometry probe opens `resources.assets` and the ResourceManager once for all
seven items, reused `find_prefab_renderers`, mesh readers, material/texture
resolution and the existing BC1/BC3 decoder. Its measured run took 12.55 seconds and emitted JSON metadata only. It is not a
startup task or production thumbnail provider.

| Item                      | MeshRenderers found | Local materials resolved | Mesh vertex sets resolved | Textures decoded |
| ------------------------- | ------------------: | -----------------------: | ------------------------: | ---------------: |
| Cart Cannon               |                  36 |                        6 |                         3 |                4 |
| Cart Laser                |                  42 |                       10 |                         4 |                4 |
| Cart Medium               |                  30 |                        9 |                         4 |                7 |
| Leaf Blower               |                  14 |                        2 |                         1 |                0 |
| Power Crystal             |                  11 |                        1 |                         0 |                1 |
| Vehicle Semiscooter       |                  77 |                       15 |                        19 |               10 |
| Vehicle Semiscooter Small |                  68 |                       10 |                        14 |                8 |

These are partial relationships, not complete rendered parts or recovered icons.
The current narrow helpers reject external/unsupported mesh references and
ambiguous materials/vertex layouts; The probe's `_MainTex`-only material selection misses Leaf Blower's shader-specific
texture properties; it does not establish absent source artwork. The managed `SemiIconMaker` calls
`Camera.Render` with a target RenderTexture and controlled ambient/fog settings.
The shared Transform reader exposes ownership/children, not composed
world transforms; the mesh framing helper exposes vertex channels, not a full
triangle/submesh renderer. Shader semantics, visible/disabled parts, camera
framing, lighting, depth and transparency remain unproven for these prefabs.

Accurate reconstruction is not established with the current helpers. All seven
retain Phosphor placeholders, including Leaf Blower. No texture atlas is presented
as a thumbnail. Production reconstruction requires a full-color comparison against genuine baked
controls, including alpha and composition, before cache/job integration.

## Sprite decoder packaging

The package group locks `UnityPy[ttgen]==1.25.4` and
`addressablestools==1.1.1` (Python 3.12+); the sidecar builds with Python 3.13.
These dependencies load lazily when baked artwork is unavailable.

PyInstaller collects UnityPy and its type database, TypeTreeGeneratorAPI's native
library, and Addressables' dynamic import. UnityPy's eager exporter import also
loads fmod_toolkit's FMOD DLL for Sprite extraction, and its texture decoder needs
archspec's CPU JSON. Package verification requires all four native/data resource
groups, with package metadata and licenses. Standard
[PyInstaller collection options](https://pyinstaller.org/en/stable/usage.html#what-to-bundle-where-to-search)
provide these resources; no private loader patch is required.

A frozen sidecar extracted cosmetic ID 0 as a 512×502 PNG of 101112 bytes, with six
source watches, in 5.77 seconds. Source Python 3.14 and packaged Python 3.13 produced
the same dimensions and byte count. A reader-isolation build reproduced it in
5.841 seconds with SHA-256
`2c47f697b82e972704162ea47af0d977c8fe832c700bbed55119b848d464a365`.
Those tests invoked direct Sprite extraction, bypassed baked resolution, retained
metadata/hashes only and did not save a game PNG.

## Capability-reader isolation

Both historical Recharge and cosmetic evidence bind `services/unity_serialized.py`
to normalized SHA-256
`028a0f1b59d289a0436684f5f59c3b51a0ebbf77e52c656ba766df7cb07556cf`.
An attempted shared-reader Unity 6 expansion produced
`8f95b880e46e0156682e67690c4d9dce88a884de465e300bfd228dcac3077b95`
and failed the capability fingerprint check. Readability of the newer 557-entry
catalog cannot revalidate the older 547-ID ownership evidence or Recharge proof.

`ArtworkFileIndex` specializes the small type-header hook while inheriting object
tables, pointer parsing, bounds, mappings and cleanup. The explicit header and
cosmetic file-opener overrides preserve the evidence-pinned parser boundary;
they do not relabel headers, patch module globals or fork the full parser.
Reapproving an expanded shared parser instead would require independent oracle
evidence for the historical build `23363152` / Unity `2022.3.67f2`; the available
Sunstone installation and synthetic tests cannot substitute for it.

Paths in this table are relative to `desktop/python/repo_save_editor/`:

| File                                         | Responsibility                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/unity_serialized.py`               | Evidence-pinned historical reader; its normalized SHA-256 must match the approved source.                                                                                            |
| `services/unity_artwork.py`                  | `ArtworkFileIndex` accepts the two explicitly reviewed artwork versions; own artwork version/RectTransform constants.                                                                |
| `services/cosmetics/installed_artwork.py`    | Artwork file opener while inheriting existing pointer resolution and file-count/cleanup checks.                                                                                      |
| `services/baked_artwork.py`                  | Artwork readers retain cosmetic display metadata already encountered during identity discovery. Metadata schema 8 rebuilds older caches once and validates the catalog before reuse. |
| `services/cosmetics/presentation_catalog.py` | Reuses the verified baked metadata index for modern display metadata; retain historical catalog discovery for historical builds. No second modern scanner or cache.                  |
| `desktop_api/cosmetics.py`                   | Selects the presentation catalog for the existing typed runtime projection and write validation; generated mutation policy remains authoritative.                                    |
| `services/unity_textures.py`                 | Selects texture layout from the explicit artwork reader version; a historical reader implies its approved 2022 layout.                                                               |
| `services/player/upgrade_textures.py`        | Opens read-only artwork through `ArtworkFileIndex`; existing decode, framing and write gates are preserved.                                                                          |

`test_unity_artwork.py` and `test_cosmetic_presentation_catalog.py` cover this
boundary alongside baked, RectTransform, Texture2D and upgrade tests. Cases include
legacy Unity 6 rejection even after an artwork read, historical parsing parity,
malformed/unknown headers, failure cleanup and metadata cache migration/corruption.

## Recorded measurements

These are measurements of specific validation configurations, not current startup
budgets or fresh suite results. OS cache state was uncontrolled.

### Metadata and PNG validation

| Check                                        | Observed time | PNG files opened |
| -------------------------------------------- | ------------: | ---------------: |
| Cold canonical metadata discovery            |        5.75 s |                0 |
| Warm canonical metadata lookup               |       55.2 ms |                0 |
| First validation of 557 cosmetics + 50 items |        1.68 s |              607 |
| Fresh reader reusing persisted validation    |        175 ms |                0 |

The validation cache contained only `manifest.json`. In the reader-isolation
configuration, cold metadata discovery took 6.205 seconds and the presentation
catalog reused it in 62 milliseconds. The installation mapped 557 cosmetics and
57 regular items, with 50 regular-item baked PNGs; the isolated policy check still
used 547 historical cosmetic IDs and 29 Recharge identities.

### Application navigation

The source Electron application and unpacked Windows executable used the reviewed
installation read-only, synthetic encrypted saves and temporary profiles:

| Observed journey                              | Source Electron | Unpacked Windows executable |
| --------------------------------------------- | --------------: | --------------------------: |
| Cold entry through full 557-artwork readiness |         15.82 s |                     12.25 s |
| Cosmetics tab re-entry                        |          0.30 s |                      0.31 s |
| Cosmetics entry after application relaunch    |          2.14 s |                      1.27 s |

These journeys include cross-process catalog/readiness work and ran alongside
other validation. Both applications entered without full preparation panels and
reused persisted validation without rewriting it on relaunch. Another packaged
run measured 0.39-second re-entry and 2.60-second relaunch entry; the
reader-isolation packaged run measured 0.303-second re-entry.

Both applications loaded baked artwork and retained all seven missing-item
placeholders despite synthetic LocalLow PNGs. Browser-image failures fell back to
Phosphor. Synthetic missing/corrupt PNG and cache cases exercised recovery without
changing installed assets. Fixture saves were unchanged. Layout checks covered
1600×900, 1200×800 and the 960×640 minimum without horizontal document overflow.
The historical validation configuration rejected ID 547 mutation; current
cosmetic policy is described separately above.

### Automated coverage

| Check                                                         | Result                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Python full suite from repository root                        | 517 passed, 2 existing Windows symlink-creation skips                            |
| Ruff check / format check / mypy                              | Passed; 77 production source files checked by mypy                               |
| Import normalization / formatting / ESLint / production build | Passed; ESLint has no errors or warnings                                         |
| Renderer, Electron and component tests                        | 361 passed across 43 files; import/theme checks also passed                      |
| Focused cache regressions                                     | 17 passed                                                                        |
| Source Electron E2E                                           | 4 passed, including safe writes/backups and game-process blocking using fixtures |
| Sidecar build / unpacked packaging / package contents         | Passed; all ten required package files present                                   |
| Packaged E2E                                                  | 1 passed; Python-backed workspace open/reopen verified                           |
| Actual installed-artwork smoke                                | Source and unpacked Windows app passed the journeys above                        |
| Bundle check                                                  | Passed with existing warning budget exceeded: 582.53 KiB raw / 156.41 KiB gzip   |

The initial resolver configuration recorded 518 Python tests, 357 renderer/contract
tests and four Electron journeys. The LocalLow-exclusion and packaging
configuration recorded the 517/361 results in the table. Reader isolation recorded
535 Python tests, two Windows symlink skips, 361 renderer/Electron tests, four
source journeys and one packaged journey, with Ruff, mypy, imports, formatting,
build and package verification passing. The two Windows symlink-creation skips
depend on host permissions; the junction-escape regression ran successfully.

The recorded renderer bundle warning was 582.53 KiB raw / 156.41 KiB gzip. NSIS
install/uninstall lifecycle acceptance was not part of this artwork validation.
No item reconstruction cache or renderer exists, so these tests and timings do
not establish its cold/warm latency, memory, invalidation or cleanup behavior.
