# Game-update capability maintenance

RepoDitor generates Web capability snapshots from reviewed evidence. The committed records
cover the exact identities, their historical parser/oracle checks, and the latest Desktop review.

- `tools/capabilities/evidence/recharge.v1.json` records exact installed `ItemBattery`
  classifications, parser fingerprints, build metadata, and the independent UnityPy oracle.
- `tools/capabilities/evidence/cosmetics.v1.json` records exact installed
  `MetaManager.cosmeticAssets` vector indices, parser fingerprints, the normalized managed-code
  ownership/index contract, and historical parity with both ownership lists of an approved
  game-generated full-unlock MetaSave. The source save remains private and outside the repository.

- `tools/capabilities/evidence/cosmetics.v2.json` covers the expanded 557-ID catalog;
  the historical V1 record remains separate.
- `tools/capabilities/evidence/web-desktop-review.v1.json` binds both Web snapshots to the
  accepted Desktop v0.3.2 evidence for Steam builds `26732417` and `26813769`.

`npm run capabilities:update` regenerates the Web snapshots and the Desktop Python cosmetic
policy. Edit reviewed evidence through the approval workflow.
Generation preserves exact non-contiguous IDs and produces deterministic output.

## Tauri editing across Steam patches

Production uses the [reviewed Desktop fingerprints](../../desktop/python/repo_save_editor/services/game/write_evidence.py)
for R.E.P.O. v0.5.2 (Steam build `26732417`) and v0.5.3 (Steam build
`26813769`). The v0.5.2 private preview established the five editing domains.
For v0.5.3, the maintainer confirmed gameplay and normal resave/reload for the
private-preview checklist:

- Health editing.
- A Tumble Climb upgrade edit.
- Run value edits and both Normal and Shop resume.
- A Recharge on an eligible depleted item instance.
- A supported Cosmetics ownership change and Clear All Presets.

The report did not enumerate each Run field, identify the recharged item type,
or distinguish Unlock from Lock. Approval for the existing operation families
also relies on the earlier v0.5.2 acceptance and the verified v0.5.3 sources.
All eight ES3 and runtime hashes match v0.5.2. The 29 reviewed Recharge
identities and the full 557-entry Cosmetics catalog digest also match.
`Assembly-CSharp.dll`, `globalgamemanagers`, and the pinned Item and Cosmetics
assets have v0.5.3 hashes. The recharge identities, catalog digest, and
mutation validators are shared across the two approved revisions.

Approval carries to a new Steam BuildID when the installation has valid Steam
provenance and the SHA-256 pins for the required domains still match the
reviewed revision selected by the gameplay sources.
The live BuildID remains part of session checks. Reopen the editor and the save
after a Steam update.

| Domain                           | Evidence carried forward                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All edits                        | The game executable, Unity player, `Assembly-CSharp.dll`, and `globalgamemanagers`, plus the ES3 serializer in `Assembly-CSharp-firstpass.dll` and the managed and Mono runtime files it uses. These files cover the game code, ES3 field layout, and crypto implementation reviewed for the private build. |
| Health, Upgrades, Run and Resume | The reviewed player IDs and fields, upgrade keys and limits, Run field types, and Normal/Shop resume behavior are covered by the shared pins. Existing per-save checks still constrain each edit.                                                                                                           |
| Item Recharge                    | The shared pins plus `resources.assets` and `globalgamemanagers.assets`, which establish the exact qualified `ItemBattery` identities. Each save still has to contain the exact eligible instance and previous charge.                                                                                      |
| Cosmetics                        | The shared pins plus `level0`, `globalgamemanagers.assets`, and `sharedassets0.assets`, with the reviewed 557-entry catalog digest. Ownership, equipment, and preset checks still apply to the target MetaSave.                                                                                             |

A manifest-only update or a baked-icon change outside the pinned files can keep
editing enabled with the existing binary. A changed Item or Cosmetics source
blocks the affected domain. A changed shared pin blocks all five domains, including
a change in an ES3 or crypto dependency. The pins cover whole files, so an
unrelated change inside one of those files also requires review. Missing evidence
cannot carry an older exact-build approval forward.

Review changed sources against the existing save-field, encryption, serializer, and
gameplay contracts. Confirm newly affected operations in the game, including
normal resave and reload where applicable, before replacing the frozen evidence.
Parsing, artwork availability, and synthetic round trips alone do not grant write
approval. Production continues to enforce per-edit backups, fingerprints,
receipts, and closed-game checks. Full-profile protection is used by the
private acceptance build.

## Routine checks

### Browser regression and deployment

