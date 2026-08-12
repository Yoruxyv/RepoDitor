# Reverse-engineering notes

Only behavior verified against controlled saves should be promoted into named editor features.

## Confirmed

- The game stores the displayed run level zero-based in `runStats["level"]`.
- `runStats["save level"] = 1` resumes the run in the Shop/Service Station in the tested game version.
- Current player HP is stored separately from the Health upgrade progression.

## Current production capability summary

- Player upgrades are discovered dynamically from observed `playerUpgrade*` dictionaries.
- Maps are discovered from the local installation and remain listing-only; save-based selection
  is not supported.
- Items dynamically distinguishes installed item-type recharge capability from exact-instance save
  charge state. **Refill to Full** remains the only supported item mutation and is available only
  when both independent evidence layers confirm it is safe.
- Cosmetics exposes known-catalog ownership totals, guarded bulk unlock/lock, and paired
  **Clear All Presets**. Unknown/future IDs are preserved.

Still pending research:

- Persistent physical item placement for truck/shop customization.
- Cosmetic display names and unsupported MetaSave domains such as tokens, equipment, arbitrary
  preset creation/editing, and arbitrary colors.

Do not hardcode unverified map or item identifiers into production UI code.

## MetaSave cosmetic ownership

RepoDitor's existing ES3 crypto decrypts the observed `MetaSave.es3`. The ownership model is
separate from Run saves and uses `cosmeticUnlocks.value` as the authoritative owned set, with
`cosmeticHistory.value` as supporting mutation state. Production exposes only a typed ownership
projection; raw MetaSave data never crosses into Electron or React.

Observed top-level MetaSave structures include `colorsEquipped`, `colorPresets`,
`cosmeticPresets`, `cosmeticEquipped`, `cosmeticHistory`, `cosmeticUnlocks`, and
`cosmeticTokens`. Ownership mutations write only the two ownership lists. Production also
supports the separately evidence-backed paired **Clear All Presets** operation across
`cosmeticPresets` and `colorPresets`; it preserves both outer list lengths.

| Evidence | SHA-256 | Result |
| --- | --- | --- |
| Clean MetaSave | `49379a449ac38bc06d415231b7723e6e045fe84498bd4bbaa769ba7f23f463fa` | History, unlocks, and tokens were empty. |
| Synthetic ID 28 unlock | `800afbd5f5309fdccf50a426e5ac7f1210e8e9eee8acb98c609986d3fb00cdbd` | ID 28 was added to history and unlocks only; R.E.P.O. loaded it as owned. |
| Game rewrite after ID 28 unlock | `4f300925d20a4dd6ecd31f423b5e74a54709ee3807624864ee2bd422c8cd81ec` | The two lists remained `[28]` with zero semantic difference from the synthetic state. |
| Game-generated full unlock | `22bbb9102d93d7fff8c4b2d3fb86dd6dc2c4475030ecb76a7c858c750741b483` | Both lists contained the exact 547-ID set `0..546`, without duplicates. |
| Synthetic Unlock All | `2cf98a08e4cfab88ba1c3460235379f57128585d0287bca16b39df06d6a6542d` | Missing known IDs were added through the ownership representation. |
| Game rewrite after Unlock All | `6799fa1c9a145095411329020e0157e0b7cb3dde686204add031a89fc0ddfd5c` | All 547 known IDs remained owned with zero semantic difference. |
| Synthetic ID 28 removal | `c5cde94309d5fec65e45580ab8350eb76dc38b35ff4ea62561b88365493bbe74` | Removing ID 28 from both lists made only that tested cosmetic unowned; R.E.P.O. loaded successfully. |

A separate natural single acquisition from the clean state changed only
`cosmeticHistory.value: [] -> [27]` and `cosmeticUnlocks.value: [] -> [27]`.
`cosmeticTokens` remained unchanged. No hash was supplied for that natural capture, so none is
invented here.

### Confirmed

- MetaSave decryptability and the two-list ownership representation.
- The currently observed known catalog is the exact set `0..546`.
- Individual unlock appends a missing known ID to both lists without duplicates.
- Unlock All composes the individual rule and preserves existing order and unknown/future IDs.
- Removing an unreferenced known ID from both lists made the tested ID 28 unowned.
- Clear All Presets empties every paired cosmetic/color preset slot while preserving the outer
  list shapes. It does not mutate ownership, tokens, or equipped state.

