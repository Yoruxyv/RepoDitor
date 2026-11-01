# Current game compatibility investigation

## Baseline and scope

Work started from integrated PR #122: `d5fc0fb71223ce84b9cd03abd83aa04e6c701cc7`,
on `fix/current-game-compatibility`. The baseline main CI was green. The previous feature
branch was left unchanged. Commit/push/PR publication was initially held. On 2026-11-01,
the user authorized final review, validation, commit, push and a PR; merge and release remain excluded.
Installed Steam app/build: 3241660 / 26294889, Unity 6000.3.17f1, serialized format 22.
Assembly-CSharp.dll SHA-256: `aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888`.

## Root cause and audit disposition

Short Python paths below are relative to `desktop/python/repo_save_editor/`.

| Decision | Severity | Location | Finding |
| --- | --- | --- | --- |
| KEEP | safety boundary | `services/cosmetics/policy.py`, `electron/ipc/cosmetics.cts` | Display discovery and artwork did not approve IDs 547–556. Individual unlock was rejected/disabled; Unlock All deliberately used the historical approved set 0–546. This explains the reported locked cosmetics; no failed encrypted write for a new ID was established. |
| FIX | medium | `desktop/src/features/cosmetics/useCosmetics.ts`, `CosmeticsView.tsx` | Pending Unlock All counted the entire discovered catalog as owned; Lock All counted zero. Projection and action guards now affect eligible rows only and preserve restricted ownership. |
| FIX | medium | `web/src/features/cosmetics/` | Web presents Unlock Remaining and confirmed Lock All. Individual mutation APIs remain tested. Global blocking explanations are independent of any selected ID; review detects equal-count replacements and history-only changes. |
| FIX | medium | `core/crypto.py`, `core/json_fields.py`, `storage/repository.py`, `desktop_api/cosmetics.py` | Whole-document serialization changed unrelated JSON bytes and could round unknown decimals. Cosmetic writes now replace changed ES3 `.value` spans only, including preservation of unrelated wrapper metadata. Backup, stale checks, schema/data verification and atomic replacement remain mandatory. |
| FIX | medium | `tools/capabilities/capture_cosmetics.py` | Independent captures now write canonical LF bytes, so Git normalization cannot invalidate the approved capture fingerprint on Linux CI. Fresh re-extraction is semantically unchanged and byte-identical on repetition. Historical captures remain unchanged. |
| FIX | medium | `tools/capabilities/`, architecture/maintenance docs | Current cosmetic evidence is separate from historical evidence; per-domain reporting no longer implies current Recharge or live-game approval. Stale LocalLow artwork and packaging claims were corrected. |
| FIX | medium | `services/cosmetics/installed_reader.py` | The shared resolver now rejects sources outside its installed data directory before opening them, including escaped external symlink targets. The evidence-pinned historical reader is unchanged. |
| DEFER | gate | `services/items/installed_metadata.py`, `tools/capabilities/evidence/recharge.v1.json` | Historical 29-identity evidence remains intact. The installed reader rejects the new build; no independent current Recharge oracle or in-game charge transition was established. |
| KEEP / DEFER | observed bulk / remaining coverage | In-game observation below | The user confirmed Unlock All recognition for all 557 cosmetics. Individual unlock, ownership removal and persistence after a game restart remain untested in-game. |
| REJECT | safety | Generated policies / artwork | Do not hand-append IDs, relabel historical parser proof, use PNG availability as authority, or modify the real installation/save. |

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
| --- | --- | --- | --- | --- |
| 547 | Cowboy Hat | 0 | 1 | 0 |
| 548 | Cowboy boot | 22 | 1 | 0 |
| 549 | Cowboy boot | 19 | 1 | 0 |
| 550 | Sheriff star | 20 | 1 | 0 |
| 551 | Hay | 30 | 0 | 0 |
| 552 | Miner's hat | 0 | 1 | 0 |
| 553 | Rain boot | 22 | 0 | 0 |
| 554 | Rain boot | 19 | 0 | 0 |
| 555 | Holster | 21 | 0 | 0 |
| 556 | Neck Bandana | 20 | 0 | 0 |

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

## Web bulk-action review

The primary Web Cosmetics interface contains only **Unlock Remaining Cosmetics** and
**Lock All Cosmetics**. Individual unlock/removal functions and their ten-ID encrypted
round-trip tests remain available for API compatibility and Desktop policy parity.

The 556/557 count does not block Lock All. The pre-publication UI computed the bulk guard
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
The desktop header resolver was reused for the new maintainer scan; no second cache, background
worker, image decoding, runtime startup scan or additional production dependency was introduced.
The optional cosmetic encoder runs only during a write and preserves unrelated numeric lexemes.
Run-save serialization is unchanged; its whole-document formatting/unknown-decimal limitations
are outside this cosmetic-write fix and must not be described as byte-preserving.

## Validation and user-reported in-game observation

