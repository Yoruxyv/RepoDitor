# Architecture

RepoDitor has two production user interfaces: the Windows Desktop application and the hosted
RepoDitor Web application at https://repoditor.vercel.app/. Python remains authoritative for
save-format and game behavior inside Desktop; Web is an independent browser implementation that
shares evidence-backed semantics rather than Desktop implementation code.

## Source and validation map

| Location                                   | Ownership                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `desktop/renderer/`                        | React presentation, typed drafts and feature orchestration; component tests stay beside their implementation.   |
| `desktop/src-tauri/src/`                   | Rust bootstrap, bounded Python transport, typed commands and projections, and gated transaction transport.      |
| `desktop/python/repo_save_editor/`         | Authoritative Desktop save semantics, encryption, validation, backups and transactions.                         |
| `desktop/python/tests/`                    | Python domain, storage, protocol and synthetic integration regressions.                                         |
| `desktop/installer/`                       | Installer host, UI, C# test fixtures, packaging scripts, and lifecycle tooling.                                 |
| `desktop/scripts/`                         | `quality/`, `tauri/` and `release/` tooling, with implementation and Node tests kept together.                  |
| `desktop/e2e/tauri/`                       | Packaged journeys, permission boundaries and interruption/recovery tests.                                       |
| `desktop/e2e/`                             | Shared `support/` harnesses, tracked `fixtures/` inputs and `fixture_generators/` used by packaged Tauri tests. |
| `scripts/git-hooks/`, `.github/workflows/` | Repository Git gates and CI orchestration; npm command names remain the stable contributor interface.           |
| `web/`                                     | Independent browser product, with its own source, API and test ownership.                                       |

Installer lifecycle helpers and their checks stay together because the launcher
stages neighboring worker scripts into a disposable test directory. E2E specs are
grouped by desktop journey; shared fixtures and harnesses retain one owner.
Standard package, Cargo, Tauri, TypeScript and Python configuration stays at its
existing package root rather than moving alongside operational scripts.

The Desktop renderer groups app shell, preferences, and typed Tauri adapters
under `renderer/app/`. Run editor session state and draft reconciliation live
together under `renderer/features/editor/session/` because Health, Upgrades,
Run and Item views share the same save transaction.

Rust's `main.rs` owns window lifecycle and command registration. The
`commands/` modules bind IPC to workspace, read, artwork and transaction
operations. `backend/` owns native session state, the fixed sidecar operation
table, bounded request execution and opaque artwork tokens. Image decoding and
response bounds live with that artwork registry. `projections/` validates
sidecar responses. `transactions/` owns the Run and MetaSave native handoff,
including separately gated synthetic recovery code.

Python's sidecar entry point owns argument registration and JSON transport.
Domain API modules own read projections and transaction orchestration. The
storage layer keeps receipt intent validation separate from the durable recovery
state machine. Web keeps browser save processing, session state, and UI within
the save-file feature. Its Run editor has a separate Run model and avatar lookup.

Generated output is separate from this source map. `.venv/` holds the local Python
environment; `node_modules/`,
`desktop/src-tauri/{target,gen}/` and `desktop/release/` hold dependencies or generated
application artifacts. `desktop/build/` also retains synthetic snapshots, frozen
backend bundles, nested checkpoint copies and recovery diagnostics. These locations
are ignored; they are not source merely because they appear in a local folder dump.
Tracked synthetic inputs under `desktop/e2e/fixtures/` remain source. The explicit
`desktop/scripts/release/` ignore exception keeps release tooling tracked while
generated `release/` output remains ignored. Use `git ls-files` for the source inventory
and `git check-ignore -v <path>` to inspect an output's governing rule.

For local editor navigation, the following workspace exclusions hide generated
trees without deleting or relocating evidence. `.vscode/` stays local and ignored;
merge these with existing preferences rather than replacing them.

```json
{
  "files.exclude": {
    ".venv": true,
    "**/node_modules": true,
    "desktop/build": true,
    "desktop/src-tauri/target": true,
    "desktop/src-tauri/gen": true,
    "desktop/test-results": true
  }
}
```

The Windows Desktop boundary is:

