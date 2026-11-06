# Architecture

RepoDitor has two production user interfaces: the Windows Desktop application and the hosted
RepoDitor Web application at https://repoditor.vercel.app/. Python remains authoritative for
save-format and game behavior inside Desktop; Web is an independent browser implementation that
shares evidence-backed semantics rather than Desktop implementation code.

## Source and validation map

| Location                                      | Ownership                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `desktop/src/`                                | React presentation, typed drafts and feature orchestration; component tests stay beside their implementation.   |
| `desktop/src-tauri/src/`                      | Rust bootstrap, bounded Python process transport, validated projections and gated synthetic recovery.           |
| `desktop/python/repo_save_editor/`            | Authoritative Desktop save semantics, encryption, validation, backups and transactions.                         |
| `desktop/python/tests/`                       | Python domain, storage, protocol and synthetic integration regressions.                                         |
| `desktop/electron/`                           | Shipping Electron main/preload, IPC validation and process ownership; retained during Tauri migration.          |
| `desktop/installer/`                          | Installer host, UI, NSIS overrides and C# test fixtures; `scripts/` owns installer build and lifecycle tooling. |
| `desktop/scripts/`                            | `quality/`, `tauri/`, `packaging/` and `release/` tooling, with implementation and Node tests kept together.    |
| `desktop/e2e/electron/`, `desktop/e2e/tauri/` | Host-specific source and packaged journeys, permission boundaries and interruption/recovery tests.              |
| `desktop/e2e/`                                | Shared `support/` harnesses, tracked `fixtures/` inputs and `fixture_generators/` used by both host suites.     |
| `scripts/git-hooks/`, `.github/workflows/`    | Repository Git gates and CI orchestration; npm command names remain the stable contributor interface.           |
| `web/`                                        | Independent browser product, with its own source, API and test ownership.                                       |

Installer lifecycle helpers and their checks stay together because the launcher
stages neighboring worker scripts into a disposable test directory. E2E specs are
grouped by the host being validated; shared fixtures and harnesses retain one owner.
Standard package, Cargo, Tauri, TypeScript and Python configuration stays at its
existing package root rather than moving alongside operational scripts.

Generated output is separate from this source map. `.venv/` holds the local Python
environment; `node_modules/`, `desktop/dist/`, `desktop/dist-electron/`,
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

The diagram below describes the shipping Electron Desktop boundary.

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

This coordination covers updated participating backends only. Older deployed
Electron backends and other tools do not honor it. The currently enforced production
policy is the read-only Tauri capability set; synthetic health writes remain confined
to their test root. Production write authorization must remain blocked until old
writers are enforceably retired or isolated, or a stronger coexistence mechanism is
validated. A version warning or process-name check alone cannot enforce that policy.
The lock also does not stabilize filesystem ancestry: current pathname-based
parent validation leaves directory movement and reparse substitution unresolved.

## Experimental native host

The opt-in Windows Tauri host under `desktop/src-tauri/` exposes
`environment_detect`, `saves_open`, `players_list`, `upgrades_list`, `run_get`, `advanced_get`, `game_status` and `preview_close`. Its typed
read adapter composes the discovery adapter with save-open, player-list, upgrade-list, Run, Items and game-status
contracts, and exposes no write method. Its entry reuses discovery, save-loading,
Overview, Players, Upgrades, Run, Items, selected-save header, preferences and game-safety presentation.
Electron remains the shipping host;
its preload, IPC, save services, installer and release defaults are unchanged.

The Rust source root keeps application bootstrap and typed command registration in
`main.rs`, with public error mapping in `error.rs`. `backend/` owns fixed sidecar
operations, request admission and process supervision. Private unit-test modules
load their implementations from `tests/unit/`, mirroring their owning modules;
`entry.rs` contains bootstrap tests. Process tests reuse the unchanged
`tests/sidecar_fixture.rs` executable fixture. `projections/` owns
the validated Python DTOs returned to React. `synthetic/` owns transaction and
recovery transport and is compiled only with `synthetic-health-recovery`; its
existing command permissions and runtime test-root checks still apply.

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
view retains editable Electron controls by default; the ordinary native variant renders
read-only text fields with keyboard focus/copying and no mutation handlers,
pending edits or revert actions. Validated `iconKey` metadata is discarded and
`iconToken` is always null; the existing Phosphor fallback needs no native artwork
URL, protocol or cache authorization. In an admitted `synthetic-health-ui` fixture,
the native binding reuses the existing numeric inputs for per-player drafts,
pending review, field Revert and global Revert. Drafts survive section/player
navigation. An explicit Save persists one coherent upgrade batch through Python's
existing typed upgrade mutation and encrypted repository pipeline. Health and
upgrade drafts save separately: a mixed pending set disables Save with an
explanation, rather than silently applying a subset. Invalid inputs and batches
exceeding the durable-intent budget also block Save. Unsubmitted drafts are discarded
on workspace close; submitted intent survives in the receipt. Busy/conflicting
recovery disables editing. Read-loading, sanitized error/retry and empty states
remain available. The canonical upgrade snapshot supersedes older pending reads
and refreshes values while retaining optional presentation metadata. The separate
test-only `test_upgrades_write` command adds no production mutation permission.
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
Run renders copyable read-only text fields without pending/revert/save controls
in ordinary builds. Explicitly admitted synthetic UI builds reuse the same view
for durable Run drafts, review, Save and Revert. Canonical snapshots supersede
older in-flight Run reads. Values outside JavaScript's exact integer range never
cross the typed projection; the synthetic Run error explains this read-only limit.

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

