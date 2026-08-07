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
