# Cosmetic compatibility

RepoDitor supports cosmetic IDs 0–556 in Steam build `26294889`, Unity
`6000.3.17f1`, serialized format 22. Approval combines an independently decoded
catalog with the reviewed ownership/index contract; artwork availability does not
authorize ownership changes. Recharge retains separate historical evidence.

The reviewed `Assembly-CSharp.dll` SHA-256 is
`aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888`.

## Ownership and write behavior

The historical policy allowed IDs 0–546. Discovering display metadata for IDs
547–556 did not make them writable: individual unlock was blocked and Unlock All
used the approved historical set. The expanded policy requires the evidence below.

Desktop pending ownership counts include eligible rows only and preserve restricted
ownership. Web bulk removal checks every owned eligible ID for equipment/preset
references independently of the selected cosmetic. A discovered count alone is
never a mutation rule.

Cosmetic writes replace only changed ES3 `.value` spans through
`core/json_fields.py`, preserving unrelated JSON bytes, numeric lexemes and wrapper
metadata. Whole-document reserialization could otherwise round unknown decimals.
Backup, fingerprint checks, schema/data verification and atomic replacement remain
required. Run-save serialization retains its separate formatting/decimal limits.

Independent captures use canonical UTF-8/LF bytes for stable cross-platform hashes.
`cosmetics/installed_reader.py` rejects external sources outside the installed data
directory. The evidence-pinned historical reader and the 29-identity Recharge
policy remain separate from current cosmetic support.

## Independent catalog and managed semantics

UnityPy 1.25.4 / TypeTreeGeneratorAPI 0.0.10 independently decoded the typed
MetaManager (level0 path ID 2873) and all 557 CosmeticAsset entries. All indices,
names, types, rarities, statuses, source file IDs and serialized target IDs exactly match
the production standard-library reader. No null, duplicate or missing target occurred.
Capture: `tools/capabilities/evidence/captures/cosmetics-26294889-unitypy.json`,
SHA-256 `8b7afdf894bacde47807b0f27b417b9ac1d73e362ae83806d7cf38673a579db0`. It contains metadata only, no artwork or save content.
Repeated capture returned the same data. The old full 547-row asset capture is not present;
direct historical name/target ordering comparison is therefore unavailable. The immutable
historical ID evidence and semantic fingerprint remain independently checked.

| New ID | Installed name | Type | Rarity | Status |
| ------ | -------------- | ---- | ------ | ------ |
| 547    | Cowboy Hat     | 0    | 1      | 0      |
| 548    | Cowboy boot    | 22   | 1      | 0      |
| 549    | Cowboy boot    | 19   | 1      | 0      |
| 550    | Sheriff star   | 20   | 1      | 0      |
| 551    | Hay            | 30   | 0      | 0      |
| 552    | Miner's hat    | 0    | 1      | 0      |
| 553    | Rain boot      | 22   | 0      | 0      |
| 554    | Rain boot      | 19   | 0      | 0      |
| 555    | Holster        | 21   | 0      | 0      |
| 556    | Neck Bandana   | 20   | 0      | 0      |

Read-only dnfile 0.18.0 / dncil 1.0.2 inspection verified these current methods:

- `MenuElementCosmeticButton.Start`, MethodDef 13171: reads `MetaManager.cosmeticAssets`,
  calls MemberRef 0x0A0001CB `IndexOf`, stores `cosmeticIndex`, then disables selection
  when `cosmeticUnlocks.Contains(index)` is false; reads `cosmeticHistory` for prior use.
- MemberRef 0x0A0001CB owner signature `15124101128164` resolves to `List<CosmeticAsset>`
  (CosmeticAsset TypeDef 89); method signature `2001081300` returns Int32 from a T argument.
- `MetaManager.CosmeticHistoryAdd` / `CosmeticUnlock`, MethodDefs 8708/8709:
  use the same IndexOf value, reject -1, prevent duplicates and add to the corresponding list.
- `MetaManager.CosmeticEquip`, MethodDef 8713: rejects missing/unknown assets and requires
  `cosmeticUnlocks.Contains(index)` before equipping. No new-ID-specific ownership branch exists.
- `MetaManager.Save` / `TryLoad`, MethodDefs 8704/8705: write/read the same ES3 keys
  `cosmeticHistory`, `cosmeticUnlocks`, equipment and presets. No extra ownership key was found.
- `MetaManager.GetPossibleCosmetics` (8711) filters reward selection by rarity, valid prefab,
  optional WIP status and already-owned state. These reward filters do not replace ownership.
