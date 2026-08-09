# Reverse-engineering notes

Only behavior verified against controlled saves should be promoted into named editor features.

## Confirmed

- The game stores the displayed run level zero-based in `runStats["level"]`.
- `runStats["save level"] = 1` resumes the run in the Shop/Service Station in the tested game version.
- Current player HP is stored separately from the Health upgrade progression.

## Pending

- Dynamic discovery of every `playerUpgrade*` dictionary.
- Map/level catalog discovery and whether map selection can be changed purely through the save.
- Persistent physical item placement for truck/shop customization.
- `MetaSave.es3` cosmetics support.

Do not hardcode unverified map or item identifiers into production UI code.

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
`item` entry remains unproven. This comparison enables no new mutation by itself.

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

#### Refill-to-full implementation experiment assessment

A narrow, research-only synthesized experiment is justified for a disposable copy of the depleted
Tranq save. It must remove only
`itemStatBattery["Item Gun Tranq/1"]`, produce a separate output file, reopen and validate that
output through existing RepoDitor code, and prove that the decrypted before/after difference is
exactly that one leaf removal. The original evidence file must remain byte-for-byte unchanged.

The synthesized save must then load successfully in R.E.P.O., the same Tranq Gun must be confirmed
full, and the next normal game save must be captured and compared. Until all of those checks pass,
this is only **READY FOR CONTROLLED IMPLEMENTATION EXPERIMENT**, not ready for production. Arbitrary
numeric charge editing remains **MORE EVIDENCE REQUIRED**, and every production advanced
capability flag remains `false`.

### Evidence status

| Domain | Status | Exact path and observed shape | Read support | Write support and remaining unknowns |
| --- | --- | --- | --- | --- |
| Item instance identity | **CONFIRMED** | `dictionaryOfDictionaries.value["item"]`; 85 baseline string keys mapping to integers. Keys match `Item <name>/<decimal instance ID>`. Duplicate types have distinct suffixes, and gaps exist (for example Medium Health Packs `/2`, `/3`, `/4` without `/1`). | Safe to expose the exact key, friendly name, and instance ID. | None. The stored integer's meaning, ordering significance, allocation rules, and companion-entry requirements are unknown. |
| Current item charge | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemStatBattery"]`; the controlled Tranq pair observed full/default `absent -> 0` when emptied and `0 -> absent` when recharged. A separate controlled Hammer recharge observed `20 -> absent`. Exact item entries remained unchanged. | Safe to expose a present integer as stored charge and absence as `null`/not recorded. For the tested Tranq, `0` is empty; for the tested Tranq and Hammer, recharge produces absence as the canonical full/default representation. Exact-key links are made in Python. | No production write support. Removing the exact Tranq charge entry is ready only for a controlled synthesized refill experiment. Universal bounds, arbitrary numeric edits, per-use deltas, and behavior across all item types remain unproven. |
| Item battery upgrades | **UNKNOWN** | `dictionaryOfDictionaries.value["itemBatteryUpgrades"]` existed as an empty dictionary in both saves. | Only structural presence and entry count are exposed. | No entry key, type, zero/absence rule, or item relationship is proven. |
| Purchased item upgrades | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsUpgradesPurchased"]`; 12 string-to-integer entries, unchanged in the A/B pair. Keys are item-type names without instance suffixes. | Only structural status and entry count are exposed. | Purchase action, count semantics, instance/type relationship, and independent mutability are unproven. |
| Purchased items | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsPurchased"]`; 55 string-to-integer entries. The broad comparison changed `Item Power Crystal: 10 -> 9`; the controlled Tranq recharge later changed it `9 -> 8` while the Tranq purchase entry remained `1`. | Only structural status and entry count are exposed. | The Power Crystal transition is likely related to recharging, but whether this means inventory, purchased quantity, charging resource, or another state remains unproven. |
| Total purchased items | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsPurchasedTotal"]`; 58 string-to-integer entries, unchanged in the A/B pair. | Only structural status and entry count are exposed. | It is not proven whether this is historical, derived, or independently mutable. |
| Additional Run charge values | **PARTIALLY CONFIRMED** | The broad comparison observed `chargingStationCharge: 10 -> 9` and `chargingStationChargeTotal: 95 -> 90`; the controlled Tranq recharge observed `9 -> 8` and `82 -> 73`. | Safe to expose the exact observed keys and values read-only. | Their transitions are likely related to recharging, but their units, relationship, bounds, and mutation behavior remain unproven. |

All advanced capabilities are read-only. `canEdit`, `canAdd`, `canDelete`, and `canDuplicate` are
false across every domain. The renderer receives typed projections, never the decrypted save or
the unverified `item` integer payload.

### Required next controlled experiments

Run each experiment from a separately preserved before-save and change exactly one in-game state:

1. **Synthesized refill-to-full validation:** on a disposable copy of the depleted Tranq evidence,
   remove only `itemStatBattery["Item Gun Tranq/1"]`, write to a separate path, reopen and verify the
   output, confirm the one-leaf decrypted diff, then load it in the game and confirm the Tranq is
   full. Preserve and re-hash the original evidence before and after. This must remain research-only.
2. **Single-use transition:** capture a game-generated full/default Tranq or Hammer before and after
   exactly one use. The full-to-empty Tranq evidence does not establish one-use decrement behavior
   or arbitrary numeric ranges.
3. **Battery upgrade:** capture before/after saves around exactly one battery upgrade applied to a
   uniquely identified item. Do not recharge or use it in the same comparison.
4. **Purchased upgrade:** purchase exactly one player/item upgrade, save before applying it, and
   compare `itemsUpgradesPurchased`, `itemsPurchased`, `itemsPurchasedTotal`, `item`, and the
   matching player-upgrade dictionary.
5. **Purchased item:** purchase exactly one non-consumable item type with no other shop action,
   cross the save transition, and compare the two purchased containers plus `item`.
6. **Removal and instance allocation:** after a clean acquisition pair exists, remove exactly one
   of two duplicate instances and capture another pair. A later separate purchase of the same type
   is required to establish whether gaps are reused or new suffixes are allocated.