Automated validation results are recorded in the final task report. Offline smoke testing used
an encrypted temporary copy of the existing game-generated MetaSave. The copy's authoring build
is not independently known. Ten individual unlock writes, Unlock All, backup, decrypt/reopen,
browser export/re-import and Python reopening passed. The original file stayed unchanged.
No personal fields, decrypted save or game PNG was written into the repository.

On **2026-11-01**, the user reported that **Unlock All succeeded in R.E.P.O.: all 557 cosmetics,
including IDs 547–556, appeared unlocked using the updated RepoDitor implementation**.
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
5. Report results before claiming in-game completion. Do not copy test outputs into the
   real profile, enable cloud sync for test data, upload private saves, or publish a release.

The seven missing item thumbnails, Maps, repository-wide quality audit and Tauri migration remain
separate work. The next milestone after this PR is the seven remaining truck-item thumbnails;
none of that reconstruction is included in this PR.

## Final automated validation

| Check | Result |
| --- | --- |
| `uv run --locked --group test pytest -q --tb=short` | 572 passed, 2 existing environment skips: directory/file symlink creation unavailable on Windows. |
| `pytest tools/capabilities/tests` after the final oracle-header helper change | 62 passed. |
| Ruff check / format check; mypy | Passed; 160 Python files formatted, 83 source files type-checked. |
| Desktop `imports:check`, `lint`, `build`, `test`, `format:check` | Passed; 373 Vitest tests in 44 files, plus 1 import-normalization and 9 theme tests. No new lint warnings remain. |
| Desktop `test:e2e` | 5 passed. Both cosmetic journeys were rerun after the final resolver restriction and passed. |
| `build:sidecar`, `package:dir`, `package:verify`, `test:e2e:packaged` | Passed after the final resolver fix. Frozen Python 3.13.14 / PyInstaller 6.22.0; all 10 required package files present; packaged cosmetic ID 547 write passed on synthetic saves. |
| Additional actual-install packaged smoke | Passed with synthetic temporary saves and read-only installed assets: 557 entries, all ten new IDs eligible, Cowboy Hat write persisted, unchanged Run save, no transient artwork preparation screen on entry/navigation/relaunch. Cold catalog load measured 7.1 seconds. No images or traces were recorded. |
| Web `imports:check`, `lint`, `format:check`, `build`, `test`, `bundle:check` | Passed; 204 Vitest tests in 16 files plus 5 script tests. |
| Web `test:e2e` | 17 passed: 556/557 bulk success, equipment/preset blocks, confirmation cancellation and keyboard focus, encrypted export/re-import, local processing and responsive layouts at 375/900/1440 pixels. Individual mutation APIs remain covered by Vitest. |
| Web Lighthouse budgets | Passed on the final source: five desktop runs scored 100 performance each; five mobile runs scored 96 each. Accessibility, best-practice and SEO category gates passed. |
| Private existing-save interoperability smoke | Passed: ten individual Desktop writes, Unlock All, exact original-byte backup, browser decrypt/export/re-import and Python reopen on temporary copies. Real MetaSave remained byte-identical after all tests. The save authoring build is unknown. |
| Independent catalog capture | 557 exact metadata/target matches; repeated four-source capture byte-identical. |
| Capability generation twice, then `check` | Both updates made no further changes; 557 cosmetic IDs and 29 historical Recharge identities align. Historical evidence/readers and Recharge snapshot have no diff against the base. |
| `check-installed` | Correctly reports review required / nonzero for unsupported current Recharge, while current cosmetic metadata, targets and source hashes match approved evidence. |
| GitHub CI | All 10 checks on integrated baseline d5fc0fb succeeded. Published-head CI results are reported on the PR; the required Desktop-Web Alignment context name is preserved. |

Desktop retains its existing warning-only bundle overage: 583.03 KiB raw / 156.48 KiB gzip
against 450 / 135 KiB warning budgets. Web bundle checks pass (largest chunk 303.97 KiB raw /
92.64 KiB gzip). Cold catalog latency is measured; no before/after evidence establishes a
regression, and speculative cache/startup refactoring was not added. No production dependency changed.

An initial concurrent test run timed out the existing cache-diagnostics test; its unchanged
timeout passed on isolated rerun and the full Desktop suite. New E2E harness assertions were
corrected to wait for the actual no-pending state, and synthetic browser fixtures
cover both equipment and preset restrictions without changing the original encrypted fixtures. Missing-reference rejection remains tested. The actual-install smoke
used the existing 15-second cross-process wait after measuring the 7-second cold read; no
production timeout or safety assertion was suppressed.

## Readiness and remaining scope

The change is scoped cosmetic compatibility support with independent catalog/managed evidence,
offline regression coverage, and user-confirmed in-game Unlock All recognition for all 557 IDs.
The user authorized commit, push and a PR after final checks. Individual unlock, removal and
game-restart persistence have automated/offline coverage but no separate in-game confirmation.
Do not label the entire game build fully supported or publish a release. Current-build Recharge
approval, direct historical asset-order comparison, and the pre-existing Run-save formatting/
unknown-decimal limitation remain unresolved. Seven truck-item thumbnails are the next milestone
after this PR; Maps, the broad audit and Tauri work remain separate.