```text
React renderer
      |
Tauri WebView2 with scoped commands
      |
Rust admission and process supervision
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

- `desktop/renderer/` owns presentation, renderer-local theme/language preferences, and typed in-memory pending edits. It cannot read files, spawn processes, parse raw saves, or derive game mechanics.
- `desktop/src-tauri/` owns window capabilities, typed command admission, sidecar supervision, renderer-safe DTOs and opaque artwork tokens.
- `desktop/python/repo_save_editor/desktop_api/` translates the stable command protocol into Python service calls. Standard output is reserved for bounded NDJSON protocol records; commands that support streaming may emit multiple records, while diagnostics use standard error.
- `desktop/python/repo_save_editor/services/` owns editor behavior for discovery, players, upgrades, run
  data, maps, advanced discovery/refill semantics, MetaSave cosmetic ownership, and save summaries.
- `desktop/python/repo_save_editor/core/` owns encryption, schema validation, and shared save types.
- `desktop/python/repo_save_editor/storage/` owns repository access, backups, temporary validation, stale-file protection, and atomic replacement.

Tauri applies an explicit CSP and allowlisted commands to the main WebView2 window. Rust validates the request and response envelopes, and Python independently checks the game state and write preconditions.

Run-save writes (including experimental health transactions) and MetaSave cosmetic
writes repeat the authoritative Python game-status check after encrypted staging,
reopen verification and the final stale-source read, immediately before repository
replacement. Running, unknown or failed inspection aborts replacement, preserves the
original encrypted bytes and exact backup, and cleans staging through the existing
failure path. A prepared health transaction retains its pending receipt and intent;
reconciliation after its owner exits classifies the unchanged source without replay.
This is a sampled process check: the game can still start after the final observation
and before replacement. It does not provide a game-launch interlock or resolve
filesystem namespace and uncooperating-writer races.

Updated Python run-save and MetaSave mutation entry points acquire the existing
per-save OS lock before reading the mutation snapshot; they hold it through pending
inspection, validation, replacement and result construction. Health preparation,
writing and reconciliation use that same lock. A health writer already holding the
lock does not reacquire it inside `save_changes`. Contention fails immediately;
process exit releases the OS lock, while pending receipts still require reconciliation.

This coordination covers participating backends. Older Electron backends and
other tools can write outside RepoDitor's lock. Ordinary read-only builds,
public-editing builds, and test-only builds have distinct native capabilities.
Public writing additionally requires the [reviewed game compatibility evidence](../maintenance/game-update-capabilities.md#tauri-editing-across-steam-patches).
Synthetic transactions require the gated test commands and an isolated fixture root.
The lock also does not stabilize filesystem ancestry: current pathname-based
parent validation leaves directory movement and reparse substitution unresolved.

## Native Desktop host

The Tauri host under `desktop/src-tauri/` is the only Desktop runtime built
from this tree. The portable configuration exposes reads. Private candidates
add session-scoped writes through separately qualified native capabilities
and a verified profile backup.

The Rust source root keeps application bootstrap and typed command registration in
`main.rs`, with public error mapping in `error.rs`. `backend/` owns fixed sidecar
operations, request admission and process supervision. Private unit-test modules
load their implementations from `tests/unit/`, mirroring their owning modules;
`entry.rs` contains bootstrap tests. Process tests reuse the
`tests/sidecar_fixture.rs` executable fixture. `projections/` owns
the validated Python DTOs returned to React. `synthetic/` owns transaction and
recovery transport and is compiled only with `synthetic-health-recovery`; its
existing command permissions and runtime test-root checks still apply.

Rust translates the existing Python discovery DTO and validates required fields,
dates, JavaScript-safe numbers, save counts, session fingerprints, response ID
identity, required visual keys and root/game consistency before returning the
existing renderer contracts. Save opening accepts only the existing opaque ID
format; Python re-discovers and loads that ID through its unchanged save-domain
service. Rust performs no decryption or save interpretation. Commands accept fixed operations and opaque identities.

Overview is a read-only session snapshot. Reopening reads current bytes and a
fresh fingerprint, including changes made after discovery; it does not apply a
write-only stale-file rule to reads. Players uses Python's existing `players-list`
service and the numeric-ID, nonempty-name and JavaScript-safe health DTO
contract. Duplicate IDs are rejected; Python's dictionary projection produces
unique IDs. Health may exceed maximum health in an existing save;
the shared progress display clamps it without altering the saved value.
The existing Players hook accepts an injected list method, loads once per open
workspace and retains selection across tabs. Retry and reopening read current
bytes. Ordinary production Health remains read-only. Optional Steam avatars use
the dedicated `players_avatar` read command and Python's selected-save membership
and SteamID64 validation. Native boundaries validate two
HTTPS Steam CDN hosts; Tauri permits those hosts for images only, with no generic
network command or broader connection policy.

Preparation starts one optional lookup for the first player returned by the
Players projection. The selected-player hook reuses it during entry. Steam
responses do not gate opening the workspace.

The shared avatar hook loads only the selected player. It serializes lookups, caches by player within
the open save session, and permits at most one automatic retry for a classified
transient result. A valid Retry-After is bounded to 30–300 seconds; an absent or
invalid value uses 60 seconds, while an explicit larger delay stops automatic
lookups for that workspace. Private/unavailable profiles remain at initials.
Selection changes remove old retry timers, session changes discard late results,
and closing cancels scheduled retries. An already-started lookup remains bounded
by the existing backend process deadline. No profile data or URL is needed in logs.

Upgrades calls Python's unchanged `upgrades-list` service. Save dictionaries define
membership; Rust validates the existing bounded prefix keys, labels, presentation
source enum, nullable nonnegative gameplay caps and JavaScript-safe per-player
values. Stored values above presentation caps or the editor's Int32 write bound
remain visible. Upgrade keys and per-upgrade player IDs must be unique, and each
upgrade must reference the same player-ID set, as Python's projection guarantees.
An explicit list read uses current save bytes. Background preparation requires
the fingerprint of the opened snapshot. Reopening refreshes the workspace and
selection after external changes.
Players and Upgrades share the selected-player state. The injected Upgrades hook
coalesces overlapping reads and ignores late results after unmount. The shared
view renders
read-only text fields with keyboard focus/copying and no mutation handlers,
pending edits or revert actions. Validated `iconKey` metadata is discarded;
the native host registers its own opaque upgrade artwork tokens. Missing artwork
retains the Phosphor fallback. In an admitted `synthetic-health-ui` fixture,
the native binding reuses the existing numeric inputs for per-player drafts,
pending review, field Revert and global Revert. Drafts survive section/player
navigation. An explicit Save persists the complete pending set through Python's
typed mutation and encrypted repository pipeline, including Health, Run and eligible
Item refills when present. Invalid inputs and batches exceeding the durable-intent
budget block Save. Unsubmitted drafts are discarded
on workspace close; submitted intent survives in the receipt. Busy/conflicting
recovery disables editing. Read-loading, sanitized error/retry and empty states
remain available. The canonical upgrade snapshot supersedes older pending reads
and refreshes values while retaining optional presentation metadata. The separate
test-only `test_upgrades_write` command adds no production mutation permission.
Tauri shows indeterminate progress while the save-open read is pending. It then
prepares Players, Upgrades, Run, Items and Maps through the existing read commands,
with one outstanding projection on the shared native domain worker. The panel
counts terminal results and identifies unavailable projections separately. The
save-derived results must match the opened fingerprint, and admission rereads
the save before publishing the session snapshot. Workspace hooks consume these
results on first visit. A projection that omits its source fingerprint blocks
entry with a preview verification error. A different valid fingerprint reports
a change to the save. Other failed projections retain their localized retry states.
Cancel discards the snapshot and stops submitting reads. A later open waits for
the current bounded read to drain before starting.

Artwork preparation runs after the five projection reads. The progress bar
keeps the completed data segments and fills the artwork segments from checked
results across all three domains. Tauri prepares the required Upgrade textures,
up to 64 distinct regular Item artwork tokens in default sort order, and all five previews
for the reviewed Map roster. Matching Upgrade items reuse artwork admitted for
that save and fingerprint. The shared artwork lane allows one native batch at a
time. The Item batch validates one installed Unity index and reads up to 5 MiB
of source PNGs. Item and Map batches use an 8 MiB response limit. Upgrade batches
carry up to 16 tokens in a 2 MiB frame. Every image keeps its own source and PNG
checks. The first player lookup starts after the Players read and can finish
while the editor prepares. Its network result never gates entry.
The browser decodes the prepared images. Tabs reuse the active session's artwork
and known fallbacks. Items outside the prepared set load on demand. Catalog
refresh issues new tokens and later reads validate their sources. Closing the
workspace clears its active artwork. Returning focus checks the installed
source proof for a prepared session and clears artwork if that proof changed.

Tauri retains up to two complete preparations in memory, bounded to 16 MiB of data URL
characters. Reopening reads the save and all five projections again. The native
Maps read optionally supplies a proof of the reviewed Steam installation and
every input under its data directory because an Upgrade texture or mesh can
reference a nested stream. A cold preparation verifies that proof again before
retaining results. Same-session reuse requires a matching save fingerprint,
source proof, and artwork roster. It binds images to newly issued native tokens.
The proof uses file identity and Windows change times. Reparse points, failures
and directory rosters beyond 2,048 entries disable reuse. The persistent editor
cache can restore images after a process restart with fresh source validation.
The persistent Cosmetics cache has a separate key scheme, scope and storage budget.
Unsupported artwork settles to its local fallback. A token, memory, response
or 45-second preparation limit, or a failed artwork request, leaves an explicit
per-workspace count and reason. The user can cancel or choose to continue with
those previews deferred. Browsing can retry them on demand. The final save
fingerprint check runs before entry in either case. Cosmetics begins in its
own workspace.
Game status retains the
distinct `unknown` state. The existing startup/focus/retry hook and safety modal
block workspace interaction while status is running, unknown or initially
unchecked. Native close cancels outstanding backend work.

Native upgrade artwork uses `upgrade_artwork_get` and `upgrade_artwork_cancel`,
never a file protocol or renderer path. A successful save-open scopes the registry;
each upgrade-list refresh binds at most 16 random tokens to its exact save
fingerprint and keys. Workspace close, new opens and list revisions cancel old work and revoke
old tokens. Python independently validates save membership/fingerprint and
installed-game admission, then reuses the existing upgrade decoder. Its path-free
response contains a bounded PNG and a revision incorporating source identity and
PNG bytes. Rust validates the key, revision, base64, PNG structure/CRC and pixels
using the already locked PNG library before returning a PNG data URL.

One independent, cancellable backend lane has the existing 30-second deadline
and 2 MiB stdout bound. Each PNG is at most 1 MiB, each dimension at most 2048,
and total pixels at most 1,048,576. Upgrades, Maps, and Items group up to four
queued tokens from the same save or catalog revision. The
sidecar admits the sources once per group, then validates and returns each image
separately. Item reads resolve only the reviewed Item mapping and leave the
Cosmetics catalog untouched.
A missing image falls back without hiding valid neighbors. A valid image that
exceeds the remaining response budget uses the single-image read. The renderer
deduplicates in-flight tokens,
bounds the queue and cancels abandoned work without delaying save/status
lanes. Validated installed revisions and artwork identities bind the persistent editor cache.
After save reconciliation is acknowledged, the workspace refreshes only tokens,
preserving canonical values and selection. Installed artwork availability grants no save-write capability.

Run invokes the unchanged Python `run-get` service through the same opaque save
ID resolution. Rust validates the DTO's known stat keys, uniqueness, nonempty
labels, signed JavaScript-safe integer values and one-based level minimum of 1.
The stat list may be a subset or empty; read values are not constrained to the
editor's Int32 write bounds. Resume value/options must be nonempty, unique and
include the observed value; Rust has no location catalog or save-domain rules.
The injected Run hook coalesces reads and discards late results on unmount. The
shared view supplies numeric editors and a location selector in authorized sessions. Run renders copyable read-only text fields without pending/revert/save controls
in ordinary builds. Explicitly admitted synthetic UI builds reuse the same view
for durable Run drafts, review, Save and Revert. Canonical snapshots supersede
older in-flight Run reads. Values outside JavaScript's exact integer range never
cross the typed projection; the synthetic Run error explains this read-only limit.

Items calls Python's existing `advanced-get` service. Rust validates all six unique
domain keys, evidence enums, nullable nonnegative counts, boolean capabilities,
canonical item-key/name/instance relationships, unique identities, signed safe
stored charge and charge/recharge consistency. Counts remain nonnegative; stored
charge follows the signed read contract without applying write bounds.
The 2 MiB frame bounds every item array and string; the six-domain membership and
existing icon/upgrade-key limits provide additional structural/metadata bounds.
Rust does not classify items, infer game evidence or maintain a recharge evidence
store. Private recharge evidence, raw fields and internal artwork keys are discarded. The shared view preserves
grouping, search, filter/sort, charge states, skeletons and failures. Ordinary native passes
no mutation handlers: refill/revert/pending/save controls stay absent even when
the retained backend capability reports support.

The host issues opaque Item tokens per distinct regular Item type in the bounded
Items projection. Tokens are scoped to the opened save and the projection's
fingerprint. A refresh replaces only the Item registry and opening or closing a
workspace revokes both artwork scopes. Visible Item cards request images through
the shared artwork lane. Python checks exact save membership and resolves the
image through the reviewed installed baked-artwork mapping and source watches.
Rust checks PNG dimensions and pixels and encodes the Item image again before
returning a data URL. Missing images use the existing fallback. The projection
size bounds the Item registry independently of the 16-token Upgrade budget.

Maps calls Python's existing `maps-list` service without renderer arguments or
Rust discovery logic. Rust validates success/error framing, boolean availability,
catalog-path consistency, at most 128 maps, unique internal identities (64 UTF-16
units, no separators/control characters), display labels (128 UTF-16 units, no
control characters), boolean known-label flags and nullable/optional lowercase
SHA-256 artwork revisions. Unavailable results require a null path and empty roster;
available-empty catalogs remain distinct. Unknown valid map families are retained.
Artwork metadata is discarded and icon tokens are always null. The existing Maps
view and injected hook preserve cards, layout, skeletons, refresh data, translated
errors and superseded/unmounted response handling. Map artwork uses a separate read-only token and grants no map-control authority.

Cosmetics is a separate global workspace, available without selecting or opening a
Run save. Its fixed `cosmetics_get` command accepts no renderer path or save ID and
delegates to Python's existing `cosmetics-get`. Rust validates the fingerprint,
JavaScript-safe signed IDs/metadata, nonnegative counts, unique identities, known
roster ordering, unknown-owned roster agreement, state/count/capability consistency,
required removal reasons and optional icon keys. Eligibility validation consumes
the [existing frozen capability evidence](../../tools/capabilities/evidence/cosmetics.v2.json)
and the aligned Python and Web snapshots. The host does not infer authority from a
catalog size or maintain another catalog. Tests compare that evidence with both
generated consumers. Unknown IDs, signed metadata and eligible-but-removal-blocked
entries retain the established semantics. Eligible icons receive opaque native tokens, and private MetaSave fields are discarded.

Cosmetic presentation can reuse the existing Unity 6 catalog reader even when the
build has no artwork approval. The fallback rechecks Steam provenance and bounded
top-level source identities before and after each uncached read; it never reuses
the historical cache for a newly recognized build. Display metadata does not grant
write authority. Legacy Cosmetics writes use a separate catalog loader restricted
to the evidence-backed builds, and revalidate that catalog before the final game
check. Read projections may explicitly deny eligibility for known IDs; the native
boundary rejects eligibility outside the frozen proven set.
Build `26407089` has readable metadata and independently reviewed artwork, but no
Cosmetics mutation approval.
Cosmetic, map and upgrade artwork retain their independent build/assembly checks.
Preset clearing has its own required boolean capability, independent of ownership
eligibility. An approved build may clear supported presets without eligible owned
IDs; an unapproved build or recovery-only MetaSave state cannot stage that action.

The ordinary native read hook coalesces refresh clicks, ignores unmounted/superseded results
and reloads on workspace entry or game-safety recovery. A superseding entry waits
for the admitted read to release before starting one fresh read. Its composition reuses
the Cosmetics summary/catalog with null mutation handlers. Search, filters, sorting,
metadata and counters remain available; ownership/preset/pending/revert/save controls
are omitted. The editable hook, artwork preparation and pending-write workspace are
available only to admitted edit sessions. The shared
game-safety boundary also covers global Cosmetics, including when no Run save is open.

The local main-window capability grants those read commands plus `players_avatar`.
CSP and
navigation constrain the bundled page; new windows are denied. The preview has
its own application identifier/profile and does not migrate Electron data.

### Synthetic MetaSave transactions

The existing synthetic UI feature and test-only permission configuration also admit
fixed `test_meta_state`, `test_meta_write` and `test_meta_recover` commands. Ordinary
artifacts compile none of them. MetaSave opens independently of Run discovery and
uses a separate host-instance/generation session bound to its own fingerprint,
namespace and admission proof. The fixed target is
`<isolated LocalLow>/semiwork/Repo/MetaSave.es3`; both its fixture home and target
remain under the existing canonical recovery checkpoint fence. No renderer path,
Run token or generic backend command can authorize it.

Fresh mutations require the exact source-pinned synthetic catalog fixture, not
presentation capabilities. The reviewed fixture manifest lives as immutable bytes
in `services/cosmetics/synthetic_fixture.py`; Python verifies its literal SHA-256,
Steam provenance, bounded source hashes and parsed ordered metadata/target vector.
Rust embeds those same bytes only in its synthetic module and validates the proof
against its own pin. Rust's build hashes the embedded bytes independently; the
Python packaging prerequisite checks the Python digest and both source pins.
Changing fixture files or supplying another expected manifest cannot change trust.
This deliberately artificial 28-entry fixture is not installed-game approval.
Real cosmetic semantics retain the separate 557-ID evidence for Steam build
`26294889`; no other installed build is inferred safe and production remains read-only.

Supported intents are selected-ID unlock, unlock remaining, guarded lock all, and
paired preset clearing. One fixed action is saved at a time. Selected IDs must be
unique, explicitly eligible and within both the 512-entry and 2 KiB intent caps;
the full receipt retains the existing 4 KiB cap. Unknown ownership IDs and unrelated plaintext
bytes, including numeric lexemes and ES3 wrapper metadata, are preserved. Preset
clearing empties both existing slot arrays without changing outer lengths or
equipment. Any eligible owned equipment/preset reference blocks the whole lock-all
action. Equip, preset editing and arbitrary ownership/inventory mutations are absent.

Schema 8 binds only MetaSave; Run schemas 1–7 remain unchanged and cannot authorize
this endpoint. Existing basename-derived locks, backups, staging and receipts are
reused with `MetaSave.es3` names. Preparation and writing compare the entire reserved
intent across subprocesses. After backup, staged verification and the last stale
comparison, the final callback revalidates catalog admission, checks authoritative
game-stopped status, then returns directly to protected replacement. There is no
catalog scan after that status check. The existing post-check game-start race and
old noncooperating-binary limitation remain; updated legacy Cosmetics writers
reject pending MetaSave evidence under the shared target lock.

Recovery-only tokens are separate from mutation tokens and bind the operation,
namespace and evidence. After a verified write subprocess exits, the host can issue
a one-use recovery token from its durable proof while the same session generation
is current. The renderer uses that token to reconcile and acknowledges Save only
after receiving canonical idle state. Explicit inspection renews recovery authority
after a lost response, restart, or invalid token. Read-only inspection neither
adopts nor settles receipts.
Catalog loss cannot authorize a fresh write, but validated existing evidence may
still be reconciled after canonical decoding and a second proof check under lock.
Recovery never restores save bytes or replays intent. Ambiguous, live-owner or
invalid evidence stays blocked and preserved. Exact backups are retained. The
standalone Cosmetics UI stages changes, confirms the affected action, supports
Revert, and reconciles lost responses/restarts before permitting another Save.
Optional artwork stays independent. The existing Windows safety matrix requires
the packaged MetaSave cases alongside all earlier domain regressions.

### Experimental health recovery

The normal preview remains read-only. Internal recovery commands are compiled only
with the `synthetic-health-recovery` Cargo feature and granted only by the separate
`recovery.test.conf.json` configuration. A runtime check additionally requires E2E
mode and a canonical LocalLow root inside the checkout's `build/recovery-checkpoint`.
The separate `synthetic-health-ui` feature includes the recovery feature and enables
multi-player Health, bounded upgrade-batch, Run editing and Items refill with the same
test permissions and runtime fence. Protocol-only builds keep the UI read-only and
reject Health-batch, upgrade, Run, Items and mixed writes. Default builds have no mutation
commands. No general mutation bridge or production write permission is provided.
The typed transports retain the legacy one-player Health request and admit a
Health-only batch, an upgrade-only batch, a Run-only batch, an exact-instance
refill-only batch or a bounded mixed batch through the existing test-only Health
command. These requests bind the save ID, fingerprint and current native open-session token.
Closing a workspace revokes its token before discovery is shown, and reopening
issues a new generation. The synthetic UI requires this token for every Run-save
write, including the legacy single-player Health form. The protocol-only recovery
harness retains its non-workspace form. The host checks the current generation
under the same lock used by open and close, holding the lock through sidecar
process creation for both reservation and writing. A revocation leaves an
already-started writer and its independent receipt recovery intact. Python
validates player/key membership against the loaded save, exact previous values,
integer bounds, duplicate targets and operation identity; presentation metadata
never grants authority.

For the single-player and mixed fixture transports, reservation binds the encrypted source
and observed file identity. Immediately before publication the writer checks the
verified receipt, rereads the exact encrypted backup, and compares the current
source hash and file identity again. A confirmed sharing violation is reported
separately from unavailable access or identity verification. The in-process
disposable admission harness also binds its one-use confirmation to a trusted
fixture caller's verified build digest and checks that digest again during the
write. These fixtures supply no installed-game build approval. See the
[proposed consumer live-editing exception](../release-checklist.md#proposed-consumer-live-editing-exception)
for the future approval requirements and the remaining late-writer race.

Python's opt-in health transaction reuses `save_changes` and repository verification.
Before launching the mutating process, the host requires a Python-owned reservation
acknowledgement. That first process validates the typed request and persists the
pending receipt without writing save bytes. The writer claims the reservation only
after its owner exits and rechecks the source and domain constraints. Losing either
process or its response therefore cannot leave a potentially executed write without
a pending marker. A preparation failure is known to precede save mutation, while an
unverified launched writer is uncertain. Both processes share the original request's
30-second budget.

The production Run-save path prepares and publishes in one bounded sidecar. After
persisting its reservation, the child waits for a byte on its parent-owned pipe.
The host sends that byte only after rechecking the current editor generation
under the open/close lock. A closed pipe leaves the save untouched and the
reservation eligible for recovery after the child exits. Before replacing the
save, Python checks the installed build and source digests again, then verifies
the save and checks that the game is closed. Each game-process check still
enumerates processes. A separate child reconciles the receipt and returns the
canonical saved values.
An OS file lock serializes cooperating writers/recovery. Recovery also verifies the
recorded owner process has exited before cleaning its files. Windows process
creation time distinguishes a reused PID from the recorded owner; an unverifiable
process conservatively blocks cleanup. Receipt temporary filenames include their
publisher PID and creation time so interrupted recovery has the same ownership check.
A versioned pending receipt
records the original fingerprint before backup/staging, then records the verified
encrypted-output fingerprint before replacement. File identity and modification-time
evidence additionally reject external restoration of the original bytes. Receipt publication uses fsynced
files and atomic replacement. Receipt inspection accepts at most 4,096 bytes.
Before Windows publication, Python compares the expected payload plus one possible
extra byte through the retained rename handle; it requests at most 4,097 bytes and
rejects an expected payload exceeding the inspection limit. A mismatch retains the
temporary and existing transaction evidence. Filenames are derived
from a validated operation identity, never accepted from receipt content.

On Windows, mutation admission retains ordinary directory handles from the local
NTFS volume root through the save's parent, denying directory deletion/rename while
allowing writes needed by legitimate atomic replacement. Each component is opened
relative to its predecessor without following reparse points, then checked through
that actual handle. Save, lock, receipt, backup and staging operations use simple
leaf names relative to the admitted parent. Python calls `NtCreateFile` and
`NtSetInformationFile(FileRenameInformation)`; the tested Win32
`SetFileInformationByHandle(FileRenameInfo)` relative form returned error 87 despite
an SDK-verified layout. There is no pathname fallback for admitted Windows writes.
Opened files must be ordinary, non-reparse and singly linked. The staged rename
source denies additional writers/deletion through verification and replacement;
write-through file handles and explicit buffer flushes preserve publication ordering
across process termination. Physical power-loss durability requires separate evidence.

Windows schema-3/4/5/6/7/9 receipts include a fingerprint of the admitted ancestry's volume
and file IDs and admitted absolute parent name. The separate reservation, writer and recovery
processes independently acquire the namespace and require that fingerprint to match
before claiming or settling a receipt. Schema 4 durably stores an upgrade-only
intent with player IDs, exact upgrade keys, previous values and requested values.
Its compact UTF-8 intent is limited to 2,048 bytes, with at most the existing 512
typed changes; the complete receipt remains limited to 4,096 bytes, including after
fingerprints and identities. An excessive batch is rejected intact before reservation.
Schema 5 stores a Run-only intent: one to five distinct loaded-save fields,
each with exact previous/requested values. The compact intent has a 512-byte
ceiling: four fixed numeric field names with safe-integer previous values and
Int32 requested values, plus a resume field with at most 64 UTF-8 bytes of previous
label and one of two known requested labels, fit below that ceiling. This retains
the 4,096-byte receipt ceiling and existing encrypted/plaintext operation budgets.
Python checks loaded-field membership and original integer types before applying
the existing Run setters. Level is displayed one-based (1–2,147,483,648); other
requested numbers use signed Int32 bounds. A future resume value is preserved
unless explicitly changed to a known destination; forged new unknown destinations
are rejected. Old binaries cannot interpret schema 5 and must fail closed.
Canonical reconciliation confirms every owned Run draft before acknowledgement
or clearing; an unavailable or mismatched Run projection remains conflicting.
Schema 6 stores a Health-only intent with distinct existing player IDs and exact
previous/requested Health values. IDs are 1–20 ASCII digits, previous values are
nonnegative JavaScript-safe integers, and requested values are nonnegative Int32
integers that Python also checks against each player's loaded maximum Health.
The compact `{health:[...]}` intent uses the existing 2,048-byte and 512-change
budgets. A record needs at least 37 compact bytes, so the byte budget admits at
most 53 records; default receipt whitespace adds six bytes per record. With a
conservative 811-byte metadata envelope, the complete receipt stays at most 3,177
bytes, below the unchanged 4,096-byte checked ceiling. Larger metadata still fails
closed at publication. These are transaction bounds, not a claimed game player limit.
Python validates every member before publishing one reservation; the existing
writer makes one exact backup and one verified replacement for the entire batch.
Reconciliation must confirm every requested canonical Health value before
acknowledgement or draft clearing. Missing or mismatched players remain conflicting.
Schemas 1–5 retain their existing validation and recovery behavior; older readers
must reject schema 6 rather than reinterpret it as a single-player transaction.
Schema 7 stores `{refillToFull:[{saveKey,before}]}` with distinct full existing
item-instance keys and exact JavaScript-safe integer stored charges. The 2,048-byte
UTF-8 intent ceiling and existing 512-change ceiling remain fixed. A minimum record
needs 33 compact bytes, admitting no more than 60 records; four whitespace bytes
per record and the conservative 811-byte metadata envelope keep the complete
receipt at most 3,103 bytes. The checked 4,096-byte receipt ceiling still fails closed
for excessive metadata. Schemas 1–6 retain their validation and byte encoding.
A validated schema-7 or schema-9 refill intent selects the Items canonical projection.
Python independently discovers installed recharge capability during preparation
and writing, rather than accepting renderer-supplied capability or filesystem
evidence. It requires an existing item, positive recharge capability, an existing
stored-charge leaf and an exact previous-value match before admitting the fixed
refill action. The existing mutation removes only that charge leaf. Inventory,
unlinked charges, battery upgrades and other same-name instances stay intact.
The test-only `test_items_refill` command shares writer admission and deadlines
with the other domains. Canonical Items reuses the existing serializer on the
fingerprint-checked in-memory save snapshot. A requested item must be present,
positively rechargeable, absent from stored charge and classified Full before UI
acknowledgement. Missing or unsupported canonical state keeps the receipt pending.
The Items view stages per-instance or all eligible refills, supports individual
and global Revert, and rejects stale read responses after accepting canonical state.
This adds neither production permissions nor arbitrary numeric charge editing.
Schema 9 binds at least two of the four domain groups to one namespace and one
operation. Each populated group retains its original validator. The full mixed
intent is limited to 2,048 compact UTF-8 bytes and validates before reservation.
One exact backup and one staged replacement cover the full intent. Independent
reconciliation verifies every affected domain from the same fingerprint-checked
snapshot before the editor acknowledges success.
Recovery classifies authoritative bytes without replaying the intent.
The legacy health filenames/lock are shared deliberately, so unresolved Health,
Upgrade, Run and refill transactions exclude each other and ordinary cooperating writers. Matching
save bytes and leaf inode alone do
not authorize a different parent directory. Schema-1/2 receipts remain inspectable,
but Windows cannot automatically resume or acknowledge them without namespace
evidence; they stay blocked and retain their evidence for explicit reconciliation.
UNC paths, remote/unknown devices, non-NTFS volumes and reparse ancestry fail closed for mutation. Device information is queried through the admitted volume handle.
These
constraints do not expand Tauri write permissions or guarantee protection against
uncooperating old writers, privileged filesystem changes or arbitrary modification
of transaction evidence. Windows/filesystem compatibility beyond the validated
configuration remains a release validation requirement.

Recovery reads actual source and backup bytes under the lock. It distinguishes an
unexecuted request, unchanged source, applied verified output and conflicting state.
It never infers success from health alone or replays pending intent. A resolved
operation receipt is durably archived before owned temporary files are cleaned and
the pending marker is removed, so recovery can resume after interruption and old
operation IDs cannot execute again. Even a verified write response retains its
pending marker until explicit reconciliation, covering response loss after receipt
finalization. In UI mode, reconciliation retains the pending marker until a separate
acknowledgement after canonical projection. Acknowledgement rechecks disk evidence
before removing the marker. Malformed receipts, damaged required backups,
links, unreadable metadata or external changes fail closed. Backups are never automatically deleted.
Unresolved receipts block new health requests and ordinary Run-save writes. Updated
ordinary writers share the transaction lock and retain their existing validation,
backup and encrypted-staging pipeline.

Desktop Python save processing uses provisional engineering ceilings: **32 MiB
encrypted and 128 MiB plaintext JSON per save**, with **64 MiB encrypted and
256 MiB plaintext per operation**. These are selected resource budgets, not measured
limits of legitimate R.E.P.O. saves. Large legitimate saves may be unsupported;
compatibility expansion requires representative authorized metadata and resource
measurements, including long-running and large-player-state cases. This policy
does not authorize production writes or change the browser's separate resource policy.

An operation is one desktop command or outer `save_operation()` library context;
nested reads, edits, staging verification and recovery share it. Separate reservation,
writer and recovery subprocesses each enforce their own operation budget. Aggregates
count distinct immutable payloads by SHA-256: exact source rereads, exact backups
and repeated JSON validation share an entry. Generated output also counts before
transaction preparation or backup creation. This bounds the set of payloads being
processed rather than cumulative I/O across the fixed verification passes. Counting
every reread as a new input would reject a large transaction after its receipt or
backup had already been created. Fingerprints used for resource accounting do not
replace filesystem identities, source-byte comparisons or mutation authorization.

Run, MetaSave, backup and recovery reads check the opened object's size, then cap
actual reads at the encrypted limit plus one byte to detect growth. Recovery hashes
in bounded chunks and preflights current, backup and staged bytes before adopting
or settling receipts or deleting temporary evidence. Canonical recovery additionally
preflights decoding. Size failures retain original bytes and recovery evidence and
return sanitized `save_unsupported` errors; a failure after staging retains the
staging file for explicit recovery. Existing receipt-size bounds remain separate.

ES3 uses AES-CBC without decompression, so admitted encrypted input already limits
raw decrypted output to less than 32 MiB. The explicit plaintext limits are enforced
before UTF-8 decoding and JSON parsing, and on edited output before encryption.
Decryption, standard JSON parsing/serialization and preservation of raw JSON spans
still materialize buffers and object graphs; these byte budgets are **not streaming
JSON, a strict process-memory limit, or a measured peak-RSS guarantee**. Multiple
bounded cipher buffers, Unicode strings, parsed objects, deep copies and serializer
output coexist. Source-free library encryption accepts caller-owned Python objects;
its standard serializer materializes output before checking the plaintext ceiling.
Malformed and excessively nested JSON is rejected without exposing plaintext.

Before a whole-document overwrite, Python validates numeric literals in the original
encrypted snapshot against their existing JSON encoder representation using exact
decimal comparison. Values that would round, overflow or underflow, non-finite
constants, signed integer zero and duplicate object fields fail before transaction
preparation or backup creation in that writer. Ordinary integer/float domain types
stay unchanged. Numeric values are preserved; whitespace, exponent spelling and
decimal scale may normalize with the existing whole-document serializer. The check
does not turn a source-free `encrypt_save` call into a lossless parser/serializer.
The existing cosmetic encoder preserves untouched plaintext spans and remains able
to retain high-precision values outside its selected integer-array edits.

An unsupported high-precision Run save remains readable, but whole-document editing
fails closed rather than rounding unrelated values. A reservation created by the
separate preparation process remains pending when its writer rejects this input;
recovery can classify the exact unchanged source without replaying the edit.
Read-only parsed-object equality is not evidence of original numeric preservation.
Supporting edits to such saves would require a separately validated lossless
representation or targeted Run-save serializer. Game-build compatibility remains
a production gate even for inputs admitted by this numeric check.

The experimental native write uses the existing bounded domain worker. Known
pre-execution rejection stays rejected; any launched write with an unverified
completion is explicitly uncertain and needs Python reconciliation. Recovery
failures remain unresolved. The existing close cancellation, 30-second deadline,
stream limits and Job Object cleanup remain enabled, and game status retains its
separate bounded lane. Fault injection lives only in the E2E sidecar, not the product
transaction. Tests use synthetic encrypted saves.

React stages Health, upgrade or Run drafts in memory and reuses the existing
Players/Upgrades controls and Save/Revert presentation. Before mutation, Python's
health reservation (schema 3 on Windows,
schema 2 elsewhere when intent is requested) durably binds its nonce to the player ID,
requested health and previous health; schema-1
protocol receipts remain readable without invented intent. The pending receipt
beside the authorized save is the durable owner. Native state discovery reads only
that fixed receipt namespace, validates evidence and returns bounded DTOs; React
has no transaction journal or filesystem access. Invalid or unreadable state blocks
editing. A busy native transaction permits only bounded read-only state polling.

Health batches persist their full schema-6 intent before writer handoff. The legacy
single-player reservation remains readable. Individual Revert removes only that
player's draft; Revert all removes the Health set without writing save bytes.
Renderer reload or application restart restores pending values and the first player's
selection from the receipt. Uncertain writes require an explicit Reconcile action;
neither discovery nor reconciliation replays the edit. Applied reconciliation returns
session, player and upgrade DTOs from one fingerprint-checked Python snapshot. The
UI verifies every owned proposed value against that projection before acknowledgement
and clears only that operation's confirmed drafts. Unchanged reconciliation retains
intent and requires a new explicit
Save with a new nonce or Revert. A draft belonging to another operation is retained
when that operation is reconciled. Conflicts remain blocked. A verified backup
indicator appears only after positive recovery evidence. Python archives and cleans
only operation-owned files; backups and unrelated temporary files remain intact.

In the default host, each request launches the fixed frozen backend directly, without a system-Python
fallback. Admission allows one outstanding request per read operation, at most
nine total; repeated calls to an occupied operation fail immediately. Eight ordinary
domain operations share one worker mutex. Game status bypasses that mutex; its
existing admission permit bounds the separate lane to one active or admitted
request, with no status backlog or additional mutex/pool. At most one domain child
and one status child can execute concurrently, each owning its own Job Object.
Each 30-second deadline includes dispatch and domain-queue time. The historical Electron implementation used
concurrent process calls. Expired/closing requests fail before spawning. Queued requests also
observe cancellation. Every child retains the 2 MiB stdout limit, 64 KiB stderr
limit and bounded pipe queue. Public failures use allowlisted codes and sanitized
messages. Translated UI errors retain their stable codes. A Windows
kill-on-close Job Object owns the assigned process tree;
normal close signals shared cancellation to both lanes and rejects new admission.
The window stays open until the existing request permits are released after child
reaping and pipe-reader joins. One conditional close waiter observes those flags;
repeated close events do not add waiters or locks. Process/pipe handles are reaped on errors
and timeouts. Assignment follows creation of the trusted bundled executable;
this does not claim containment of hostile code substituted by a compromised
local account before job assignment.

Cancel Opening revokes the pending native save read. Change Save revokes the
closed session and its in-flight Items reads. Both release the worker after
process-tree cleanup. Canceled reads return `process_cancelled` through native IPC.

Game-status inspection does not wait for an expensive Maps/Items/domain read. The
renderer adapter coalesces overlapping status checks while direct duplicate native
requests are rejected. The existing safety hook still marks a recheck busy and
retains the previous resolved status until the new result; unknown/failed results
then block interaction. This leaves a freshness window during the status process
itself and between checks. Native exposes no write command. Future mutation work
must retain Python's authoritative `require_game_closed` check immediately around
real writes; cached renderer status is never write authorization.

The portable preview staging command copies the whole PyInstaller `--onedir`
tree into `build/tauri-portable/backend`. The host build embeds a versioned Windows
resource derived from its compiled synthetic feature flags and packaged/development
mode. Staging reads that resource as data, without executing the host, and admits
only the read-only variant.
Unmarked older hosts require rebuilding. The frozen backend must contain the
expected startup hooks and production entry-point identity; a fault-injection
entry point is rejected. Staging validates copied executable snapshots before
replacing its output, verifies the published copies against those hashes and
records host/backend executable hashes. These checks do
not authenticate every mutable dependency or replace package signing. Synthetic
commands still require their compile feature, Tauri ACL and existing runtime fence.
No production write authority is added.

Environment discovery exposes `healthWriteCompatibility` separately from structural
game detection. Authoritative Steam provenance is reread and matched to the
discovered installation. A missing, unreadable, malformed or changed identity is
`unknown`; an identified build is `unsupported` for Tauri Player Health writes.
`supported` is always false: neither historical Recharge build `23363152` nor the
cosmetic approval for build `26294889` establishes this write capability. The Rust
boundary rejects a positive or inconsistent admission claim; older sidecars missing
this metadata default to unknown. Read-only discovery remains available. A future
production command must enforce independently reviewed, domain-specific compatibility
at the Python mutation boundary; cached discovery metadata cannot authorize it.

Old Electron/portable binaries do not participate in the new Python lock. Sharing a
writable profile with one is unsupported. The current enforceable boundary is that
production Tauri artifacts cannot write at all. A future cutover must establish
exclusive access before enabling writes; process-name checks, uninstalling one known
copy or a user confirmation cannot prove that an arbitrary old binary cannot run.
See the [operator recovery and cutover procedure](../release-checklist.md#tauri-save-recovery-and-cutover)
for its enforcement prerequisites and unsupported cases.

The required Windows Tauri safety job runs the relevant full Python owner/API
suites, including namespace, cooperating-writer, final-game-state, receipt and
numeric regressions. It runs Rust default/all-feature tests, builds separate
ordinary/synthetic hosts and frozen backends, and runs native permission, handoff,
final-state and process-recovery checks. Missing required cases or skipped cases
fail the gate. Native fixtures share immutable backend bundles while saves and
profiles remain isolated. The workflow's aggregate quality gate requires success;
Hosted WebView2/native behavior
still requires actual CI confirmation for a given change.

The native startup diagnostic retains its 5,000 ms subprocess deadline and 16 KiB
output cap. Its window responsiveness query uses `SendMessageTimeout(WM_NULL)`
with a 1,000 ms allowance, leaving time for the remaining inspection and JSON
emission. The .NET Framework [`Process.Responding` implementation](https://github.com/microsoft/referencesource/blob/main/System/services/monitoring/system/diagnosticts/Process.cs)
can itself wait 5,000 ms, so calling that property inside the same outer deadline
can discard an otherwise complete diagnostic. A hung window now produces an
explicit false responsiveness result and its native error code. The ordinary
startup control requires a present, responding window as well as successful CDP,
the Tauri bridge and the synthetic-write/recovery command denials.

Fixed, numeric timing checkpoints are flushed to stderr after each inspection
phase, then attached to the startup record even if the subprocess is killed before
emitting JSON. They distinguish launch-to-script time from registry/runtime,
interop compilation, desktop, process/CIM, descendant, policy, response and JSON
work. No environment dump or unrestricted command lines are added. Process
inspection requires an accessible synchronization handle and a zero-wait liveness
check; access denial fails the probe, while an exited process is reported absent.
The diagnostic leaves .NET debug mode before opening the process: framework
inspection can enable `SeDebugPrivilege` on elevated runners, which otherwise
[bypasses process ACLs](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess).
This changes only the disposable inspector's token, not the host or runner token.
Disposable responsive, hung, exited and inspection-denied fixtures exercise first
and subsequent fresh processes. Transport tests also cover malformed results,
exceptions and forced termination with partial measurements.
The Windows safety gate requires all ten transport cases to pass without skips.
The original hosted failure retained only the outer timeout, so its exact
inspection phase cannot be reconstructed retrospectively. The five-second nested
responsiveness wait is independently reproduced with an owned hung window.

Registry, CIM, compilation and other Windows APIs do not each provide an intrinsic
latency bound. They remain inside the separately killable diagnostic process;
deadline expiry forcibly terminates it and fails the control. The gate does not
prewarm CIM, retry the probe or accept `probeError`. CPU starvation, clock changes,
or an OS failure to create or terminate a process remain environmental limitations;
these checks do not establish a hard real-time guarantee under a stalled kernel.

Staging never changes production release output. See
[Desktop setup and preview checks](../../desktop/README.md#validation-and-portable-windows-package).

Installer ownership is independent of the application host. Tauri's current-user
NSIS installer bundles the verified portable host, frozen sidecar and licenses.
The installer uses NSIS progress and the WebView2 Evergreen bootstrapper. Its
registration, shortcut and install directory are distinct from the Electron
v0.2.1 package. The later Electron installer prototype's authenticated
[extraction progress contract](../installer-progress.md) is historical.
See the
[installer migration gate](../release-checklist.md#w9-b-installer-migration-acceptance).

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

Tauri serves validated local thumbnails through opaque native tokens. The
renderer receives image data without installed paths or filesystem authority.
Unavailable artwork falls back to Phosphor. Artwork and metadata caches carry
no mutation authority.

On Windows, native artwork and editor caches are scoped beneath
`%LOCALAPPDATA%\io.github.yoruxyv.repoditor.preview`. They validate current
installed source identities before reuse. The released v0.2.1 Electron
presentation data beneath `%APPDATA%\repoditor-desktop` remains a separate
legacy cache. The native host rebuilds its own derived images from installed
sources.

Tauri shows the dedicated Opening Save screen while Editor Preparation resolves
Players, Upgrades, Run, Items, Maps and artwork. The editor and its navigation
open after preparation, final source verification, the game-status check and
the initial editing-authorization check.
The active workspace retains its projections across tab changes and disposes
its drafts and editing session on close.

The native entry read batches the five projections around one validated save
snapshot. Upgrades and Items share an installed metadata lookup for their
combined roster. The host binds the returned artwork to the current save
generation after verifying the fingerprint. Initial discovery overlaps WebView
startup and the first renderer request consumes that result. Setting
`REPODITOR_PROFILE_TIMING=1` for a local profiling run emits host, sidecar and
handler durations to standard error without paths or save contents. Sidecar
commands load their own Python dependencies after dispatch. Discovery and game
status can run without importing the save-writing or artwork decoders.

The host retains one read-only projection snapshot in memory. It is reusable
only when the installed-source revision agrees before and after preparation and
a fresh open verifies the same installed-source revision and encrypted save
fingerprint. The host issues new artwork tokens for the new generation. Game
status and editing authorization are checked in parallel after preparation.
The workspace waits for both and consumes the initial authorization once.

The separate Cosmetics workspace revalidates MetaSave and installed artwork
sources on entry, refresh and game-safety recovery. A successful catalog read
issues new artwork tokens tied to the MetaSave fingerprint, cosmetic ID,
installed source and PNG file identity. Opening Cosmetics prepares the current
catalog's admitted baked images before showing the grid. Up to 64 mappings share
one sidecar call and a 2 MiB response budget. Each image is independently
validated and resized to fit within 96×96 for the 48 px grid. The renderer also
checks decoding. Images that exceed the response budget can use the single-image
path. Missing or invalid images use the ordinary fallback.

The renderer keeps up to 32 Mi base64 characters of decoded-ready image URLs for
the current catalog. It reuses an image on a fresh catalog read only when the
cosmetic ID, installed source and PNG file identity still match. Navigation away
cancels preparation and revokes the old native tokens. Run opening does not
start Cosmetics preparation.

On Windows, native Cosmetics also uses
`%LOCALAPPDATA%\io.github.yoruxyv.repoditor.preview\artwork-v1`. It contains
`catalog.bin`, up to 32 `png-NN.bin` slots, and a fixed publication lock and
temporary file. RepoDitor writes at most 8.64 MiB across these files. An NTFS
directory handle pins publication to the app-owned namespace. A publisher holds
an exclusive lock and atomically replaces a single entry. A later publisher can
remove an incomplete temporary file left by interruption.

Windows DPAPI protects the entries under the current Windows account. Catalog
entries contain canonical presentation metadata and baked identifiers. They are
bound to the reviewed Steam build and assembly and current installed-source
identities, including NTFS change times and the Unity data directory's file
names, which can affect external reference resolution. Each artwork entry binds the
cosmetic ID and current PNG identity and excludes ancillary PNG metadata.
Missing or unreadable entries fall back to
the installed sources. An initial catalog response can carry up to eight warm
thumbnails through the existing native PNG validator after checking the current
MetaSave fingerprint. The cache stores no MetaSave or transaction data. The live
MetaSave read and compatibility checks still run on entry.

#### Windows loading acceptance

These measurements record the original W7 loading acceptance before Tauri began
waiting for prepared workspaces and artwork. Both hosts launched one-shot Python
subprocesses. Electron prepared the major Run projections before showing
Overview. Tauri showed Overview after save and game-status validation, then
prepared Players and Upgrades in the background and read Run, Items and Maps on
first use. Revisits used the open session's projections.

The figures are medians in seconds, with observed ranges in parentheses. Each
build had three packaged samples on the same Windows machine, using disposable
saves, R.E.P.O. build `26407089`, and matching cache states. Workspace timings end
when the benchmark observes usable content. Thumbnail timings end when the
centered target image is visible.

| Scenario                   | Electron            | Tauri               |
| -------------------------- | ------------------- | ------------------- |
| Cold save open to Overview | 8.06 (8.06–8.61)    | 0.92 (0.91–0.92)    |
| First Upgrades visit       | 0.044 (0.044–0.047) | 0.047 (0.046–0.076) |
| First Run visit            | 0.031 (0.028–0.033) | 0.88 (0.88–0.92)    |
| First Items visit          | 0.041 (0.039–0.045) | 0.88 (0.87–0.88)    |
| First Maps visit           | 0.041 (0.040–0.042) | 0.87 (0.86–0.88)    |
| Cold Cosmetics thumbnail   | 1.65 (1.63–2.35)    | 3.15 (3.13–3.20)    |
| Warm Cosmetics thumbnail   | 0.36 (0.33–0.38)    | 1.06 (1.04–1.25)    |

Warm Cosmetics still validates MetaSave and installed sources before showing
cached artwork. A persistent Python worker is an optional future optimization.
Loading acceptance grants no production save-write authority and leaves installer
and release acceptance separate.

#### Native artwork cache developer commands

From the Windows checkout's `desktop/` directory, use the repository-local
commands below. Status reports the resolved path, schema, logical bytes of
recognized files, structural checks and lock state. It leaves source validation
to the application and counts unknown entries without opening or listing their
names.

```powershell
npm run tauri:cache:status
npm run tauri:cache:clear
npm run tauri:cache:clear -- --yes
npm run --silent tauri:cache:diagnostics
```

Close RepoDitor before clearing. The interactive command requires typing
`CLEAR`. The noninteractive invocation is intended for controlled benchmarks.
Clear takes the Windows cache admission guard and publication lock, then deletes
only the allowlisted cache files through retained NTFS directory handles. It
keeps the cache directory, publication lock and unknown entries. It refuses
active cache users, unsafe paths and unverifiable access. A partial result lists
entries already removed. Repeat the command after resolving the blocker. The
guard coordinates current Tauri hosts and sidecars across sessions of the same
Windows account. Process inspection also checks standard executable names from
earlier builds. Keep any
renamed legacy executable closed throughout the operation.

For a cold/warm walkthrough on a disposable profile, inspect and clear with the
app closed, then launch the Tauri host from a shell with diagnostics enabled.
Open Cosmetics, switch away and return, then close and restart the app with the
same isolated profile. Open Cosmetics again and export the observations.

```powershell
$env:REPODITOR_CACHE_DIAGNOSTICS = '1'
npm run dev
# In a second shell after the journey
npm run --silent tauri:cache:diagnostics
```

The opt-in recorder retains up to 48 observations in a 24 KiB file inside
`artwork-v1`. Including that file, RepoDitor publishes at most 8.66 MiB there.
The output contains fixed event codes, counts and sidecar durations. Compare
`catalog_scan` on the first visit with `catalog_hit` on a revisit or restart.
`initial_catalog` marks requests before a host's first successful catalog response.
`entry_protection_rejected` covers damaged protected data and changed binding
context because Windows does not distinguish them for these reads. Per-operation
records are best effort during contention and may add I/O to benchmark runs.
An empty log means observations are unavailable. It cannot reconstruct past
requests. Live renderer counters and click-to-image durations are unavailable
in the CLI. Exported diagnostics omit paths, identifiers, cache payloads and
credentials.

The Windows editor cache lives alongside Cosmetics at
`%LOCALAPPDATA%\io.github.yoruxyv.repoditor.preview\editor-artwork-v1`.
It holds DPAPI-protected files for Upgrade, Item and Map artwork and for
installed metadata. The artwork payload limits are 4, 8 and 8 MiB respectively, with at most 64 hashed
artwork identities per file. Each image is limited to 1 MiB before base64
encoding. Including seal overhead, the atomic publication file and the opt-in
diagnostic log, the namespace publishes at most 28.30 MiB. Artwork entries contain
validated PNGs and their source bindings or a confirmed unavailable result.
The cache contains no save contents, save identifier, player data, or paths.
An ambiguous or failed extraction is retried.

The metadata file holds up to eight requested item-type sets in 256 KiB.
Native projection reads may reuse those results after checking the installed
build, Steam manifest and both Unity file identities before and after the read.
The binding includes NTFS change time and the metadata format version. The
sidecar projects player and item-instance values from the current encrypted
save on cache misses. Warm projection reuse requires a fresh fingerprint and
source confirmation. Write admission and reconciliation use independent checks.

The sidecar checks the installed build and a bounded roster of source identities
before and after serving cached artwork. The roster includes file identity,
size, write time and NTFS change time. A change invalidates reuse for all three
categories. Missing or damaged cache files rebuild from the installed source.
The host continues to validate the response and bind it to the current session's
artwork tokens. Entry also verifies the save fingerprint after source proof.
The final Maps call can carry both checks in one sidecar launch.

The existing cache commands include the editor namespace under `editorArtwork`.
`tauri:cache:clear` clears recognized entries in both namespaces while the
application is closed. In editor diagnostics, `editor_hit` counts reused images,
`editor_unavailable_hit` counts reused fallbacks, and `editor_extracted` counts
fresh image payloads. `sourceValidationMs` measures the installed-source proof
inside the sidecar. The cache inventory reports file presence separately from
installed-source validation.

Canonical filename derivation, source reconciliation, native decoder resources and
reader isolation are documented in [installed artwork](../reverse-engineering/truck_artwork.md).

### Upgrade cache diagnostics

Run the following commands from the repository root. These diagnostics apply to
the upgrade presentation cache, not every artwork domain.

To audit the derived presentation cache after restarting RepoDitor, run:

```powershell
.\desktop\scripts\quality\check-presentation-cache.ps1
```

The read-only script compares `manifest.json` with the stored hash-named PNGs
and reports unreferenced or missing artifacts.

Upgrade presentation-cache manifest format 3 maps each dynamic upgrade key to a derived
PNG identity and the exact files used to produce it: `resources.assets`,
`globalgamemanagers`, the texture stream (normally `resources.assets.resS`), and
an independent mesh stream only when it supplied crop framing. Validation uses
their size and mtime, avoiding large-file hashing during warm startup. The admission
assembly and Steam manifest are also watched and included in the identity.

`appmanifest_3241660.acf`, Steam App ID/BuildID, the install location, and the
validated `Assembly-CSharp.dll` remain compatibility provenance rather than pixels.
Watching the manifest and assembly forces Python to revalidate that provenance
after an update, including a build-only hotfix. A watched source change is
reported as `source-changed`, followed by `source-decode-required` and
`persisted`, then `persistent-hit` on the next unchanged run. Earlier cache formats
rebuild once so they acquire the admission watches.

These are separate safety boundaries: a persistent artwork hit neither marks the
installed build as verified nor authorizes a new extraction or any save mutation.
Cold extraction requires validated Steam provenance and a reviewed assembly;
unknown build IDs additionally pass the bounded fallback described in
[game-update capabilities](../maintenance/game-update-capabilities.md#public-steam-build-monitoring).
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

The native host resolves the frozen `backend/repoditor-backend.exe` from the
owned artifact layout. Development uses `desktop/build/backend`. The portable
package includes the complete Python 3.13 onedir payload. The fixed Rust command
adapter controls the executable, arguments, size and time limits, cancellation,
and Windows process-tree cleanup.

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
adding a second host cache and its invalidation surface.

## Supported production scope

The Tauri desktop covers the supported read workflow and, in the private maintainer candidate, all five reviewed editing domains. The editor supports discovery/select/open, Overview, Players,
Upgrades, Run, Items with exact-instance refill-to-full, Cosmetics bulk ownership and paired
preset clearing, Maps,
pending edits, revert, safe writes, backups, stale-file protection, and failure states. Run saves
and MetaSave retain independent fingerprints and backups while sharing the validated encrypted
repository mechanics.

Other item mutations, arbitrary file browsing, Save As, and drag-and-drop are intentionally unsupported: discovered opaque save IDs keep filesystem access narrow, and backup-first overwrite is the only write path. Arbitrary cosmetic equipment/preset editing and token editing are also unsupported. Change save/reopen handles reloads, and the persistent pending-change bar makes the write boundary explicit.
