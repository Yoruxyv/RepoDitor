# Local R.E.P.O. asset research

Phase 10D inspected a locally installed copy of R.E.P.O. read-only to determine which game
objects can be related to RepoDitor's evidence-backed save names. Extracted pixels and generated
metadata remain excluded under `local-evidence/game-assets/`; none are part of this repository or
the desktop package.

This historical research did not itself enable item mutations or cosmetic editing. Current
production capabilities are documented separately below and in `docs/reverse-engineering.md`.

## Inspected build and tooling

| Detail | Observed value |
| --- | --- |
| Steam app/build | `3241660` / `23363152` |
| Installed update | 2026-06-14 UTC |
| Unity player | `2022.3.67f2` |
| Unity metadata reader | UnityPy `1.25.3` |
| MonoBehaviour typetrees | TypeTreeGeneratorAPI `0.0.10` using the installed managed assemblies |
| Managed metadata | dnfile `0.18.0` plus a printable UTF-16 string scan |

UnityPy and the metadata helpers were run in an isolated local tool environment. They were not
added to RepoDitor's dependencies or package.

The following installed containers were inspected:

- `globalgamemanagers` and `globalgamemanagers.assets`;
- `resources.assets` with its `.resS` and `.resource` companions;
- `sharedassets0.assets` with its `.resS` and `.resource` companions;
- `sharedassets1.assets`, `sharedassets2.assets`, and `level0` through `level2`;
- the Addressables `catalog.json`, `settings.json`, and all nine local Windows bundles;
- `Managed/Assembly-CSharp.dll` and the managed assembly set used for typetree generation.

No file in the game installation was opened for writing.

## Inventory summary

The main serialized containers contain 2,520 `Texture2D` objects and 146 `Sprite` objects. Most are
world materials, loading art, or unrelated UI; those counts are not an icon catalog.

The useful subset was:

- 67 decoded `Item` definitions: 60 active and seven marked disabled;
- 59 unique item/upgrade identifiers observed across the evidence save's `item`,
  `itemsUpgradesPurchased`, `itemsPurchased`, and `itemsPurchasedTotal` containers;
- 128 named characters in the game's item/UI emoji atlas;
- 35 `emojiIcon` enum values, of which 20 have an exact same-named atlas glyph;
- 13 save-item names with a semantically matching, purpose-built 64×64 glyph;
- 13 upgrade-related 512×512 albedo textures and seven 32×32 drone textures;
- 1,363 Addressables internal IDs, including 130 under `Items`, 553 under `Cosmetics`, 395 under
  `Level`, and 169 under `Valuables`.

The Addressables item total includes aliases and removed entries: 63 direct paths, 59
`Items/Items/...` aliases, and eight `Items/Removed Items/...` paths. The one active decoded item
definition not observed in the save-domain union was `Item Grenade Duct Taped`.

## Item-domain mapping

All 59 identifiers observed across the four item/purchase containers matched a same-named active
Unity `Item` definition with the same `prefabName` and `resourcePath`. That identity relationship is
**CONFIRMED**. It does not prove write behavior for any save container.

The object candidates are MonoBehaviour-backed `Item` definitions decoded from `resources.assets`;
their `resourcePath` values also align with the Addressables item paths. The visual candidates are
64×64 sprite characters cut from the `emojis Extraction Point` atlas in `sharedassets0.assets`.
The high-confidence rows require a purpose-specific glyph whose enum name matches the item concept;
reused or generic enum assignments remain ambiguous even when the underlying Unity object identity
is confirmed.

All game-derived icon candidates below are **LOCAL REFERENCE ONLY**. The shipping status does not
change with mapping confidence.

### High-confidence visual references

