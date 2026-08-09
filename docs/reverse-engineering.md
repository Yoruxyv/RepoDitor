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
is evidence that this is sparse, per-instance stored charge data. Absence is not interpreted as
zero, empty, or full.

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

### Evidence status

| Domain | Status | Exact path and observed shape | Read support | Write support and remaining unknowns |
| --- | --- | --- | --- | --- |
| Item instance identity | **CONFIRMED** | `dictionaryOfDictionaries.value["item"]`; 85 baseline string keys mapping to integers. Keys match `Item <name>/<decimal instance ID>`. Duplicate types have distinct suffixes, and gaps exist (for example Medium Health Packs `/2`, `/3`, `/4` without `/1`). | Safe to expose the exact key, friendly name, and instance ID. | None. The stored integer's meaning, ordering significance, allocation rules, and companion-entry requirements are unknown. |
| Current item charge | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemStatBattery"]`; the first pair observed the Hammer `99 -> absent`, and the broad later comparison observed three `absent -> present integer` transitions while the items remained. | Safe to expose a present integer as stored charge and absence as `null`/not recorded. Exact-key links are made in Python. | None. Missing-value meaning, bounds, units, normalization, recharge behavior, and valid mutation rules remain unknown. |
| Item battery upgrades | **UNKNOWN** | `dictionaryOfDictionaries.value["itemBatteryUpgrades"]` existed as an empty dictionary in both saves. | Only structural presence and entry count are exposed. | No entry key, type, zero/absence rule, or item relationship is proven. |
| Purchased item upgrades | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsUpgradesPurchased"]`; 12 string-to-integer entries, unchanged in the A/B pair. Keys are item-type names without instance suffixes. | Only structural status and entry count are exposed. | Purchase action, count semantics, instance/type relationship, and independent mutability are unproven. |
| Purchased items | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsPurchased"]`; 55 string-to-integer entries. The broad comparison changed only `Item Power Crystal: 10 -> 9`. | Only structural status and entry count are exposed. | Whether this means current inventory, purchased quantity, or another state is unproven. |
| Total purchased items | **PARTIALLY CONFIRMED** | `dictionaryOfDictionaries.value["itemsPurchasedTotal"]`; 58 string-to-integer entries, unchanged in the A/B pair. | Only structural status and entry count are exposed. | It is not proven whether this is historical, derived, or independently mutable. |
| Additional Run charge values | **PARTIALLY CONFIRMED** | The broad comparison observed `chargingStationCharge: 10 -> 9` and `chargingStationChargeTotal: 95 -> 90` alongside other level activity. | Safe to expose the exact observed keys and values read-only. | Their units, relationship, bounds, and mutation behavior are unproven. |

All advanced capabilities are read-only. `canEdit`, `canAdd`, `canDelete`, and `canDuplicate` are
false across every domain. The renderer receives typed projections, never the decrypted save or
the unverified `item` integer payload.

### Required next controlled experiments

Run each experiment from a separately preserved before-save and change exactly one in-game state:

1. **Single recharge and use:** capture a fresh save with the uniquely identified Hammer, perform
   exactly one charging action on it without using, purchasing, or upgrading anything else, and
   capture the next normal save. From that resulting state, capture another pair around exactly
   one Hammer use. This is still required because the broad comparison proves reappearance but not
   what caused it, its increment/decrement rule, or the linked charging-station values.
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