The removal result is behavior-confirmed, but a separate post-removal game-generated rewrite was
not captured. Removal is therefore blocked when an ID is equipped, preset-referenced, or those
references cannot be verified.

### Unknown / unsupported

- Cosmetic names; the production bulk UI deliberately avoids inventing per-ID names.
- `cosmeticTokens` semantics and all token mutation.
- Equipment mutation, arbitrary preset creation/editing, and arbitrary color mutation. Paired
  **Clear All Presets** is the only supported preset write.
- Removal semantics for equipped or preset-referenced cosmetics.
- Catalog IDs added by future game versions. Existing unknown IDs are preserved and shown
  read-only; gaps are never inferred.

Future research may look for a trustworthy local game-owned ID-to-name catalog. It
must not copy a third-party hardcoded list or bundle extracted game artwork.

## Advanced save discovery

Phase 10A used two excluded, read-only evidence files. They are not repository fixtures and must
never be committed:

| Evidence | SHA-256 |
| --- | --- |
| `01-rich-baseline.es3` | `70eeda192ea6e2e7c60043141d547c85b36cc860d6db0825a937481eefe2f84d` |
| `02-after-inflatable-hammer-use.es3` | `3cb6f29377bef2b5d2d76b371e515393522e0a557dbe0b99c7bce8d98a78110b` |

The second save was captured after one use of the single Inflatable Hammer and a normal save
transition. A sanitized minimum projection of the confirmed structures is stored in
`tests/fixtures/advanced_charge_pair.json`, and the E2E save projection is stored in
`desktop/e2e/fixtures/save.json`; both contain no personal identifiers.

The A/B pair had three advanced-container differences:

- `itemStatBattery["Item Melee Inflatable Hammer/1"]` changed from integer `99` to absent while
  the same key remained in `item`;
- `item["Item Staff Torque/1"]` appeared;
- `runStats["save level"]` changed from `2` to `0`.

The Staff Torque and resume-location changes mean this pair is not evidence for item acquisition
or Run write semantics. The exact hammer-key change is the only `itemStatBattery` difference and
is evidence that this is sparse, per-instance stored charge data. At that stage, absence was not
interpreted as zero, empty, or full; the later controlled Phase 10B evidence below narrows that
interpretation for the tested battery-backed items.

### Broad completed-level comparison

A later excluded comparison started from the second evidence file above and ended after a normally
completed level. It is structural and behavioral evidence only: multiple items were used, so no
individual gameplay action can be assigned to a changed value.

| Evidence | Bytes | SHA-256 |
| --- | ---: | --- |
| `before.es3` | 9,424 | `3cb6f29377bef2b5d2d76b371e515393522e0a557dbe0b99c7bce8d98a78110b` |
| `after.es3` | 9,520 | `cb978022f08d91ae1cb5bf9bfc03e7d28eba4f1ed0c022bfe6f05521d478f845` |

**CONFIRMED STRUCTURE:** only `timePlayed` and `dictionaryOfDictionaries` changed at the top
level. The latter retained the same 22 containers; only `itemStatBattery`, `itemsPurchased`,
`playerHealth`, and `runStats` changed. The `item` container retained the same 86 instances and
suffixes, including the existing missing `/1` in the otherwise surviving Medium Health Pack
`/2`, `/3`, `/4` sequence.

**BEHAVIORAL EVIDENCE:** three previously absent exact-instance charge entries reappeared:
`Item Drone Battery/1 = 25`, `Item Drone Indestructible/1 = 50`, and
`Item Melee Inflatable Hammer/1 = 20`. All three exact item keys survived unchanged and have no
`itemBatteryUpgrades` companion. This strengthens the read-only model of sparse, per-instance
stored integers, but does not establish bounds or write behavior.