- `MenuElementCosmeticSection.Start` (13291) filters by type and `PrefabRef.IsValid`;
  `PrefabRef<T>.IsValid` (8747) checks nonempty `resourcePath`. All ten new entries have
  nonempty installed Cosmetics resource paths. Their status is 0; no additional progression
  state is consulted by the reviewed selection/equip ownership checks.

The normalized contract fingerprint is unchanged:
`84d8de92fdf2cf9931ba8ad7bd181d4488433928718922ee423e7fb57c0981b9`.
The reviewed contract capture is `cosmetics-26294889-contract.json` beside the catalog capture.
Approval used the documented unchanged-contract route, not artwork or a fabricated full-unlock save.
The active v2 evidence explicitly retains historical source-save proof IDs 0–546 separately
from current catalog/IL approval IDs 0–556. Python, Electron and Web policies are generated.

## Bulk ownership operations

The primary Web Cosmetics interface contains only **Unlock Remaining Cosmetics** and
**Lock All Cosmetics**. Individual unlock/removal functions and their ten-ID encrypted
round-trip tests remain available for API compatibility and Desktop policy parity.

The 556/557 count does not block Lock All. An earlier UI computed the bulk guard
over every owned approved ID but displayed a reference warning only for the selected owned
ID. With ID 0 unowned, that condition could hide a legitimate blocker on another ID. The UI
now reports equipment, preset, unverifiable-reference, busy and empty-ownership restrictions
independently of a selection. Both referenced 556/557 fixtures are blocked; an unreferenced
556/557 fixture can remove all 556 eligible ownership entries.

Read-only inspection of the previously isolated original copy found 547 supported owned IDs
and both equipment and preset references. That is not the browser's reported 556/557 state;
the private browser save was not inspected, so its exact blocker remains unconfirmed.

Lock All remains atomic: any owned eligible reference blocks the operation. The UI explains
how to remove references in the game and re-import; it never clears equipment or presets.
Confirmation states the affected count, restrictions and preserved unsupported ownership.
Cancel/Escape leave the working copy unchanged, keyboard focus stays within the confirmation,
and successful removal updates counts and review without claiming unsupported ownership reset.
Session/ownership/reference changes invalidate an open confirmation. A Lock/Unlock cycle that
changes only prior-use history also produces a review row rather than incorrectly saying Clean.
Encrypted export/re-import, ID 0 unowned, unknown ID preservation and responsive layouts are
covered by synthetic browser fixtures. No new save-processing request, dependency or permission
was introduced. Automatic reference clearing and an individual-ID Web UI are excluded.

## Functional boundary and performance

Desktop and Web use the same approved 557-ID set. Unknown/unapproved IDs remain preserved;
equipment/preset references block removal. Missing, null or scalar reference containers also
block removal before mutation on both platforms. Browser save processing remains local. It reads no
installed-game files and performs no save upload. Existing Recharge authorization is unchanged.
The maintainer scan uses the reviewed header resolver without image decoding,
runtime startup scans or a second catalog cache.
The optional cosmetic encoder runs only during a write and preserves unrelated numeric lexemes.
Run-save serialization is unchanged; its whole-document formatting/unknown-decimal limitations
are outside this cosmetic-write fix and must not be described as byte-preserving.

## Validation and user-reported in-game observation

Offline smoke testing used
an encrypted temporary copy of the existing game-generated MetaSave. The copy's authoring build
is not independently known. Ten individual unlock writes, Unlock All, backup, decrypt/reopen,
browser export/re-import and Python reopening passed. The original file stayed unchanged.
No personal fields, decrypted save or game PNG was written into the repository.

An in-game observation on 2026-11-01 reported successful Unlock All recognition for
all 557 cosmetics, including IDs 547–556.
This confirms in-game bulk-unlock recognition. It does not establish separate individual-unlock,
ownership-removal, equipping, or persistence-after-game-restart results. The exact tested binary
and save hashes were not supplied. This is a user observation, not a replacement full-unlock
save capture; historical `sourceSaveSha256` and `sourceSaveCosmeticIds` remain unchanged.

The following procedure remains available for those additional in-game paths. Use a disposable
profile or isolated test machine. The game owns its user-data location; no unverified
path-override launch argument is assumed.

1. The user prepares a disposable Windows account/profile or separate isolated test machine,
   with a separate game save tree and Steam Cloud disabled for the test. Confirm the game
   is closed and that the real profile/save tree is inaccessible to this test session.
2. Use only an encrypted copy of a game-generated MetaSave in that isolated profile. Keep
   an untouched copy outside its active game data. Use the reviewed local build of RepoDitor.