`Compatibility / Desktop-Web Alignment` checks the approved review, underlying parser/oracle
records, and generated snapshots. Changes to the capability tools and Desktop write evidence
also trigger Web quality, Playwright, and Lighthouse validation.

The Web workflow compares the public deployment's capability signature with the checked-out
snapshots once a day. After an authorized deploy, run **Web → Run workflow** on `main` with
`production_smoke` selected, or run `npm run test:production` from `web/`. The signature checks
the deployed compatibility data. Review UI-only changes through the normal deployment check.

### Public Steam build monitoring

The `Steam public build monitoring` workflow checks app `3241660` daily at
03:17 UTC and supports manual dispatch. It compares the public BuildID to the
reviewed write builds in the Web/Desktop record (`26732417` and `26813769`).
Synthetic monitor tests run in Compatibility without contacting Steam.
GitHub runs schedules on the default branch and can delay them or disable them
after repository inactivity. [GitHub Actions schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The source is Valve SteamCMD's anonymous `app_info_print 3241660` metadata, using
only the exact `depots.branches.public.buildid` field. The official
[`UpToDateCheck` interface](https://partner.steamgames.com/doc/webapi/ISteamApps#UpToDateCheck)
does not document `required_version` as this public branch identity; the bounded
R.E.P.O. probe returned `success:false`. It is not used as a substitute. Valve
documents `app_info_print` in its [SteamCMD tooling guide](https://partner.steamgames.com/doc/sdk/uploading).

Each observation uses a fresh SteamCMD directory/cache and anonymous login, with
no `app_update`, Steam credentials or game download. The client is downloaded
from Valve's HTTPS CDN, can update itself, and runs under a 180-second deadline.
Console output, metadata bytes, token counts and nesting are bounded. Malformed,
ambiguous, wrong-app, non-public, truncated or unavailable metadata is UNKNOWN:
the monitor job fails visibly and cannot notify a new build. No third-party
metadata service is used. Steam availability and future client output changes
remain external limitations.

The monitor also reports the independently reviewed artwork build `26407089`.
A regression requires this baseline to match the latest admitted Unity 6 artwork
build. On `main`, an unreviewed public build creates or updates one bot-owned
compatibility review issue. Save and artwork approvals still go through their
existing evidence checks. Repeated observations of the same build do not comment,
reopen or rewrite the issue. A later build updates its generated block, preserves human
notes outside that block and reopens the review. Ambiguous issue ownership or an
incomplete bounded history scan fails closed. Notification has no automatic
retry and at most three issue-list requests plus one write; HTTPS response sizes
and socket waits are bounded, and the whole notification job has a three-minute
deadline. Only that job receives `issues: write`.

To inspect captured metadata without notification:

```powershell
uv run --locked python -m tools.capabilities.steam_monitor detect <steamcmd-output.log>
```

An observation cannot verify the installed game, assembly hashes, artwork pixels,
capability relationships or saves. On a new build, independently verify local
manifest provenance, exact source/assembly identities, canonical mappings and
bounded decoding for each artwork domain. Use the installed checks below and
synthetic regressions; mutation approval still requires its own reviewed evidence.

Read-only artwork tolerates a Steam build-ID change when the installed managed
assembly is byte-for-byte one of the independently reviewed Unity 6 assemblies.
Known builds retain their exact build/digest pair; they cannot borrow another
build's pin. Unknown builds require authoritative Steam provenance, an owned
assembly bounded to 32 MiB, its reviewed digest, and unchanged source identities.
Unity version alone never admits artwork, and changed assemblies require manual
review even if their metadata appears compatible.

Each domain still validates independently: Cosmetics resolves the installed
canonical vector, unique GUID/Sprite/bundle relationships and bounded PNGs;
Upgrades follows typed prefab/material/texture references and bounded streams;
Items uses reviewed baked-icon recipes and authored prefab identities; Maps reads
the normal-level roster and authored preview references. Malformed or ambiguous
inputs keep the existing fallback. Caches retain their source watches; upgrade
texture cache format 3 also binds assembly and manifest changes, invalidating
older entries before reuse. Missing item icons remain unavailable.

This fallback supplies no mutation capability or production Tauri write authority.
Tauri artwork transport remains separate from Python artwork admission.

### Installed and committed evidence

From `web/`:

```powershell
npm run capabilities:check
npm run capabilities:check:installed -- --game-dir "D:\SteamLibrary\steamapps\common\REPO"
```

The first command is CI-safe and read-only. It validates schemas, evidence and parser
fingerprints, regenerates expected content in memory, and prints semantic additions/removals on
drift. The second command reads one local installation through Desktop's production discovery and
Unity parser. Omit `--game-dir` to use normal Desktop discovery.

An installed check compares the parser/oracle baselines. For `26813769`, use the reviewed Tauri
fingerprints above. The older installed checker can report drift or an unsupported parser layout
even when public write approval uses the newer pinned sources. It does not run independent UnityPy
or managed-code tooling.
Extraction failure is reported as failure, never as an empty capability set. A successful empty
catalog remains an exact semantic result and is reported as removals. No snapshot is changed by
either check.

## Approving Recharge evidence

For a changed game build, first produce a sanitized JSON capture from the existing independent
UnityPy proof workflow:

```json
{
  "schemaVersion": 1,
  "tool": "UnityPy",
  "compatibility": {
    "steamAppId": "3241660",
    "steamBuildId": "<exact Steam build ID>",
    "unityVersion": "2022.3.67f2"
  },
  "itemBatteryIdentities": ["<exact, sorted identities>"]
}
```

Then run:

```powershell
npm run capabilities:update -- --game-dir "D:\SteamLibrary\steamapps\common\REPO" `
  --recharge-oracle "D:\review\recharge-unitypy.json"
```

The update is blocked unless Desktop extraction and UnityPy agree exactly, the build metadata
matches, and no new ambiguous item is silently promoted. Review every semantic change and repeat
the disposable-save/in-game Recharge gate before accepting newly rechargeable identities.

## Approving cosmetics evidence

The normal cosmetics update uses the installed game plus the existing Gate 2 UnityPy oracle
capture. It does not require a fresh MetaSave:

```powershell
npm run capabilities:update -- --game-dir "D:\SteamLibrary\steamapps\common\REPO" `
  --cosmetics-oracle "D:\review\cosmetic-catalog-gate2-oracle.json"
```

The installed catalog must parse through Desktop's production standard-library reader and match
the independent UnityPy catalog entry-for-entry: explicit index, asset identity, type, rarity, and
status. Parser failure, an empty/error ambiguity, duplicate targets, null targets, or any mismatch
blocks the update.

If `Assembly-CSharp.dll` is byte-identical to the assembly bound to the approved ownership proof,
the historical managed relationship remains applicable. If the assembly changed, independently
review its IL and provide a sanitized proof of the unchanged normalized contract:

```powershell
npm run capabilities:update -- --game-dir "D:\SteamLibrary\steamapps\common\REPO" `
  --cosmetics-oracle "D:\review\cosmetic-catalog-gate2-oracle.json" `
  --cosmetics-contract-proof "D:\review\cosmetics-managed-contract.json"
```

That proof is accepted only when it identifies the exact installed build and assembly digest and
confirms the existing `MetaManager.cosmeticAssets` -> `List<CosmeticAsset>.IndexOf` ->
`cosmeticHistory`/`cosmeticUnlocks` contract. Changed or ambiguous semantics block generation.
The sanitized proof shape is:

```json
{
  "schemaVersion": 1,
  "tool": "dnfile/dncil",
  "compatibility": {
    "steamAppId": "3241660",
    "steamBuildId": "<exact Steam build ID>",
    "unityVersion": "<exact reviewed Unity version>"
  },
  "managedAssemblySha256": "sha256:<exact Assembly-CSharp.dll digest>",
  "relationshipVerified": true,
  "semanticContract": {
    "sourceObject": "MetaManager.cosmeticAssets",
    "consumerMethod": "MenuElementCosmeticButton.Start",
    "indexOperation": "List<CosmeticAsset>.IndexOf",
    "fingerprint": "<the unchanged normalized contract fingerprint>"
  }
}
```

The approved full-unlock MetaSave remains historical corroboration. Capture a new one only when
the managed relationship or vector semantics changed, or when the parser/oracle/fingerprint checks
cannot prove the previous relationship still applies. In that exceptional path, use a copy and
still supply the independent UnityPy oracle:

```powershell
npm run capabilities:update -- --game-dir "D:\SteamLibrary\steamapps\common\REPO" `
  --cosmetics-oracle "D:\review\cosmetic-catalog-gate2-oracle.json" `
  --cosmetics-save "D:\review\MetaSave-copy.es3" `
  --steam-build-id "<exact Steam build ID>"
```

The source save must decrypt and validate through Desktop's existing save code. Both ownership
lists must be duplicate-free, contain the exact same explicit IDs, and match the installed vector
indices exactly. Only normalized evidence and the source SHA-256 are committed; decrypted data and
the source file never are.

If the historical capture's build is unknown, keep it `null` rather than inventing metadata. A
new known build may be recorded only from new evidence.

## Web write compatibility

The v0.5.3 Web review uses the gameplay acceptance and immutable file evidence in
[Desktop v0.3.2](https://github.com/Yoruxyv/RepoDitor/releases/tag/v0.3.2).
The existing 29 Recharge identities and exact 557 Cosmetics IDs carry forward. The generator
checks these sets and fingerprints the reviewed Desktop approvals, including the shared
save-format sources, before emitting either snapshot. It keeps the older UnityPy and
managed-code proofs as historical evidence. The snapshots identify the latest reviewed build.
Browser imports have no
trusted Steam BuildID or installed-file fingerprints.

Web validates the specific supported save fields and guards each existing edit. Normal and Shop
are the reviewed Resume targets. Web preserves the existing explicit repair for legacy value
`2`. Other Resume integers stay readable and unchanged when other Run fields are edited.
Recharge remains limited to exact eligible instances. Cosmetics preserves unknown IDs and
respects equipment and preset references. The export reopens the encrypted copy and checks the
data locally.

For a later Steam patch, compare the existing Desktop source evidence first. When dependencies
and supported identities match, reuse the same contracts. If a relevant dependency changes,
review the affected domains and update the Web/Desktop evidence in the same change as the
new Desktop approval. The monitor only raises a review notification.

## Review and CI

After an evidence update:

1. inspect evidence and generated diffs;
2. run `npm run capabilities:update` again and confirm it changes nothing;
3. run `npm run capabilities:check`;
4. run the full Web and Desktop Python validation suites;
5. complete the relevant disposable-save and in-game compatibility gate.

The required CI status is `Compatibility / Desktop-Web Alignment`. It validates committed evidence
and generated artifacts only; it does not claim that a live local game installation was scanned.

## Current cosmetic approval and per-capability status

`cosmetics.v1.json` remains immutable historical evidence for build 23363152 and IDs 0–546.
`cosmetics.v2.json` records the exact independent catalog proof for build 26294889 /
Unity 6000.3.17f1 and IDs 0–556. Its evidence schema v2 records
`ownershipOracle.sourceSaveCosmeticIds` separately:
the historical game-generated full-unlock save proved 547 IDs, while the current 557-ID policy
uses exact independent catalog/target agreement and the unchanged managed ownership contract.
It does not claim a fresh 557-ID in-game capture. The user confirmed in-game Unlock All recognition
for all 557 on 2026-11-01; individual unlock, removal and game-restart persistence were not separately
confirmed. Snapshot formats remain v1. `known-cosmetics.v1.json` and the generated Python
policies are active runtime artifacts populated from V2 evidence, not obsolete historical snapshots;
Web metadata also identifies the newer Desktop review while retaining this source proof.

The historical reader stays pinned. `cosmetics/installed_reader.py` reuses its bounded
traversal and the reviewed header specialization for the maintainer's current-build scan.
It performs no image decoding or caching. Current approval additionally verifies exact
serialized targets and the four source-file SHA-256 values in the independent capture.
An unsupported header, changed source, mismatched target or changed managed contract blocks approval.

Reproduce the independent capture in a separate research environment (no new production dependency):

```powershell
$env:PYTHONPATH = "desktop/python"
uv run --no-project --with "UnityPy[ttgen]==1.25.4" python -m tools.capabilities.capture_cosmetics --game-dir "E:/SteamLibrary/steamapps/common/REPO" --output "$env:TEMP/cosmetics-oracle.json"
```

The capture uses canonical UTF-8/LF bytes so its SHA-256 remains stable after Git normalization.

Review the managed IL independently before supplying a contract proof. Then run the existing
`update --game-dir ... --cosmetics-oracle ... --cosmetics-contract-proof ...` route, followed
by `check` and a second identical update to verify determinism. Never edit generated ID arrays.
Changes to Recharge identities require their own oracle and game/save evidence.
`recharge.v1.json` preserves the historical parser/oracle record for build 23363152.

`python -m tools.capabilities status --game-dir ...` reports the installed build and the separately
approved build/count for each domain. `check-installed` remains non-mutating and exits nonzero
when Recharge is unsupported, while still reporting the current cosmetic comparison. Neither
command launches the game or certifies in-game recognition. The GitHub **Desktop-Web Alignment**
check retains its required context name; it verifies committed evidence/fingerprints and generation,
not the contents of a maintainer's latest game installation.

See [cosmetic compatibility](../research/current-game-compatibility.md) for
the reviewed IL, user-confirmed bulk observation, remaining in-game coverage and safe manual procedure.
