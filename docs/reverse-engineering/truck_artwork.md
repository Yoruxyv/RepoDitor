# Installed item and cosmetic artwork

Historical record for PR #122: its artwork-only integration deliberately retained the 547-ID
mutation policy. The later [current-game compatibility investigation](../research/current-game-compatibility.md)
records independent approval of 557 cosmetic IDs and user-confirmed in-game Unlock All recognition.
Individual unlock, removal and game-restart persistence remain unconfirmed in-game.
The observations below retain their original provenance.

This is presentation evidence for the reviewed installation, not save-mutation
authorization. The existing RectTransform investigation remains in
`sunstone-truck-artwork.md`; that work has been preserved rather than renamed.

## Audit decisions

| Decision | Boundary |
| --- | --- |
| KEEP | Shared Transform/RectTransform traversal, player-upgrade artwork, the opaque icon protocol, existing save-writing and cosmetic mutation gates. |
| FIX | Derive baked filenames from installed canonical identities; serve installed PNGs directly; verify readiness without blocking the catalog. |
| DEFER | Broad historical naming cleanup, unrelated refactoring, the separate repository-wide audit, faithful regular-item reconstruction, installer lifecycle validation. |
| REJECT | MD5 guesses, image similarity, filesystem ordering, fixed filename tables, invented IDs, and a new 3D thumbnail renderer. |

## Provenance and identity proof

The inspected Steam build is **26294889**, Unity **6000.3.17f1**. The reviewed
`REPO_Data/Managed/Assembly-CSharp.dll` SHA-256 is:

```text
aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888
```

That assembly identity is shared by the existing upgrade reader and the new baked
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

| Domain | Canonical identities | Installed baked PNGs | Matched identities / files | Missing | Extra files | Shared/ambiguous matches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Regular items | 57 | 50 | 50 | 7 | 0 | 0 |
| Cosmetics | 557 | 559 | 557 | 0 | 2 | 0 |

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

| PNG | GameObject name | PathID |
| --- | --- | ---: |
| `f9280367fb16f28d151b7b69e787a636.png` | `Cosmetic - Head Bottom - Constructor` | 178041 |
| `1ecf315f940994aa8f95c5a0c6e3f298.png` | `Cosmetic - Grabber Mesh - Petals 2` | 178093 |

A read-only search of GameObject/MonoBehaviour names in the installed root
serialized files found these exact matches. Neither extra name is in the
authoritative 557-entry CosmeticAsset vector. Their keys match these installed
GameObject names and remain outside the supported catalog, not evidence for IDs
557 and 558. Whether they are unused, reserved, or otherwise intended for future
use remains unproven.

Confidence is high for the mapping algorithm and the complete 557/50 matched
coverage in this exact build. The extra prefab names are proven; their gameplay
status is not.

## Runtime and preparation behavior

- Python discovers the game through the existing discovery path, validates the
  Steam manifest/build and managed assembly, and derives canonical hash inputs.
- A bounded, versioned `baked-artwork.json` cache stores identity metadata only.
  Source-file changes invalidate it. It is never a mutation capability or an
  independent semantic oracle.
- Electron receives paths only through the internal Python command. React receives
  only registered opaque `repoditor-icon://` tokens.
- Installed PNGs are served in place. An Electron `presentation/baked/manifest.json`
  records validated file stamps, tied to the installed source identity, so an
  unchanged app relaunch checks files without decoding every PNG again. Cache
  write failures are optional and cannot prevent artwork from being served.
- Cosmetic source order is verified baked artwork, RepoDitor's validated persistent
  decoded Sprite cache, direct installed Sprite extraction, then Phosphor.
- Regular items currently use verified baked artwork, then Phosphor. The intended
  reconstructed PNG cache and direct mesh/material renderer are not implemented:
  the bounded feasibility probe below did not establish faithful thumbnails.
- Regular items and cosmetics never consult the game's LocalLow icon cache,
  including readiness checks and legacy cache registrations. LocalLow save/data
  discovery remains unchanged. Player upgrades retain their existing pipeline.
- Upgrade artwork source order and decoding remain unchanged.