| Save/domain name | Unity object | Atlas glyph | Identity | Icon confidence | Shipping |
| --- | --- | --- | --- | --- | --- |
| `Item Drone Battery` | same name | `drone_battery` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Feather` | same name | `drone_feather` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Indestructible` | same name | `drone_indestructible` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Torque` | same name | `drone_torque` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Drone Zero Gravity` | same name | `drone_zero_gravity` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Grenade Explosive` | same name | `grenade_explosive` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Grenade Stun` | same name | `grenade_stun` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Baseball Bat` | same name | `weapon_baseball_bat` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Frying Pan` | same name | `weapon_frying_pan` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Inflatable Hammer` | same name | `weapon_inflatable_hammer` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Sledge Hammer` | same name | `weapon_sledgehammer` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Melee Sword` | same name | `weapon_sword` | CONFIRMED | HIGH CONFIDENCE | Local reference only |
| `Item Orb Zero Gravity` | same name | `orb_zero_gravity` | CONFIRMED | HIGH CONFIDENCE | Local reference only |

### Assigned but visually ambiguous glyphs

These definitions contain the listed `emojiIcon` value, but the visual is reused or does not
describe the item closely enough for RepoDitor to present it as a reliable item-specific icon.

| Save/domain names | Assigned glyph | Identity | Icon confidence | Shipping |
| --- | --- | --- | --- | --- |
| `Item Cart Medium`, `Item Cart Small` | `orb_zero_gravity` | CONFIRMED | AMBIGUOUS | Local reference only |
| `Item Melee Stun Baton` | `weapon_baseball_bat` | CONFIRMED | AMBIGUOUS | Local reference only |
| `Item Power Crystal` | `orb_battery` | CONFIRMED | AMBIGUOUS | Local reference only |
| `Item Staff Torque`, `Item Staff Void`, `Item Staff Zero Gravity` | `weapon_sword` | CONFIRMED | AMBIGUOUS | Local reference only |
| All 12 purchased upgrade item names | `orb_battery` | CONFIRMED | AMBIGUOUS | Local reference only |

The 12 purchased upgrade names are Death Head Battery, Map Player Count, Crouch Rest, Energy,
Extra Jump, Grab Range, Grab Strength, Health, Sprint Speed, Tumble Climb, Tumble Launch, and
Tumble Wings, each with the `Item Upgrade ...` prefix used in the save.

### No direct item glyph mapping

The same-named Unity item definitions are confirmed, but no matching item-atlas glyph was found
for:

- Cart Cannon, Cart Laser, Duck Bucket, Extraction Tracker;
- Grenade Human, Grenade Shockwave;
- Gun Handgun, Gun Laser, Gun Shockwave, Gun Shotgun, Gun Stun, and Gun Tranq;
- Health Pack Large, Health Pack Medium, and Health Pack Small;
- Leaf Blower, Mine Explosive, Mine Shockwave, Mine Stun, Phase Bridge, ReviveItem, and Rubber Duck;
- Valuable Tracker, both Semiscooters, WalkieTalkie, and WalkieTalkieBox.

These are **UNMAPPED** for icon presentation, even though their save-to-Unity object identity is
confirmed.

## Player-upgrade references

The discovered upgrade textures are complete 512×512 material albedo sheets. They contain useful
visual reference artwork but are not clean UI icons and are not shippable.

| Save domain | Unity object candidate | Texture candidate | Confidence | Shipping |
| --- | --- | --- | --- | --- |
| `playerUpgradeCrouchRest` | `Item Upgrade Player Crouch Rest` | `Upgrade_Crouch-Rest_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeDeathHeadBattery` | `Item Upgrade Death Head Battery` | `Upgrade_Death-Head-Battery_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeExtraJump` | `Item Upgrade Player Extra Jump` | `Upgrade_Extra-Jump_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeHealth` | `Item Upgrade Player Health` | `Upgrade_Health_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeLaunch` | `Item Upgrade Player Tumble Launch` | `Upgrade_Tumble-Launch_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeMapPlayerCount` | `Item Upgrade Map Player Count` | `Upgrade_Map-Player-Count_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeRange` | `Item Upgrade Player Grab Range` | `Upgrade_Grab-Range_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeSpeed` | `Item Upgrade Player Sprint Speed` | `Upgrade_Speed_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeStamina` | `Item Upgrade Player Energy` | `Upgrade_Energy_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeStrength` | `Item Upgrade Player Grab Strength` | `Upgrade_Grab-Strength_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeThrow` | no active decoded `Item` definition | `Upgrade_Grab-Throw_Albedo` | POSSIBLE | Local reference only |
| `playerUpgradeTumbleClimb` | `Item Upgrade Player Tumble Climb` | `Upgrade_Tumble-Climb_Albedo` | HIGH CONFIDENCE | Local reference only |
| `playerUpgradeTumbleWings` | `Item Upgrade Player Tumble Wings` | `Upgrade_Tumble-Wings_Albedo` | HIGH CONFIDENCE | Local reference only |

`playerUpgradeThrow` also has an Addressables path and `ItemUpgradePlayerGrabThrow` managed class,
but it lacks the same active decoded `Item` definition observed for the other twelve upgrades, so
it remains a weaker mapping.

## Maps

The existing RepoDitor map service already discovers the Addressables loading-graphics families.
No second map asset mechanism is needed.

| RepoDitor/internal name | Candidate assets | Confidence | Shipping |
| --- | --- | --- | --- |
| `Arctic` | `Level/Arctic/Loading Graphics/...`, `level arctic 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |
| `Manor` | `Level/Manor/Loading Graphics/...`, `level manor 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |
| `Museum` | `Level/Museum/Loading Graphics/...`, `level museum 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |
| `Wizard` | `Level/Wizard/Loading Graphics/...`, `level wizard 01`–`03` sprites | HIGH CONFIDENCE | Local reference only |

