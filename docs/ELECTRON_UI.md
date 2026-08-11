# RepoDitor Electron UI

## Product

RepoDitor is a local desktop save editor for R.E.P.O.

The Electron interface is the only supported production interface.

## Design direction

RepoDitor should feel like a polished desktop utility made for players:

- fast
- trustworthy
- compact without feeling cramped
- game-adjacent without imitating the game's UI
- clearly designed as a desktop application rather than a website

Design targets:

- Design variance: 6/10
- Motion intensity: 3/10
- Visual density: 6/10

Avoid:

- generic AI purple/blue gradients
- excessive glassmorphism
- dashboard statistic cards
- giant permanent sidebars by default
- excessive rounded cards
- modal dialogs for simple editing
- fake functionality
- decorative animation that delays work
- copying another save editor's appearance

## Core UX

Startup should prioritize automatic save discovery.

Primary flow:

1. Detect the normal R.E.P.O. saves directory.
2. Show the latest save prominently.
3. Show recent saves.
4. Keep arbitrary file selection behind a future narrow, typed desktop contract.
5. Keep drag-and-drop behind that same validated contract if it is added later.
6. Open the selected save in the editor.

The user should not need to manually browse for their save every time.

## Editor workspace

Primary sections:

- Overview
- Players
- Upgrades
- Run
- Items (advanced discovery plus evidence-backed Refill to Full)
- Maps

Prefer top-level navigation over a large permanent sidebar unless later testing
shows a sidebar is genuinely better.

## Editing

Use friendly labels rather than raw ES3 keys.

Changes should be visible before saving, for example:

Health      82 -> 100
Currency    421 -> 100000

Maintain a persistent save/status area showing:

- number of unsaved changes
- revert action
- save action
- backup status

Never make the user wonder whether a modification has already been written.

## Save safety

Before writing:

- validate edited values
- create a backup
- clearly report success/failure

Provide useful states for:

- loading
- no saves found
- invalid save
- corrupted save
- unsupported data
- save failure
- backup failure

Do not use window.alert() for errors.

The running-game safety block uses a native modal dialog. It moves focus into the safety actions,
keeps the editor inert, prevents Escape from bypassing the block, and deliberately restores focus
after a successful recheck. Pending counts, saving progress, verified backup success, and durable
errors expose explicit status semantics for assistive technology.

Light and dark themes keep normal text at WCAG AA contrast. Interactive control boundaries use a
dedicated semantic token rather than increasing the contrast of decorative separators.

## Architecture

React must not implement ES3 encryption/decryption or save mutation logic.

Data flow:

React renderer
-> Electron preload
-> Electron main
-> Python interface
-> existing Python services/core/storage
-> .es3

Python remains the source of truth for save operations.

## Visual foundation

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS v4
- Phosphor Icons

Use one icon family.

Add component libraries only when they solve a concrete accessibility or
interaction problem.

## Identity and preferences

The top workspace navigation includes a compact utility cluster:

- the current `Yoruxyv/RepoDitor` GitHub star count, loaded through a fixed,
  typed Electron IPC endpoint and cached for the Electron session;
- Dark, Light, and System themes, persisted in renderer storage;
- English, Japanese, Korean, Chinese, and Indonesian UI languages, also
  persisted in renderer storage.

GitHub metadata is optional and fail-soft. React never receives an arbitrary
network-fetch capability. System theme follows the operating-system color
preference, and both palettes use the shared semantic color tokens.

Localization applies only to RepoDitor-owned interface text. Player names,
upgrade and item names, map names, resume values, and other strings obtained
from game/save data remain unchanged. The selected player avatar shown in
Players is reused in Upgrades without a second profile request.

The language control is a theme-aware custom listbox with compact bundled SVG
flags and native language names. Keyboard navigation, visible focus, Escape,
and click-outside dismissal are preserved. Eligible utility and action controls
use a small transform-based interaction treatment and the bundled low-volume
click sound; reduced-motion users retain color/border feedback without motion.

## Supported scope

The production workflow includes automatic discovery, save selection, Overview,
Players, Upgrades, Run, Items with exact-instance refill-to-full, Cosmetics bulk ownership and
paired preset clearing, Maps, pending edits, safe writes, backups, stale-file protection, and
packaged Windows operation. Other item mutations, arbitrary cosmetic equipment/preset editing,
arbitrary file browsing, and drag-and-drop remain outside the supported narrow desktop boundary.
