# RepoDitor v0.3.0

RepoDitor has a new Windows desktop runtime. This release moves the save editor
from Electron to Tauri 2 and keeps the features you already use. It adds faster
full workspace preparation, more complete artwork for the verified game build,
and more precise compatibility checks when R.E.P.O. updates.

## What's new

- **Tauri desktop app.** RepoDitor uses Windows WebView2 and a Rust host, with
  the established Python save engine bundled alongside it. It discovers saves
  in the same Windows account and R.E.P.O. save directory as before. No separate
  Python, Node.js, or mod loader installation is needed.
- **Complete workspaces that stay ready.** The preparation screen and progress
  bar stay in place until the required data and artwork are ready. Returning to a
  prepared Run or Cosmetics view reuses validated data and images when their
  sources still match. Successful Item Recharge and Cosmetics saves update the
  affected entries without rebuilding the entire workspace.
- **More complete local artwork.** On the verified Steam build, packaged tests
  confirmed 557 Cosmetics thumbnails, 11 Upgrade textures and five Map previews.
  Items show installed artwork where available. Steam avatars can be reused
  across Runs and restarts while cached. Players show initials when Steam limits
  an uncached lookup or an image is unavailable.
- **Branded setup and removal.** The current-user installer shows progress and
  errors. The matching uninstaller asks for confirmation and reports the result.
  Both use NSIS for Windows registration and shortcuts.

## Save editing and safety

All five editing domains from the Electron editor are available for the verified
**R.E.P.O. v0.5.2 Steam build `26732417`** when the required source evidence matches.

| Workspace | What you can edit                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players   | Edit current Health or use **Heal to Full**. Valid changes appear in the pending list as you type.                                                                                          |
| Upgrades  | Edit supported player upgrades and review them alongside other pending Run changes.                                                                                                         |
| Run       | Change supported values such as level, currency, lives and haul, or choose a supported Normal or Shop resume target.                                                                        |
| Items     | Refill eligible rechargeable instances to full. Eligibility requires installed metadata and stored charge on the exact instance.                                                            |
| Cosmetics | Unlock supported entries individually or in bulk, clear saved presets, or lock supported ownership when equipment and presets allow it. **Unlock All** stages only eligible locked entries. |

**Review**, **Revert**, and **Save Changes** remain the editing workflow. Edits
stay pending until you confirm a save with the game closed. RepoDitor checks that
the source still matches, creates an exact encrypted backup, verifies the staged
output, replaces the save atomically, and records a transaction receipt for
recovery. These protections continue to apply to ordinary installed editing.

Compatibility is checked per editing domain. A new Steam BuildID can retain
previously approved editing when the relevant game files and save contract still
match. Artwork-only updates can retain unrelated write capabilities. Changed
dependencies restrict the affected tools, and shared save-format or encryption
changes can restrict every dependent tool. If a restriction appears after a patch,
read the workspace warning and wait for compatibility review. Reopen the Run if
RepoDitor detects that the save has changed since it was opened.

## Preparation times

In the recorded paired Windows package benchmark, the median time to fully open
a cold Run fell from **27.1 s to 22.3 s**, and cold Cosmetics fell from **20.9 s to
13.8 s**. These figures compare two Tauri builds using the same fixture, cache
conditions, and artwork. They measure full readiness and are separate from the
Electron performance baseline. In a later single check of the production
payload, a cold Run completed in **18.9 s**, cold Cosmetics in **14.3 s**, and
returning to an already prepared view took **0.18–0.30 s** on the test PC. Actual
times depend on the machine, the game installation, and cached data.

## Install or upgrade from Electron v0.2.1

1. Close R.E.P.O. and any open RepoDitor windows. Keep your saves and backups.
2. Download `RepoDitor-Setup-0.3.0-x64.exe` and its `.sha256` file from the
   [official GitHub Releases page](https://github.com/Yoruxyv/RepoDitor/releases).
   Run `Get-FileHash .\RepoDitor-Setup-0.3.0-x64.exe -Algorithm SHA256` and compare
   the result with the checksum below before launching setup.
3. Open **RepoDitor Desktop** from the Start menu and confirm it finds your
   saves. If v0.2.1 is still registered, RepoDitor offers to open **Installed Apps**.
   After confirming the new version works, remove the older **RepoDitor** entry.
   The two versions use separate preferences, so reselect your theme and
   language in v0.3.0.
4. To remove Tauri later, choose **RepoDitor Desktop** in **Installed Apps**.
   Keep game saves and personal backups outside either application directory.

Setup is unsigned. Windows may show an unknown publisher or SmartScreen
reputation warning. Verify the download and keep Windows security enabled.

### Download integrity

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `RepoDitor-Setup-0.3.0-x64.exe` | `5df1834d82d16b29d6b04310ded1d2c279d4ed3d670d32edde67e9ccf860163e` |

## Known limitations

- The desktop release is for Windows x64 and uses Microsoft Edge WebView2.
- The Electron interface sound effects were retired with the old desktop shell.
- Maps are previews of locally installed levels. Cosmetic tokens, arbitrary
  equipment and color changes, and custom preset creation remain unsupported.
  Unknown Cosmetic IDs are preserved.
- Steam may temporarily limit avatar requests. Previously cached avatars remain
  available while valid. RepoDitor may retry an uncached avatar after cooldown
  while that player remains selected.

Thanks to the maintainers and players who tested RepoDitor with R.E.P.O. across
save, artwork, and installer changes. RepoDitor is an unofficial community tool.