The preparation-screen problem had two causes: Electron immediately published
`checking` before determining whether any work was needed, and the workspace
treated both `checking` and `preparing` as blocking states. The old readiness check
also trusted manifest source watches without verifying that each output PNG still
existed and remained valid.

Readiness is now silent. Fully validated sessions go directly to the catalog.
Real missing assets alone start preparation; a partially available catalog stays
accessible with compact progress. A completely cold, genuinely missing batch can
use the existing full preparation panel, with immediate background continuation.
Explicit progress viewing still works. Failed optional Sprite requests do not
trigger repeated extraction on every tab entry; successful cache entries can be
invalidated and repaired. Tests cover navigation, remount/relaunch, partial cache,
missing/corrupt outputs, transport failure, and source changes.

## Safety and compatibility

Installed files are read only. Python rejects unsafe source paths and reparse
points and verifies source snapshots around discovery. Electron requires exact
canonical filenames and identities, rejects redirected PNG paths, validates
regular files, and compares file identities around descriptor reads. Reads remain
bounded even if files change size during a race. Decoding accepts only the reviewed
8-bit RGB/RGBA, non-interlaced PNG layouts, bounded dimensions/chunks/decompressed
scanlines, valid CRCs, and supported row filters. Missing or unsupported assets
fail soft.