### Experimental health recovery

The normal preview remains read-only. Internal recovery commands are compiled only
with the `synthetic-health-recovery` Cargo feature and granted only by the separate
`recovery.test.conf.json` configuration. A runtime check additionally requires E2E
mode and a canonical LocalLow root inside the checkout's `build/recovery-checkpoint`.
The separate `synthetic-health-ui` feature includes the recovery feature and enables
one existing player's health editor, bounded upgrade-batch and Run editing with the same
test permissions and runtime fence. Protocol-only builds keep the UI read-only and
reject upgrade and Run writes; default builds have no mutation
commands. No general mutation bridge or production write permission is provided.
The typed transports accept one player-health change, an upgrade-only batch or
a Run-only batch. Mixed Health/Upgrades/Run drafts block Save and identify the
groups to revert; there is no partial-save or mixed-domain protocol.
Upgrade and Run requests bind the save ID, fingerprint and current native open-session token.
Reopening a save rotates that token; stale/cross-session requests are rejected.
The host rechecks session admission between reservation and writer launch. Python
validates player/key membership against the loaded save, exact previous values,
integer bounds, duplicate targets and operation identity; presentation metadata
never grants authority.

Python's opt-in health transaction reuses `save_changes` and repository verification.
Before launching the mutating process, the host requires a Python-owned reservation
acknowledgement. That first process validates the typed request and persists the
pending receipt without writing save bytes. The writer claims the reservation only
after its owner exits and rechecks the source and domain constraints. Losing either
process or its response therefore cannot leave a potentially executed write without
a pending marker. A preparation failure is known to precede save mutation, while an
unverified launched writer is uncertain. Both processes share the original request's
30-second budget.
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

Windows schema-3/4/5 receipts include a fingerprint of the admitted ancestry's volume
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
Recovery classifies authoritative bytes without replaying the intent.
The legacy health filenames/lock are shared deliberately, so unresolved Health,
Upgrade and Run transactions exclude each other and ordinary cooperating writers. Matching
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

React stages a health edit or an upgrade batch in memory and reuses the existing
Players/Upgrades controls and Save/Revert presentation. Before mutation, Python's
health reservation (schema 3 on Windows,
schema 2 elsewhere when intent is requested) durably binds its nonce to the player ID,
requested health and previous health; schema-1
protocol receipts remain readable without invented intent. The pending receipt
beside the authorized save is the durable owner. Native state discovery reads only
that fixed receipt namespace, validates evidence and returns bounded DTOs; React
has no transaction journal or filesystem access. Invalid or unreadable state blocks
editing. A busy native transaction permits only bounded read-only state polling.

Renderer reload or application restart restores the pending value and its player
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
tree into `build/tauri-preview/backend`. The host build embeds a versioned Windows
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
it does not replace the separate Electron checks. Hosted WebView2/native behavior
still requires actual CI confirmation for a given change.

The native startup diagnostic retains its 5,000 ms subprocess deadline and 16 KiB
output cap. Its window responsiveness query uses `SendMessageTimeout(WM_NULL)`
with a 1,000 ms allowance, leaving time for the remaining inspection and JSON
emission. The .NET Framework [`Process.Responding` implementation](https://github.com/microsoft/referencesource/blob/main/System/services/monitoring/system/diagnosticts/Process.cs)
can itself wait 5,000 ms, so calling that property inside the same outer deadline
can discard an otherwise complete diagnostic. A hung window now produces an
explicit false responsiveness result and its native error code. The ordinary
startup control requires a present, responding window as well as successful CDP,
the Tauri bridge and all four synthetic-write command denials.

Fixed, numeric timing checkpoints are flushed to stderr after each inspection
phase, then attached to the startup record even if the subprocess is killed before
emitting JSON. They distinguish launch-to-script time from registry/runtime,
interop compilation, desktop, process/CIM, descendant, policy, response and JSON
work. No environment dump or unrestricted command lines are added. Process
inspection requires an accessible synchronization handle and a zero-wait liveness
check; access denial fails the probe, while an exited process is reported absent.
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
[Desktop setup and preview checks](../../desktop/README.md#optional-native-discovery-preview).

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
.\desktop\scripts\quality\check-presentation-cache.ps1
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
