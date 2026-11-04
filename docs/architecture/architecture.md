# Architecture

RepoDitor has two production user interfaces: the Windows Desktop application and the hosted
RepoDitor Web application at https://repoditor.vercel.app/. Python remains authoritative for
save-format and game behavior inside Desktop; Web is an independent browser implementation that
shares evidence-backed semantics rather than Desktop implementation code.

The diagram below describes the Desktop boundary.

```text
React renderer
      |
sandboxed preload with typed channels
      |
Electron main IPC validation
      |
Python desktop API JSON protocol
      |
services
      |
core + storage
      |
R.E.P.O. .es3 files
```

## Boundaries

- `desktop/src/` owns presentation, renderer-local theme/language preferences, and typed in-memory pending edits. It cannot read files, spawn processes, parse raw saves, or derive game mechanics.
- `desktop/electron/` owns narrow IPC validation, the secure preload surface, Python process lifecycle, and the fixed GitHub repository-metadata request. It exposes no arbitrary renderer fetch API and caches successful metadata for the Electron session. Within local artwork, `icons/protocol.cts` owns opaque-token protocol serving and trusted-root file checks, `icons/upgradeTextureCache.cts` owns decoded upgrade cache/manifest/watch state and cache diagnostics, and `icons/png.cts` owns the shared bounded-PNG validation.
- `desktop/python/repo_save_editor/desktop_api/` translates the stable command protocol into Python service calls. Standard output is reserved for bounded NDJSON protocol records; commands that support streaming may emit multiple records, while diagnostics use standard error.
- `desktop/python/repo_save_editor/services/` owns editor behavior for discovery, players, upgrades, run
  data, maps, advanced discovery/refill semantics, MetaSave cosmetic ownership, and save summaries.
- `desktop/python/repo_save_editor/core/` owns encryption, schema validation, and shared save types.
- `desktop/python/repo_save_editor/storage/` owns repository access, backups, temporary validation, stale-file protection, and atomic replacement.