**CAUSALLY AMBIGUOUS:** `itemsPurchased["Item Power Crystal"]` changed from `10` to `9` while
`itemsPurchasedTotal["Item Power Crystal"]` remained `29`; `chargingStationCharge` changed from
`10` to `9` and `chargingStationChargeTotal` from `95` to `90`. The shared direction is a
correlation only. The same comparison advanced `level` from `44` to `45`, changed `currency` from
`220` to `398`, changed `totalHaul` from `2447` to `2625`, and changed one anonymized player-health
value from `2100` to `1273`. `save level = 0` and `lives = 3` were unchanged.

**UNKNOWN:** `itemBatteryUpgrades` remained empty, all 12 `itemsUpgradesPurchased` entries and all
58 `itemsPurchasedTotal` entries remained unchanged, and the meaning of the integer stored in each
`item` entry remains unproven. This comparison en ables no new mutation by itself.

### Phase 10B controlled Tranq Gun charge evidence

The raw evidence remains excluded and was not re-decoded for this documentation update. The
following hashes, sizes, and decoded transitions were supplied from the controlled comparison:

| Evidence | Bytes | SHA-256 | State |
| --- | ---: | --- | --- |
| `full_tranq.es3` | 9,488 | `415bdca5ff4fb55ecd97d86a5b25e12530d0fb6acfe737c5783320ddd994ec0b` | Game-generated full/default Tranq Gun |
| `after_no_ammo_tranq.es3` | 9,504 | `798e24438d170b9a06dac2ca22c49c8733a862c38ea468b633ad3ff9bdb3e537` | Same Tranq Gun after its ammunition was depleted |
| `after_recharge_Tranq.es3` | 9,472 | `44ec387b65318e57aca9f1ab1648846d031070e667079f47d94bc5e89d7fc8bf` | Same empty Tranq Gun after a normal in-game recharge |

The controlled full-to-empty comparison contained exactly two decrypted leaf differences:

- **CONFIRMED CAUSAL:** `itemStatBattery["Item Gun Tranq/1"]` changed from absent to integer `0`.
  The exact item remained `item["Item Gun Tranq/1"] = 15`.
- **INCIDENTAL:** `timePlayed.value` changed from `56621.4258` to `56755.1875`.

The controlled empty-to-recharged comparison supplied these relevant transitions:

- **CONFIRMED CAUSAL:** `itemStatBattery["Item Gun Tranq/1"]` changed from integer `0` to absent
  while `item["Item Gun Tranq/1"]` remained `15`.
- **LIKELY RELATED:** `runStats["chargingStationCharge"]` changed from `9` to `8`,
  `runStats["chargingStationChargeTotal"]` changed from `82` to `73`, and
  `itemsPurchased["Item Power Crystal"]` changed from `9` to `8`. The controlled recharge ties
  these transitions to the action, but their units and authoritative relationships remain
  unproven.
- **STRUCTURAL ONLY:** `itemsPurchased["Item Gun Tranq"] = 1` and
  `itemsPurchasedTotal["Item Gun Tranq"] = 1` were unchanged, and `itemBatteryUpgrades` remained
  empty.

Together with the separate controlled Inflatable Hammer recharge transition
`itemStatBattery["Item Melee Inflatable Hammer/1"]: 20 -> absent`, two independent item types now
show that a normal game-generated recharge removes the exact per-instance charge entry. The Tranq
pair also provides a clean game-generated `absent -> 0` full/default-to-empty transition.

**PARTIALLY CONFIRMED:** absence is strong evidence for the canonical game-generated full/default
charge state of the tested Tranq Gun and Inflatable Hammer. Integer `0` is confirmed as empty for
the tested Tranq Gun, and present integers are consistent with stored non-full charge. This does
not establish universal maximums, arbitrary numeric ranges, per-use decrements, normalization, or
equivalent behavior for every battery-backed item.

#### Refill-to-full synthesized validation

The research helper removed only `itemStatBattery["Item Gun Tranq/1"]` from the depleted source
(`798e24438d170b9a06dac2ca22c49c8733a862c38ea468b633ad3ff9bdb3e537`) and produced the separate
synthetic save `757c36c7a1f8b4a34d2db0bde86c83aaea18c50c925a69615da8bc4c3f1fe1b9`. Reopening both saves
through RepoDitor confirmed that `0 -> absent` was the complete semantic diff and that the source
remained byte-for-byte unchanged.

