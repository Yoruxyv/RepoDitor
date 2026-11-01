# R.E.P.O. Sunstone: installed truck-item artwork evidence

Status: **investigation / read-only evidence**, not a guarantee of visual recovery or save-mutation support.

## Provenance

- Steam build: `26294889`; Unity: `6000.3.17f1`.
- Inputs are installed game metadata, not an authoritative source for changing save fields.
- `REPO_Data/resources.assets` holds the inspected item prefabs.
- MonoScript references for this item-discovery path resolve against `REPO_Data/globalgamemanagers.assets` (note the `.assets` suffix).
- The upgrade art ResourceManager path is separately `REPO_Data/globalgamemanagers` (without `.assets`). These two file names must not be conflated.

## Observations

- Installed item definitions: **69**, comprising **57 regular items** and **12 player-upgrade definitions**.
- At the observation point, the game's `Cache/Icons/Items` contained one PNG for the 69 item keys; this is a cache observation, not proof of missing source artwork.
- A read-only prefab probe found **61/69 prefab roots** and no direct item Sprite-name matches. The name search is heuristic and cannot establish that all item sprites are absent.
- The initial broad traversal reported 34 `Transform child pointer has an unsupported class` failures.
- The targeted eight-prefab comparison found `m_Children` offsets **+40** and **+44** (after the object pointer): +40 yielded nontrivial hierarchies; +44 yielded no children/renderers in all eight cases.
- Several +40 traversals stopped because a child pointer resolved to class **224**, `RectTransform`, instead of class **4**, `Transform`.
- A diagnostic accepting both classes at offset +40 completed all eight samples. Examples:

| Prefab | GameObjects traversed | MeshRenderers | Children |
| --- | ---: | ---: | ---: |
| Item Leaf Blower | 50 | 14 | 49 |
| Item Melee Baseball Bat | 49 | 13 | 48 |
| Item Cart Small | 51 | 28 | 50 |
| Item Rubber Duck | 45 | 12 | 44 |
| Item Gun Handgun | 59 | 17 | 58 |
| Item Health Pack Small | 12 | 2 | 11 |
| Item Upgrade Player Health | 22 | 12 | 21 |
| Item WalkieTalkieBox | 28 | 13 | 27 |

## Parser correction and scope

- Retain the **40-byte** rotation/position/scale prefix in the shared parser.
- Accept only known class IDs `4` and `224` for the Transform-compatible owner/children prefix, preserving pointer and hierarchy integrity checks, cycle detection, and object-count bounds.
- Use one shared, bounded prefab-renderer traversal for upgrade and future item artwork (no duplicated hierarchy walker).
- A renderer candidate is **not** a finished 2D item thumbnail. Material textures may be shared by distinct items; a screenshot-faithful icon may require additional prefab/camera evidence.
- Run the complete installed-catalog read-only audit before asserting 57/57 item recovery.

## Rejected hypothesis / diagnostic mistake

- Rejected the +44-byte Transform layout for the tested build: it hides all children/renderers in the sample.
- An earlier probe erroneously used `globalgamemanagers` instead of `globalgamemanagers.assets` for item MonoScript resolution. The resulting 677/677 missing references were **a diagnostic path error**, not evidence of corrupt game assets or a parser-wide Unity 6 failure.

## Safety boundaries

- Never write to the installed game, its LocalLow caches, or any `.es3` save during visual discovery.
- Never use success in artwork extraction to authorize changes in ownership, recharge, purchase, or any other save-mutation capability.
- Record hashes/build provenance and regression fixtures when supporting new game versions.