Electron keeps `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing enabled. Input is validated at both the Electron and Python boundaries. Python verifies the validated R.E.P.O. process is closed before supported writes; startup and focus checks keep the renderer state current, and an unknown process state fails closed.

## Experimental native host

The opt-in Windows Tauri host under `desktop/src-tauri/` exposes
`environment_detect`, `saves_open`, `players_list`, `upgrades_list`, `run_get`, `advanced_get`, `game_status` and `preview_close`. Its typed
read adapter composes the discovery adapter with save-open, player-list, upgrade-list, Run, Items and game-status
contracts, and exposes no write method. Its entry reuses discovery, save-loading,
Overview, Players, Upgrades, Run, Items, selected-save header, preferences and game-safety presentation.
Electron remains the shipping host;
its preload, IPC, save services, installer and release defaults are unchanged.

Rust translates the existing Python discovery DTO and validates required fields,
dates, JavaScript-safe numbers, save counts, session fingerprints, response ID
identity, required visual keys and root/game consistency before returning the
existing renderer contracts. Save opening accepts only the existing opaque ID
format; Python re-discovers and loads that ID through its unchanged save-domain
service. Rust performs no decryption or save interpretation. No write, arbitrary
path, executable, argument, network, filesystem or shell command is exposed.

Overview is a read-only session snapshot. Reopening reads current bytes and a
fresh fingerprint, including changes made after discovery; it does not apply a
write-only stale-file rule to reads. Players uses Python's existing `players-list`
service and Electron's numeric-ID, nonempty-name and JavaScript-safe health DTO
contract. Duplicate IDs are rejected; Python's dictionary projection produces
unique IDs. Health may exceed maximum health in an existing save, as in Electron;
the shared progress display clamps it without altering the saved value.
The existing Players hook accepts an injected list method, loads once per open
workspace and retains selection across tabs. Retry and reopening read current
bytes. Health is read-only, editing controls are absent, and the existing avatar
fallback renders immediately without a network/artwork command.

Upgrades calls Python's unchanged `upgrades-list` service. Save dictionaries define
membership; Rust validates the existing bounded prefix keys, labels, presentation
source enum, nullable nonnegative gameplay caps and JavaScript-safe per-player
values. Stored values above presentation caps or the editor's Int32 write bound
remain visible. Upgrade keys and per-upgrade player IDs must be unique, and each
upgrade must reference the same player-ID set, as Python's projection guarantees.
This does not compare independent reads with a cached Players snapshot: external
save changes are read afresh. Reopening refreshes the workspace and selection.
Players and Upgrades share the selected-player state. The injected Upgrades hook
coalesces overlapping reads and ignores late results after unmount. The shared
view retains editable Electron controls by default; the native variant renders
read-only text fields with keyboard focus/copying and no mutation handlers,
pending edits or revert actions. Validated `iconKey` metadata is discarded and
`iconToken` is always null; the existing Phosphor fallback needs no native artwork
URL, protocol or cache authorization. Other workspace controls remain unavailable.
Visual readiness is unresolved when upgrade keys exist because artwork is not
migrated; Overview does not wait for that optional work. Game status retains the
distinct `unknown` state. The existing startup/focus/retry hook and safety modal
block workspace interaction while status is running, unknown or initially
unchecked, as in Electron. Native close cancels outstanding backend work.

Run invokes the unchanged Python `run-get` service through the same opaque save
ID resolution. Rust validates the DTO's known stat keys, uniqueness, nonempty
labels, signed JavaScript-safe integer values and one-based level minimum of 1.
The stat list may be a subset or empty; read values are not constrained to the
editor's Int32 write bounds. Resume value/options must be nonempty, unique and
include the observed value; Rust has no location catalog or save-domain rules.
The injected Run hook coalesces reads and discards late results on unmount. The
shared view preserves Electron's numeric editors and location selector; native
Run renders copyable read-only text fields without pending/revert/save controls.

Items calls Python's unchanged `advanced-get` service. Rust validates all six unique
domain keys, evidence enums, nullable nonnegative counts, boolean capabilities,
canonical item-key/name/instance relationships, unique identities, signed safe
stored charge and charge/recharge consistency. Counts remain nonnegative; stored
charge follows Electron's signed read contract without applying write bounds.
The 2 MiB frame bounds every item array and string; the six-domain membership and
existing icon/upgrade-key limits provide additional structural/metadata bounds.
Rust does not classify items, infer game evidence or maintain a recharge evidence
store. Private recharge evidence/raw fields are discarded; validated optional
artwork keys are stripped and every icon token is null. The shared view preserves
grouping, search, filter/sort, charge states, skeletons and failures. Native passes
no mutation handlers: refill/revert/pending/save controls stay absent even when
the retained backend capability reports support. Electron's editors remain the default.

Maps calls Python's existing `maps-list` service without renderer arguments or
Rust discovery logic. Rust validates success/error framing, boolean availability,
catalog-path consistency, at most 128 maps, unique internal identities (64 UTF-16
units, no separators/control characters), display labels (128 UTF-16 units, no
control characters), boolean known-label flags and nullable/optional lowercase
SHA-256 artwork revisions. Unavailable results require a null path and empty roster;
available-empty catalogs remain distinct. Unknown valid map families are retained.
Artwork metadata is discarded and icon tokens are always null. The existing Maps
view and injected hook preserve cards, layout, skeletons, refresh data, translated
errors and superseded/unmounted response handling. Electron keeps its default API.
The native host grants no artwork decoding, streaming, cache or map-control authority.

Cosmetics is a separate global workspace, available without selecting or opening a
Run save. Its fixed `cosmetics_get` command accepts no renderer path or save ID and
delegates to Python's existing `cosmetics-get`. Rust validates the fingerprint,
JavaScript-safe signed IDs/metadata, nonnegative counts, unique identities, known
roster ordering, unknown-owned roster agreement, state/count/capability consistency,
required removal reasons and optional icon keys. Eligibility validation consumes
the [existing frozen capability evidence](../../tools/capabilities/evidence/cosmetics.v2.json)
used by Python/Electron's generated policies; it does not infer authority from a
catalog size or maintain another catalog. Tests compare that evidence with both
generated consumers. Unknown IDs, signed metadata and eligible-but-removal-blocked
entries retain the existing Electron contract. Icon tokens remain null and private
MetaSave fields are discarded.

The native read hook coalesces refresh clicks, ignores unmounted/superseded results
and reloads on workspace entry or game-safety recovery. A superseding entry waits
for the admitted read to release before starting one fresh read. Its composition reuses
the Cosmetics summary/catalog with null mutation handlers. Search, filters, sorting,
metadata and counters remain available; ownership/preset/pending/revert/save controls
are omitted. The editable hook, artwork preparation and pending-write workspace are
not mounted by this host. Electron's default composition remains editable. The shared
game-safety boundary also covers global Cosmetics, including when no Run save is open.

The local main-window capability grants only those ten commands. CSP and
navigation constrain the bundled page; new windows are denied. The preview has
its own application identifier/profile and does not migrate Electron data.

Each request launches the fixed frozen backend directly, without a system-Python
fallback. Admission allows one outstanding request per read operation, at most
nine total; repeated calls to an occupied operation fail immediately. Eight ordinary
domain operations share one worker mutex. Game status bypasses that mutex; its
existing admission permit bounds the separate lane to one active or admitted
request, with no status backlog or additional mutex/pool. At most one domain child
and one status child can execute concurrently, each owning its own Job Object.
Each 30-second deadline includes dispatch and domain-queue time, unlike Electron's
concurrent process calls. Expired/closing requests fail before spawning. Queued requests also
observe cancellation. Every child retains the 2 MiB stdout limit, 64 KiB stderr
limit and bounded pipe queue. Public failures use allowlisted codes and sanitized
messages; translated UI errors retain the Electron mapping. A Windows
kill-on-close Job Object owns the assigned process tree;
normal close signals shared cancellation to both lanes and rejects new admission.
The window stays open until the existing request permits are released after child
reaping and pipe-reader joins. One conditional close waiter observes those flags;
repeated close events do not add waiters or locks. Process/pipe handles are reaped on errors
and timeouts. Assignment follows creation of the trusted bundled executable;
this does not claim containment of hostile code substituted by a compromised
local account before job assignment.

Game-status inspection does not wait for an expensive Maps/Items/domain read. The
renderer adapter coalesces overlapping status checks while direct duplicate native
requests are rejected. The existing safety hook still marks a recheck busy and
retains the previous resolved status until the new result; unknown/failed results
then block interaction. This leaves a freshness window during the status process
itself and between checks. Native exposes no write command. Future mutation work
must retain Python's authoritative `require_game_closed` check immediately around
real writes; cached renderer status is never write authorization.

The portable preview staging command copies the whole PyInstaller `--onedir`
tree into `build/tauri-preview/backend`. It never changes production release
output. See [Desktop setup and preview checks](../../desktop/README.md#optional-native-discovery-preview).

Installer ownership is independent of the application host. The existing C#
WebView2 installer and React UI remain the required installation interface,
including path/scope selection, elevation, updates, uninstall, signing and safe
cleanup. Its authenticated [extraction progress contract](../installer-progress.md)
must retain measured byte counters and authoritative completion checks.

The existing NSIS include uses electron-builder's `customInit`/`customUnInit`,
scope/registry macros and pinned Nsis7z extraction override. It is not a drop-in
Tauri installer-hooks file. A custom template or dedicated NSIS integration must
preserve that contract; hooks alone do not establish compatibility. The current
native preview has no installer and uses a different executable/backend layout
from the C# host's Electron payload postconditions. Those checks must be adapted
to real native artifacts, never bypassed with placeholder Electron files. Full
install/update/uninstall and cross-host upgrade validation remain required before
changing the production installer integration.

## Web boundary

RepoDitor Web is an independent browser implementation. Save import, ES3 decryption, validation,
in-memory editing, re-encryption, verification, and export remain in the browser and do not import
Desktop implementation code.

The sole server-assisted Web capability is optional avatar enrichment. A Run save may send at most
16 validated SteamID64 strings to the same-origin `/api/steam-avatars` function. That function
constructs fixed Steam Community profile URLs and returns only allowlisted HTTPS Steam CDN image
URLs. It receives no save file, encrypted bytes, decrypted JSON, health, upgrades, run statistics,
or unknown fields; it persists nothing. Failure leaves initials in place and cannot block editor or
export behavior.

The production Web deployment is https://repoditor.vercel.app/. Its Vite application builds as
static assets and the narrow avatar boundary is provided by Vercel's `/api` function format. A
different static host may omit avatar enrichment or provide an equivalent same-origin function.
No server-side save-processing route is permitted.

## Desktop local presentation assets

Electron serves optional local images through registered `repoditor-icon:` tokens.
The renderer receives no image paths or filesystem authority. Failed or unavailable
images use Phosphor; artwork availability never changes mutation permissions.
Web does not read installed Desktop artwork.

| Content         | Source order                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Regular items   | Verified installed BakedIcons, then Phosphor. Seven known missing icons have no production reconstruction path.                          |
| Cosmetics       | Verified installed BakedIcons, validated decoded Sprite cache, bounded installed Sprite extraction, then Phosphor.                       |
| Player upgrades | Existing validated game-cache PNG where available, then validated derived cache and supported installed texture decoding, then Phosphor. |

Regular items and cosmetics never consult the game's LocalLow artwork cache.
Maps remain a read-only installed-location listing; loading-Sprite research is
documented in [asset research](../research/asset-research.md#maps).

### Cache ownership

| Artifact                                           | Owner and invalidation                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical identities and cosmetic display metadata | Python `baked_artwork.py`, schema 8, `%LOCALAPPDATA%\RepoDitor\cache\baked-artwork.json`; reviewed build/assembly and source identities. Historical cosmetic catalogs retain their separate cache. No PNG pixels or mutation authority. |
| Installed baked PNG validation                     | Electron `bakedArtwork.cts`, `presentation/baked/manifest.json`, format 1; installed index identity plus per-PNG validation stamps. PNGs stay in the game installation.                                                                 |
| Decoded cosmetic Sprite PNGs                       | Electron cosmetic artwork cache, `presentation/cosmetics`, format 1; cosmetic ID, source identity, PNG hash and source watches.                                                                                                         |
| Derived upgrade PNGs                               | Electron `upgradeTextureCache.cts`, `presentation`, format 2; upgrade key, derived source identity and artifact-producing file watches.                                                                                                 |

Electron cache roots are under its `userData` directory, normally
`%APPDATA%\repoditor-desktop`. The cache types have different keys and invalidation
contracts; a baked validation manifest is not storage for reconstructed pixels.
Source changes, missing/corrupt PNGs and unreadable caches trigger regeneration or
fallback. Cache-write failure must not block presentation.

Cosmetic preparation checks baked and decoded readiness before starting a finite
Sprite batch. Navigation shares in-flight work, valid results survive relaunch,
and failed optional work does not repeatedly scan the game. Upgrade preparation
retains its own finite coordinator. `python/client.cts` owns command allowlists,
output/time limits and child cleanup on shutdown; there is no permanent renderer.
`GameIcon` confines image loading to the thumbnail box and falls back on null/error.

Canonical filename derivation, source reconciliation, native decoder resources and
reader isolation are documented in [installed artwork](../reverse-engineering/truck_artwork.md).

### Upgrade cache diagnostics

Run the following commands from the repository root. These diagnostics apply to
the upgrade presentation cache, not every artwork domain.

To audit the derived presentation cache after restarting RepoDitor, run:

```powershell
.\desktop\scripts\check-presentation-cache.ps1
```

The read-only script compares `manifest.json` with the stored hash-named PNGs
and reports unreferenced or missing artifacts.

Upgrade presentation-cache manifest format 2 maps each dynamic upgrade key to a derived
PNG identity and the exact files used to produce it: `resources.assets`,
`globalgamemanagers`, the texture stream (normally `resources.assets.resS`), and
an independent mesh stream only when it supplied crop framing. Validation uses
their size and mtime, avoiding large-file hashing during warm startup.

`appmanifest_3241660.acf`, Steam App ID/BuildID, the install location, and the
validated `Assembly-CSharp.dll` are discovery or compatibility provenance, not
artwork inputs. Python still validates them before a decode, but their metadata
is excluded from the artwork identity and source watches. A Steam metadata-only
rewrite therefore remains a `persistent-hit`; a watched Unity source change is
reported as `source-changed`, followed by `source-decode-required` and
`persisted`, then `persistent-hit` on the next unchanged run. Existing format-1
caches rebuild once so they acquire the narrower source watches.

These are separate safety boundaries: a persistent artwork hit neither marks the
installed build as verified nor authorizes a new extraction or any save mutation.
Cold artwork extraction still requires the supported BuildID and validated assembly.
Installed-build-dependent editing features revalidate their own evidence, while
ordinary save edits retain their independent fingerprint, validation, backup, and
atomic-write protections.

The bounded local diagnostic log contains reasons such as `memory-hit`,
`persistent-hit`, `source-changed`, `source-missing`, `source-decode-required`,
`persisted`, `artifact-missing`, `artifact-invalid`, `manifest-invalid`, and
cache read/write failures. It contains no local paths or save contents. Inspect
recent decisions with:

```powershell
Get-Content "$env:APPDATA\repoditor-desktop\presentation-cache-diagnostics.jsonl" -Tail 100
```

## Local path discovery

RepoDitor derives R.E.P.O. user data from the Windows Known Folder API rather than from a
physical profile layout. `FOLDERID_LocalAppDataLow` is the authoritative dynamic base; the
product-owned suffix remains fixed as `semiwork/Repo`. Save slots and `MetaSave.es3` derive
from that shared root. Legacy game-cache paths remain discovery metadata; item and cosmetic
artwork resolution does not consult them. If the Known Folder lookup is
unavailable, discovery fails soft without guessing `Path.home()/AppData`, a drive letter, or
scanning user directories.

Installed-game discovery is similarly bounded. RepoDitor reads known Windows Steam roots,
`steamapps/libraryfolders.vdf`, and then the fixed `appmanifest_3241660.acf` in each configured
library. A bounded manifest parser validates the app identity and a safe single-directory
`installdir`, then derives `steamapps/common/<installdir>` and applies the existing structural
R.E.P.O. checks. Configured libraries are deduplicated while preserving Steam discovery/configuration
order, and the first structurally valid manifest-backed candidate is selected deterministically. No
Steam library or drive is recursively scanned.

Installation discovery and build compatibility remain separate facts. A `GameInstallation`
identifies a structurally valid candidate root and may carry authoritative Steam-manifest
provenance; fixed-build consumers independently validate that provenance before parsing
build-specific metadata. Explicit `REPO_GAME_DIR` roots remain valid discovery candidates but do
not become Steam-verified merely because their physical path resembles `steamapps/common`.

## Python runtime resolution

Runtime selection is centralized in `desktop/electron/python/client.cts`:

- development launches the repository-root `.venv/Scripts/python.exe -m repo_save_editor.desktop_api`;
- packaged Windows builds launch `process.resourcesPath/backend/repoditor-backend.exe` directly.

The package command builds the sidecar with Python 3.13. The packaged application does not fall back to a system Python installation.

## Installed item recharge capability

The approval tooling keeps independent-oracle parsing in `tools/capabilities/oracles.py`;
`tools/capabilities/workflow.py` retains evidence approval, generation, transaction, and rollback
orchestration. Exact object-shape validation remains shared through `tools/capabilities/schema.py`.

Item recharge support keeps three independent facts separate:

1. **Item-type capability** comes from read-only installed-game metadata. A narrow standard-library
   serialized-file reader validates the currently supported Steam build, Unity version, file format,
   object bounds, pointers, and component identities. It dynamically verifies an installed
   `MonoBehaviour` whose `MonoScript` class is `Item`, maps that verified item identity to every
   same-name installed prefab `GameObject` variant, and inspects those variants for `ItemBattery`.
2. **Exact-instance charge state** still comes only from the save's `itemStatBattery` evidence. A
   stored entry remains stored charge; absence is interpreted as full/default only when installed
   metadata confirms that item type is rechargeable.
3. **Mutation eligibility** remains the existing exact-instance refill rule. Only a confirmed
   rechargeable item with a stored charge entry may stage or write `Refill to Full`.

The Recharge reader bundles no prefab path-ID tables or proof manifests and remains fixed to the
validated `23363152` / Unity `2022.3.67f2` layout. Separately, optional cosmetic Sprite decoding ships
UnityPy and TypeTreeGenerator; their presence does not approve a newer Recharge build.
Missing assets, a future Steam/Unity/serialized-file version, incomplete pointers, exceptional
`ItemBattery` metadata, or conflicting prefab variants all degrade the affected capability to
`unknown`; ordinary save reading remains available. The authoritative Python save-write boundary
rechecks capability before applying a refill edit.

The measured uncached discovery cost on the validated installation was about 0.8 seconds, so the
initial production path performs discovery on the relevant Python read/write command rather than
adding an Electron-main cache and its invalidation surface.

## Supported production scope

Electron covers the supported production workflow: discovery/select/open, Overview, Players,
Upgrades, Run, Items with exact-instance refill-to-full, Cosmetics bulk ownership and paired
preset clearing, Maps,
pending edits, revert, safe writes, backups, stale-file protection, and failure states. Run saves
and MetaSave retain independent fingerprints and backups while sharing the validated encrypted
repository mechanics.

Other item mutations, arbitrary file browsing, Save As, and drag-and-drop are intentionally unsupported: discovered opaque save IDs keep filesystem access narrow, and backup-first overwrite is the only write path. Arbitrary cosmetic equipment/preset editing and token editing are also unsupported. Change save/reopen handles reloads, and the persistent pending-change bar makes the write boundary explicit.