The Python/Node boundary normalizes Windows volume identity to libuv's low 32-bit
serial representation. The installed Python 3.14.6 / Node 24.18.0 pair otherwise
reported different device IDs for the same file. A real cross-runtime regression
test protects this contract; no tools or dependencies were upgraded.
See [libuv's Windows file identity assignment](https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/fs.c)
and [CPython's Windows stat assignment](https://raw.githubusercontent.com/python/cpython/3.14/Python/fileutils.c).

IDs **547 through 556 remain read-only**. Artwork mapping does not alter the generated
cosmetic mutation set, Electron mutation checks, MetaSave validation, backup/write
safety, or the separate Recharge evidence gate. No game PNGs are bundled, copied
into fixtures, committed, or uploaded. All PNG test fixtures are synthetic.

Unknown builds or a changed managed assembly use the existing fallbacks. Future
support requires renewed build/assembly/layout evidence, not expanding a count or
accepting a new hash automatically. Bump metadata/validation schema versions when
their interpretation changes.

## Initial implementation validation (before the LocalLow correction)

Observed on the local Windows machine; these are module timings, not an end-to-end
application startup benchmark:

| Check | Observed time | PNG files opened |
| --- | ---: | ---: |
| Cold canonical metadata discovery | 5.75 s | 0 |
| Warm canonical metadata lookup | 55.2 ms | 0 |
| First validation of 557 cosmetics + 50 items | 1.68 s | 607 |
| Fresh reader reusing persisted validation | 175 ms | 0 |

The validation cache contained only `manifest.json`. Partial-cache regressions
prove that only missing IDs enter the Sprite batch and that overlapping/repeated
navigation does not start duplicate extraction tasks.

The initial implementation report recorded 518 Python tests, 357 renderer/contract
tests and four Electron journeys passing. The focused review below supersedes
those counts after the LocalLow source correction.

The E2E workspace journey covers 1600 x 900, 1200 x 800, and the 960 x 640 minimum
window. Synthetic saves verify backups, stale-source rejection, game-process write
blocking, cosmetic navigation, and the restricted preload surface. The existing
quality workflow already enforces these commands, so no new CI gate was required.

The two pre-existing Python symlink tests can be skipped when Windows does not
permit creating symlinks; the new junction-escape regression runs successfully.
The renderer bundle budget is warning-only and remains exceeded. Packaged installer
smoke tests are deferred to release validation.

## Focused architecture review

The full working-tree change is reviewed against PR #122's `main` base
`98a61741d6940d8e49385cf15f579818537b59ad`, including the original RectTransform
correction. Historical evidence remains in `sunstone-truck-artwork.md`.

| Decision | Severity | Finding / disposition |
| --- | --- | --- |
| KEEP | Informational | Baked identities, build/assembly verification, bounded shared Transform/RectTransform traversal, source-aware Sprite cache, opaque protocol and existing mutation gates. |
| FIX | P1 | Remove LocalLow item/cosmetic selection from Python projections, Electron readiness and protocol serving. Upgrade behavior is preserved. |
| FIX | P2 | Load persisted baked validation before serving initial image requests, avoiding an unnecessary manifest rewrite on relaunch. |
| FIX | P2 | Respect native Windows filename case in the preserved upgrade LocalLow reader without accepting redirected paths. |
| FIX | P3 | Repair damaged Unicode in this document and remove the redundant file ledger and repeated readiness claims. |
| DEFER | P2 | Faithful reconstruction of the seven regular items; no production renderer, reconstructed cache or reconstruction job is claimed. |
| FIX | P2 | The final packaging continuation ships the existing Sprite decoder dependencies and their required native/data resources; a real read-only extraction is verified below. |
| DEFER | Informational | Repository-wide DRY/quality audit and speculative cache unification. Baked validation stamps, decoded Sprite PNGs and canonical metadata have distinct ownership; this change does not add a parallel item cache. |
| REJECT | Correctness | Flat UV/albedo textures as finished item icons, unproven camera/render settings, a permanent reconstruction service, and LocalLow as a workaround. |

### Bounded reconstruction feasibility probe

A read-only probe opened `resources.assets` and the ResourceManager once for all
seven items, reused `find_prefab_renderers`, mesh readers, material/texture
resolution and the existing BC1/BC3 decoder. It took 12.55 seconds locally and
wrote only JSON evidence, never PNGs or game files. It is an investigation script,
not a startup task or product background service.

| Item | MeshRenderers found | Local materials resolved | Mesh vertex sets resolved | Textures decoded |
| --- | ---: | ---: | ---: | ---: |
| Cart Cannon | 36 | 6 | 3 | 4 |
| Cart Laser | 42 | 10 | 4 | 4 |
| Cart Medium | 30 | 9 | 4 | 7 |
| Leaf Blower | 14 | 2 | 1 | 0 |
| Power Crystal | 11 | 1 | 0 | 1 |
| Vehicle Semiscooter | 77 | 15 | 19 | 10 |
| Vehicle Semiscooter Small | 68 | 10 | 14 | 8 |

These are partial relationships, not complete rendered parts or recovered icons.
The current narrow helpers reject external/unsupported mesh references and
ambiguous materials/vertex layouts; Leaf Blower's two resolved materials do not
produce a supported local `_MainTex`. The managed `SemiIconMaker` calls
`Camera.Render` with a target RenderTexture and controlled ambient/fog settings.
The shared Transform reader currently exposes ownership/children, not composed
world transforms; the mesh framing helper exposes vertex channels, not a full
triangle/submesh renderer. Shader semantics, visible/disabled parts, camera
framing, lighting, depth and transparency remain unproven for these prefabs.

Accurate reconstruction is not established with the current helpers. All seven
retain Phosphor placeholders, including Leaf Blower. No texture atlas is presented
as a thumbnail. A future renderer needs a separate bounded visual proof against
known baked images before adding cache storage or preparation jobs.

### Job and cache behavior

Cosmetic preparation reuses the existing finite Sprite batch: only IDs absent
from baked and validated decoded caches are requested. Concurrent navigation
shares one job, cached entries survive relaunch, per-entry watches invalidate
affected decoded images, failed optional work falls back, and the Python client
owns timeouts and kills children on application shutdown. No timer polls or
permanent worker were added. The same batch indexes installed sources once;
there is no full-game scan for each image during preparation.

There are no regular-item reconstruction jobs, so CPU, memory and cache guarantees
for such a renderer are explicitly unimplemented. Tests exercise baked and Sprite
cache reuse, corruption/source invalidation, deduplication, navigation and failure
fallback; they must not be described as tests of an item renderer.

### Application smoke evidence (2026-11-01)

Both the production-built source Electron application and the unpacked Windows
`RepoDitor.exe` used the real reviewed installation read-only and separate temporary
profiles with synthetic encrypted saves. No real saves, installed assets or game
caches were modified, and no game-art screenshots/traces were captured.

| Observed journey | Source Electron | Unpacked Windows executable |
| --- | ---: | ---: |
| Cold entry through full 557-artwork readiness | 15.82 s | 12.25 s |
| Cosmetics tab re-entry | 0.30 s | 0.31 s |
| Cosmetics entry after application relaunch | 2.14 s | 1.27 s |

These observations include cross-process catalog/readiness work and were collected
while other validation ran; they are not a startup performance budget. Both apps
showed zero full preparation panels in these journeys and reused their persisted
baked validation manifest without rewriting it on relaunch. Initial discovery
still takes seconds; warm navigation does not reconstruct or rescan the game.

Both apps loaded regular baked artwork, kept all seven missing regular items as
placeholders despite valid synthetic LocalLow PNGs, and fell back to Phosphor on
a simulated browser image failure. Missing/corrupt source PNGs and corrupt owned
Sprite-cache outputs were exercised with synthetic files in regression tests;
installed PNGs were never altered to induce failures. The three desktop sizes
had no horizontal document overflow. IDs 547 through 556 remained read-only;
an attempted unlock was rejected, regular items gained no Recharge authority,
and synthetic save bytes remained identical after the smoke journey.

Final checks:

| Check | Result |
| --- | --- |
| Python full suite from repository root | 517 passed, 2 existing Windows symlink-creation skips |
| Ruff check / format check / mypy | Passed; 77 production source files checked by mypy |
| Import normalization / formatting / ESLint / production build | Passed; ESLint has no errors or warnings |
| Renderer, Electron and component tests | 361 passed across 43 files; import/theme checks also passed |
| Final focused cache regressions after test-helper cleanup | 17 passed |
| Source Electron E2E | 4 passed, including safe writes/backups and game-process blocking using fixtures |
| Sidecar build / unpacked packaging / package contents | Passed; all ten required package files present |
| Packaged E2E | 1 passed; Python-backed workspace open/reopen verified |
| Actual installed-artwork smoke | Source and unpacked Windows app passed the journeys above |
| Bundle check | Passed with existing warning budget exceeded: 582.53 KiB raw / 156.41 KiB gzip |

### Packaging validation and initial fingerprint blocker (2026-11-01)

The packaged Sprite fallback is intended to work, so the packaging group now locks
`UnityPy[ttgen]==1.25.4` and `addressablestools==1.1.1` (Python 3.12+). The sidecar
continues to build with Python 3.13; these dependencies remain lazy and do not run
when baked artwork is available. No decoder or artwork-resolution architecture
was rewritten, and LocalLow selection remains absent for items and cosmetics.

PyInstaller explicitly collects UnityPy and its type-tree resources, the native
TypeTreeGeneratorAPI, and Addressables' dynamic import. Actual frozen extraction
also exposed two transitive resource requirements: UnityPy's eager exporter import
loads fmod_toolkit's bundled DLL even for Sprites, and its texture decoder needs
archspec's CPU JSON. Both are now collected. Package verification fails closed if
the type-tree DLL, Unity type database, FMOD DLL, or CPU JSON files are missing.
Dependency metadata/licenses are included with the collected packages.
The [PyInstaller collection options](https://pyinstaller.org/en/stable/usage.html#what-to-bundle-where-to-search)
are used directly; no private loader patch or custom rendering service was added.

Only these final packaging files changed beyond the previously reviewed feature:

- `pyproject.toml` and `uv.lock`: required, version-locked packaging dependencies;
- `desktop/package.json`: PyInstaller collection declarations;
- `desktop/scripts/check-package-contents.mjs`: required runtime resource checks;
- `desktop/python/repo_save_editor/services/cosmetics/installed_artwork.py`: update
  the module documentation to match the packaged runtime contract;
- this document: corrected packaging status and pre-commit gate result.

The rebuilt production sidecar directly extracted cosmetic ID 0 from the installed
game in 5.77 seconds: a validated 512 x 502 PNG, 101112 bytes, with six source
watches. The test bypassed baked resolution by invoking the existing Sprite command,
captured its output in memory, retained only metadata/hashes, and did not save a
game PNG or modify installed assets. Both the source Python 3.14 environment and
the locked packaging Python 3.13 environment independently produced the same PNG
dimensions and byte count. This validates direct extraction, not a new item renderer.

Fresh validation also passed 517 Python tests (two existing Windows symlink skips),
361 renderer/Electron tests, Ruff, mypy, imports, formatting, ESLint, release-contract
checks, the production build, and dependency-lock validation. A test run overlapped
with build cleanup and lost its compiled modules; a subsequent sequential full
rerun passed all 361 tests. No assertions or diagnostics were weakened.

After the final resource fix, all four source Electron E2E journeys and the
packaged Python-backed workspace smoke passed again. The rebuilt Windows app
also passed the installed-artwork journey: 557 validated cosmetic images, no
unnecessary preparation screen, 0.39-second tab re-entry and 2.60-second relaunch
entry while other checks ran, unchanged fixture-save bytes, all seven missing
item placeholders, and unchanged mutation restrictions. Package verification
confirmed all ten required files, including the new native/data resource checks.

**Historical packaging checkpoint: BLOCKED (resolved by the isolation below).** `python -m tools.capabilities check` reproduces the
existing required Desktop-Web Alignment failure. Both historical evidence records
bind `services/unity_serialized.py` to normalized source SHA-256
`028a0f1b59d289a0436684f5f59c3b51a0ebbf77e52c656ba766df7cb07556cf`;
the then-shared Unity 6 reader had normalized SHA-256
`8f95b880e46e0156682e67690c4d9dce88a884de465e300bfd228dcac3077b95`.
The checker stops on the Recharge fingerprint mismatch before checking Cosmetics.

The [documented reapproval workflow](../maintenance/game-update-capabilities.md)
requires build-matched independent oracle/provenance inputs. Its historical
approved build is 23363152 / Unity 2022.3.67f2, while the available installation
is 26294889 / Unity 6000.3.17f1. Its newer 557-entry readable catalog must not be
substituted for the historical 547-ID mutation approval to silence a fingerprint
check. Frozen evidence, generated capability modules and authorization remain
unchanged. Retaining that shared-reader expansion would have required historical
parser revalidation; the subsequent isolation below avoids changing that boundary.
The earlier readiness recommendation had omitted this gate.

At that checkpoint PR #122's published head was `ab4a14c`, mergeable with no review
threads or submitted reviews, but with a failing Compatibility check. The changes
were not committed or pushed while that required validation remained failing.

The seven regular-item thumbnails and RepoDitor-owned reconstruction cache/worker
remain a separate post-PR milestone. The intended order remains verified baked
artwork, validated RepoDitor reconstructed cache, bounded on-demand reconstruction,
then placeholder, with no LocalLow. Successful results must survive relaunch and
navigation must remain responsive. No 3D reconstruction was added here.

The existing renderer bundle warning remains 582.53 KiB raw / 156.41 KiB gzip.
NSIS install/uninstall lifecycle and CI for these uncommitted changes remain untested;
the repository-wide audit is still deferred until after merge.

### Capability-reader isolation (2026-11-01)

The fingerprint mismatch came from adding `SUNSTONE_UNITY_VERSION`, a two-version
allowlist and the RectTransform constant to `unity_serialized.py`, broadening its
type-header version check, and recording `unity_version` on the reader. Although
these changes supported artwork, the entire shared source file is bound to both
historical Recharge and Cosmetics evidence.

Two approaches were evaluated:

- **A, selected:** restore the historical reader exactly and specialize the small
  artwork type-header hook. Object tables, type records, pointer parsing, bounds,
  mappings and cleanup remain inherited from the historical implementation.
  The small explicit header and cosmetic file-opener overrides are the deliberate
  maintenance cost of preserving that evidence-pinned source boundary. They do not
  relabel headers, patch module globals or copy the serialized-file implementation.
- **B, not used:** reapprove a changed shared parser with build-matched independent
  oracle evidence. The available Sunstone installation is not proof for the older
  approved build. Synthetic regression fixtures are not presented as a new oracle.

`unity_serialized.py` again matches its original normalized SHA-256
`028a0f1b59d289a0436684f5f59c3b51a0ebbf77e52c656ba766df7cb07556cf`.
The capability checker, evidence records, historical item/cosmetic scanners and
generated permission/snapshot files are unchanged.

Production changes for this correction:

| File | Responsibility |
| --- | --- |
| `services/unity_serialized.py` | Restore the historical, evidence-pinned reader byte-for-byte. |
| `services/unity_artwork.py` | Add `ArtworkFileIndex` for the two explicitly reviewed artwork versions; own artwork version/RectTransform constants. |
| `services/cosmetics/installed_artwork.py` | Use an artwork file opener while inheriting existing pointer resolution and file-count/cleanup checks. |
| `services/baked_artwork.py` | Use artwork readers and retain cosmetic display metadata already encountered during identity discovery. Metadata schema 8 rebuilds older caches once and validates the catalog before reuse. |
| `services/cosmetics/presentation_catalog.py` | Reuse the verified baked metadata index for modern display metadata; retain historical catalog discovery for historical builds. No second modern scanner or cache. |
| `desktop_api/cosmetics.py` | Select the presentation catalog for the existing typed runtime projection and write validation; generated mutation policy remains authoritative. |
| `services/unity_textures.py` | Select texture layout from the explicit artwork reader version; a historical reader implies its approved 2022 layout. |
| `services/player/upgrade_textures.py` | Open read-only artwork through `ArtworkFileIndex`; existing decode, framing and write gates are preserved. |

Paths above are beneath `desktop/python/repo_save_editor/`. Focused tests are in
`test_unity_artwork.py` and `test_cosmetic_presentation_catalog.py`; existing baked,
RectTransform, Texture2D, generic-reader and upgrade-preparation tests were updated
to address the correct reader boundary without removing their assertions.

Both `python -m tools.capabilities check` and Web's `npm run capabilities:check`
pass: **29 exact Recharge identities and 547 explicit cosmetic mutation IDs**.
The full Python suite passes **535 tests**, with two existing Windows symlink
skips; Ruff and mypy pass. Tests verify legacy rejection of Unity 6 even after an
artwork read, equivalent historical object parsing, malformed header rejection,
failure cleanup, unknown version rejection, metadata cache migration/corruption,
and read-only treatment of IDs 547 through 556.

The installed read-only check still maps 557 cosmetics and 57 regular items,
of which 50 have baked PNGs. Only the historical 547 cosmetic IDs remain eligible;
the current installation is not approved for Recharge. Cold metadata discovery
took 6.205 seconds; the presentation catalog then reused it in 62 milliseconds.
The rebuilt sidecar directly extracted the same 512 x 502 Sprite PNG in 5.841
seconds, SHA-256 `2c47f697b82e972704162ea47af0d977c8fe832c700bbed55119b848d464a365`.
These are local observations, not startup performance budgets. No new historical
oracle, capability approval or save mutation is claimed by these artwork checks.

The seven missing regular-item thumbnails remain placeholders and a separate
post-PR reconstruction milestone. LocalLow artwork resolution stays excluded for
regular items and cosmetics. The broader repository audit remains deferred.

Final local validation after isolation also passed imports, formatting, ESLint,
the production build, all 361 renderer/Electron tests, four source Electron E2E
journeys, sidecar/unpacked package verification, and the packaged E2E journey.
Actual source and unpacked Windows application checks both verified 557 cosmetic
images, direct catalog entry/re-entry/relaunch without a full preparation panel,
the seven missing item placeholders, rejected ID 547 mutation, no newly granted
Recharge capability, unchanged fixture saves, and no horizontal overflow at the
three desktop sizes. The packaged tab re-entry observation was 0.303 seconds;
the existing renderer bundle warning remains unchanged.

The local compatibility blocker is resolved with no evidence or checker update.
Commit/push is authorized after review of the intended staged source files; remote
CI must validate the resulting PR head before merge. No automatic merge is authorized.