R.E.P.O. loaded the synthetic save, retained the same `Item Gun Tranq/1`, presented that Tranq Gun
as full, remained playable, and completed a subsequent normal save. That game-generated save
(`711f79db5147cc782a2cadf595712e7058c59555ce21b15d3b39022438bfbfb1`) retained the absent charge
entry. Relative to the synthetic save, only normal Run progress changed: currency `398 -> 450`,
level `44 -> 45`, save level `0 -> 1`, and total haul `2625 -> 2998`.

**CONFIRMED NARROW INVARIANT:** for the tested battery-backed representation, removing an existing
exact-instance `itemStatBattery` entry selects the canonical full/default state. Production may
offer only this exact refill operation. This evidence does not establish numeric maximums, editable
ranges, battery-upgrade behavior, item lifecycle behavior, or purchased-item mutation rules.

### Installed ItemBattery capability proof

A separate read-only installed-game proof established the item-*type* capability layer without
changing the save mutation rule above. Against Steam build `23363152` / Unity `2022.3.67f2`:

- 60 active decoded `Item` definitions were matched dynamically to 197 installed prefab
  `GameObject` variants; no proof prefab path ID is part of production.
- an independent UnityPy oracle found `ItemBattery` on exactly 30 item types; the approved
  standard-library serialized-file reader found the exact same 30, with exact item and variant
  presence parity, zero presence conflicts, and zero metadata conflicts; UnityPy remains
  proof-only and is not a production dependency;
- 29 item types had normal, consistent `ItemBattery` metadata and are classified `rechargeable`;
  30 had complete successful absence across every matched variant and are classified
  `not_rechargeable`; `Item Drone Battery` had the exceptional observed flag and remains
  `unknown` because the field's gameplay semantics are not proven;
- missing, corrupt, unsupported, incomplete, or conflicting installed metadata must return
  `unknown`, never infer a negative capability.

Production derives the mapping from installed metadata at runtime. For a save-observed `Item <name>`
identity it verifies exactly one same-identity `MonoBehaviour` whose `MonoScript` class is `Item`,
then inspects every same-identity `GameObject` variant for `ItemBattery`. This identity relationship
was part of the controlled 60-item proof. Production does not ship the proof manifest, proof path
IDs, `local-evidence`, UnityPy, TypeTreeGenerator, or a hardcoded rechargeable-name/category list.
The parser is guarded to the validated Steam build and serialized layout; future or unreadable
metadata therefore disables recharge claims while leaving normal save reads available.

The production semantic model is intentionally three-part:

1. installed `ItemBattery` metadata determines item-type `rechargeable` / `not_rechargeable` /
   `unknown`;
2. `itemStatBattery` determines only the current exact-instance charge state;
3. the existing exact-leaf removal rule determines whether a particular instance can safely stage
   **Refill to Full**.

### Evidence status

