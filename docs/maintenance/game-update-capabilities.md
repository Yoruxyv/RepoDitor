# Game-update capability maintenance

RepoDitor keeps Web capability policy reproducible from reviewed evidence rather than from
hand-maintained runtime arrays. The committed evidence is data-only:

- `tools/capabilities/evidence/recharge.v1.json` records exact installed `ItemBattery`
  classifications, parser fingerprints, build metadata, and the independent UnityPy oracle.
- `tools/capabilities/evidence/cosmetics.v1.json` records exact installed
  `MetaManager.cosmeticAssets` vector indices, parser fingerprints, the normalized managed-code
  ownership/index contract, and historical parity with both ownership lists of an approved
  game-generated full-unlock MetaSave. The source save remains private and outside the repository.

- `tools/capabilities/evidence/cosmetics.v2.json` is the active current-build approval;
  the historical V1 record remains separate. See the current-approval section below.

`npm run capabilities:update` generates the Web snapshots plus Desktop Python and Electron cosmetic
policy modules from those files. Generated files must not be edited by hand. Output is
deterministic, contains no timestamps, and preserves non-contiguous cosmetic IDs exactly; a gap is
never inferred to be an owned or mutable ID.

## Routine checks

From `web/`:

```powershell
npm run capabilities:check
npm run capabilities:check:installed -- --game-dir "D:\SteamLibrary\steamapps\common\REPO"
```

The first command is CI-safe and non-mutating. It validates schemas, evidence and parser
fingerprints, regenerates expected content in memory, and prints semantic additions/removals on
drift. The second command reads one local installation through Desktop's production discovery and
Unity parser. Omit `--game-dir` to use normal Desktop discovery.

An installed check can report build drift, Recharge additions/removals, unresolved identities, and
Cosmetics additions/removals. It does not itself run proof-only UnityPy or managed-code tooling.
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
`cosmetics.v2.json` is the active approval record for build 26294889 / Unity 6000.3.17f1 and
IDs 0–556. Its evidence schema v2 records `ownershipOracle.sourceSaveCosmeticIds` separately:
the historical game-generated full-unlock save proved 547 IDs, while the current 557-ID policy
uses exact independent catalog/target agreement and the unchanged managed ownership contract.
It does not claim a fresh 557-ID in-game capture. The user confirmed in-game Unlock All recognition
for all 557 on 2026-11-01; individual unlock, removal and game-restart persistence were not separately
confirmed. Snapshot/IPC formats remain v1. `known-cosmetics.v1.json` and the generated Python/Electron
policies are active runtime artifacts populated from V2 evidence, not obsolete historical snapshots;
their consumers have not migrated to a different payload format.

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
Recharge approval is a separate operation and continues to require its own build-specific oracle
and game/save evidence. Its active record remains `recharge.v1.json` for build 23363152.

`python -m tools.capabilities status --game-dir ...` reports the installed build and the separately
approved build/count for each domain. `check-installed` remains non-mutating and exits nonzero
when Recharge is unsupported, while still reporting the current cosmetic comparison. Neither
command launches the game or certifies in-game recognition. The GitHub **Desktop-Web Alignment**
check retains its required context name; it verifies committed evidence/fingerprints and generation,
not the contents of a maintainer's latest game installation.

See [cosmetic compatibility](../research/current-game-compatibility.md) for
the reviewed IL, user-confirmed bulk observation, remaining in-game coverage and safe manual procedure.