3. On separate copies, unlock each ID 547–556 individually. Start the game
   normally in the isolated profile; verify each intended cosmetic is selectable/equippable,
   exit cleanly and verify persistence after relaunch. Record game/app build and tested IDs.
4. For removal, unequip the target and clear its preset references in the isolated game.
   Close the game, remove ownership with RepoDitor, relaunch and confirm it is locked.
   Also confirm referenced removal is blocked and unrelated ownership persists.
5. Record the game/app versions, tested IDs and results. Do not copy test outputs into the
   real profile, enable cloud sync for test data, upload private saves, or publish a release.

## Recorded validation

These results describe the tested cosmetic-support configuration, not a fresh
run of the current checkout.

| Check                                                                        | Result                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uv run --locked --group test pytest -q --tb=short`                          | 572 passed, 2 existing environment skips: directory/file symlink creation unavailable on Windows.                                                                                                                                                                                                             |
| `pytest tools/capabilities/tests`                                            | 62 passed.                                                                                                                                                                                                                                                                                                    |
| Ruff check / format check; mypy                                              | Passed; 160 Python files formatted, 83 source files type-checked.                                                                                                                                                                                                                                             |
| Desktop `imports:check`, `lint`, `build`, `test`, `format:check`             | Passed; 373 Vitest tests in 44 files, plus 1 import-normalization and 9 theme tests. No new lint warnings remain.                                                                                                                                                                                             |
| Desktop `test:e2e`                                                           | 5 passed.                                                                                                                                                                                                                                                                                                     |
| `build:sidecar`, `package:dir`, `package:verify`, `test:e2e:packaged`        | Passed. Frozen Python 3.13.14 / PyInstaller 6.22.0; all 10 required package files present; packaged cosmetic ID 547 write passed on synthetic saves.                                                                                                                                                          |
| Additional actual-install packaged smoke                                     | Passed with synthetic temporary saves and read-only installed assets: 557 entries, all ten new IDs eligible, Cowboy Hat write persisted, unchanged Run save, no transient artwork preparation screen on entry/navigation/relaunch. Cold catalog load measured 7.1 seconds. No images or traces were recorded. |
| Web `imports:check`, `lint`, `format:check`, `build`, `test`, `bundle:check` | Passed; 204 Vitest tests in 16 files plus 5 script tests.                                                                                                                                                                                                                                                     |
| Web `test:e2e`                                                               | 17 passed: 556/557 bulk success, equipment/preset blocks, confirmation cancellation and keyboard focus, encrypted export/re-import, local processing and responsive layouts at 375/900/1440 pixels. Individual mutation APIs remain covered by Vitest.                                                        |
| Web Lighthouse budgets                                                       | Passed: five desktop runs scored 100 performance each; five mobile runs scored 96 each. Accessibility, best-practice and SEO category gates passed.                                                                                                                                                           |
| Private existing-save interoperability smoke                                 | Passed: ten individual Desktop writes, Unlock All, exact original-byte backup, browser decrypt/export/re-import and Python reopen on temporary copies. Real MetaSave remained byte-identical after all tests. The save authoring build is unknown.                                                            |
| Independent catalog capture                                                  | 557 exact metadata/target matches; repeated four-source capture byte-identical.                                                                                                                                                                                                                               |
| Capability generation twice, then `check`                                    | Both updates made no further changes; 557 cosmetic IDs and 29 historical Recharge identities align. Historical evidence/readers and Recharge snapshot have no diff against the base.                                                                                                                          |
| `check-installed`                                                            | Correctly reports review required / nonzero for unsupported current Recharge, while current cosmetic metadata, targets and source hashes match approved evidence.                                                                                                                                             |
| CI contract                                                                  | The required `Desktop-Web Alignment` context validates committed evidence and generated artifacts, not a live installation.                                                                                                                                                                                   |

Desktop retains its existing warning-only bundle overage: 583.03 KiB raw / 156.48 KiB gzip
against 450 / 135 KiB warning budgets. Web bundle checks pass (largest chunk 303.97 KiB raw /
92.64 KiB gzip). Cold catalog latency is measured; no before/after evidence establishes a
regression, and speculative cache/startup refactoring was not added. No production dependency changed.

## Limitations

Individual unlock, ownership removal, equipping and persistence after a game
restart have no separate current-build in-game confirmation. The bulk observation
has no supplied binary/save hashes and is not a new full-unlock save capture.
Current-build Recharge support, direct comparison with the missing historical
547-row catalog capture, and Run-save unknown-decimal preservation remain unresolved.
The seven missing item thumbnails are a separate rendering problem.