## Static managed-code findings

Static metadata, without executing the game, showed:

- `Item` owns `itemName`, `emojiIcon`, prefab/resource references, pricing/amount fields, and
  physical-item metadata.
- `ItemAttributes` owns `hasIcon`, `icon`, `itemAssetName`, and `GenerateIcon`; `SemiIconMaker`
  owns a camera/render texture and icon-generation methods. Embedded diagnostic text instructs
  developers to add `SemiIconMaker` or assign a custom icon. This explains why many items have no
  standalone purpose-built 2D icon asset.
- `ItemBattery` exposes runtime battery/charging fields and methods, but this does not establish
  `.es3` key semantics or safe mutation rules.
- `CosmeticAsset` contains `assetName`, type, rarity, prefab, `icon`, and `assetId`; its methods
  include `GetIcon` and an icon-path getter. `CosmeticTypeAsset` has `defaultIcon`.
- `MetaManager` contains cosmetic tokens, unlocks, history, equipped cosmetics/colors, presets,
  and save/load/verify methods. Managed strings explicitly reference `MetaSave`.

The cosmetics findings support a future, separate MetaSave evidence study. They do not prove a
serialized schema, normal run-save ownership, or a safe edit operation.

## Redistribution assessment

The installed game contains no license, EULA, notice, or fan-content policy granting permission to
redistribute extracted artwork. The [official Steam listing](https://store.steampowered.com/app/3241660/)
identifies semiwork as developer and publisher but provides no asset redistribution grant.
Attribution or a disclaimer would not create one.

Therefore:

- every extracted texture, sprite, atlas crop, loading image, and cosmetic asset is local reference
  only;
- no extracted game asset may be copied into tracked RepoDitor directories or Electron resources;
- only explicit written permission from the rights holder would change that assessment;
- RepoDitor may ship its existing original artwork, Phosphor icons under their existing license,
  and newly created RepoDitor-original item/upgrade icons.

## RepoDitor icon decision

No product icon resolver was added. There are currently no legally shippable item-specific assets
for it to resolve, so a typed catalog would be unused scaffolding and a hardcoded gameplay list
would conflict with dynamic item discovery.

The Items UI remains safe and complete with text, exact keys, instance IDs, stored
charge, and capability flags. If original icons are added later, the minimum architecture is a
presentation-only renderer mapping from a dynamic save/domain name to a RepoDitor-owned icon ID,
with the existing Phosphor item/package symbol as the fallback. Icon availability must never gate
whether an item is displayed.

The recommended original-art sequence is:

1. the 13 high-confidence item shapes listed above;
2. the 13 player-upgrade symbols, redrawn from gameplay concepts rather than copied/cropped from
   the material sheets;
3. category fallbacks for carts, guns, health packs, mines, trackers, vehicles, and communication
   items before attempting one bespoke icon for every remaining item;
4. bespoke replacements for the 19 ambiguous assignments only when product value justifies them.

## Historical research boundary and current production scope

This asset-discovery pass did not establish save-mutation semantics. Later controlled evidence
supports one narrow item mutation: exact-instance **Refill to Full** removes an existing
`itemStatBattery` leaf through the normal safe-write pipeline. Numeric charge edits, battery
upgrades, purchase mutations, and item add/delete/duplicate remain unsupported.

Later controlled MetaSave evidence supports guarded bulk ownership changes and paired
**Clear All Presets**. Arbitrary cosmetic equipment, token, color, and preset creation/editing
remain unsupported. None of those later capabilities changes this document's redistribution
finding: locally discovered R.E.P.O. assets are research references and are not bundled.