| Domain | Status | Exact path and observed shape | Read support | Write support and remaining unknowns |
| --- | --- | --- | --- | --- |
| Item instance identity | **CONFIRMED** | `dictionaryOfDictionaries.value["item"]`; 85 baseline string keys mapping to integers. Keys match `Item <name>/<decimal instance ID>`. Duplicate types have distinct suffixes, and gaps exist (for example Medium Health Packs `/2`, `/3`, `/4` without `/1`). | Safe to expose the exact key, friendly name, and instance ID. | None. The stored integer's meaning, ordering significance, allocation rules, and companion-entry requirements are unknown. |
| Item-type recharge capability | **CONFIRMED ON VALIDATED INSTALLED BUILD** | Read-only installed `resources.assets` / `globalgamemanagers.assets`; 60 active `Item` definitions mapped to 197 same-identity prefab variants. Independent oracle and stdlib parser agreed on all 30 `ItemBattery`-present types. | Python exposes `rechargeable`, `not_rechargeable`, or `unknown`. Normal consistent `ItemBattery` is rechargeable; complete successful absence across every variant is not rechargeable; exceptional/conflicting/incomplete/unsupported metadata is unknown. | Capability alone never mutates a save. `Item Drone Battery` remains unknown while its exceptional flag semantics are unproven. The guard currently supports Steam build `23363152`, Unity `2022.3.67f2`, serialized-file v22 only. |
| Current item charge | **CONFIRMED NARROW MUTATION** | `dictionaryOfDictionaries.value["itemStatBattery"]`; the controlled Tranq pair observed full/default `absent -> 0` when emptied and `0 -> absent` when recharged. A separate controlled Hammer recharge observed `20 -> absent`. The synthesized exact-entry removal loaded as a full Tranq and remained absent after a normal game save. Exact item entries remained unchanged. | Explicit exact-instance entries are `stored` independently of item-type capability. Absence becomes `default_full` only when installed metadata confirms the type is rechargeable; complete confirmed non-rechargeable absence is `not_applicable`; otherwise absence is `unknown`. | Production may remove an existing exact-instance charge entry as **Refill to Full** only when the independent item-type capability is confirmed rechargeable. Universal numeric bounds, arbitrary numeric edits, per-use deltas, and battery-upgrade mutation remain unproven. |
| Item battery upgrades | **UNKNOWN** | `dictionaryOfDictionaries.value["itemBatteryUpgrades"]` existed as an empty dictionary in both saves. | Only structural presence and entry count are exposed. | No entry key, type, zero/absence rule, or item relationship is proven. |
| Purchased item upgrades | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsUpgradesPurchased"]`; 12 string-to-integer entries, unchanged in the A/B pair. Keys are item-type names without instance suffixes. | Only structural status and entry count are exposed. | Purchase action, count semantics, instance/type relationship, and independent mutability are unproven. |
| Purchased items | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsPurchased"]`; 55 string-to-integer entries. The broad comparison changed `Item Power Crystal: 10 -> 9`; the controlled Tranq recharge later changed it `9 -> 8` while the Tranq purchase entry remained `1`. | Only structural status and entry count are exposed. | The Power Crystal transition is likely related to recharging, but whether this means inventory, purchased quantity, charging resource, or another state remains unproven. |
| Total purchased items | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsPurchasedTotal"]`; 58 string-to-integer entries, unchanged in the A/B pair. | Only structural status and entry count are exposed. | It is not proven whether this is historical, derived, or independently mutable. |
| Additional Run charge values | **PARTIALLY CONFIRMED** | The broad comparison observed `chargingStationCharge: 10 -> 9` and `chargingStationChargeTotal: 95 -> 90`; the controlled Tranq recharge observed `9 -> 8` and `82 -> 73`. | Safe to expose the exact observed keys and values read-only. | Their transitions are likely related to recharging, but their units, relationship, bounds, and mutation behavior remain unproven. |

`canRefillToFull` is the only supported advanced mutation capability and applies only when the
exact instance has stored charge **and** installed metadata confirms the item type is rechargeable.
The Python write boundary rechecks that installed capability before applying any refill edit. Broad
`canEdit`, `canAdd`, `canDelete`, and `canDuplicate` capabilities remain false across every domain.
The renderer receives typed projections and the narrow action, never the decrypted save or the
unverified `item` integer payload.

### Required next controlled experiments

Run each experiment from a separately preserved before-save and change exactly one in-game state:

1. **Single-use transition:** capture a game-generated full/default Tranq or Hammer before and after
   exactly one use. The full-to-empty Tranq evidence does not establish one-use decrement behavior
   or arbitrary numeric ranges.
2. **Battery upgrade:** capture before/after saves around exactly one battery upgrade applied to a
   uniquely identified item. Do not recharge or use it in the same comparison.
3. **Purchased upgrade:** purchase exactly one player/item upgrade, save before applying it, and
   compare `itemsUpgradesPurchased`, `itemsPurchased`, `itemsPurchasedTotal`, `item`, and the
   matching player-upgrade dictionary.
4. **Purchased item:** purchase exactly one non-consumable item type with no other shop action,
   cross the save transition, and compare the two purchased containers plus `item`.
5. **Removal and instance allocation:** after a clean acquisition pair exists, remove exactly one
   of two duplicate instances and capture another pair. A later separate purchase of the same type
   is required to establish whether gaps are reused or new suffixes are allocated.
