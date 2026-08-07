# RepoDitor Electron UI

## Product

RepoDitor is a local desktop save editor for R.E.P.O.

The Electron interface replaces the existing Tkinter interface, but it must not
copy the Tkinter layout. Tkinter is only a behavioral reference.

The web editor at repo-save-editor.jerasoft.com.br may be studied for UX ideas,
but its visual design and implementation must not be copied.

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
4. Allow choosing another save manually.
5. Support drag-and-drop as an alternative.
6. Open the selected save in the editor.

The user should not need to manually browse for their save every time.

## Editor workspace

Primary sections:

- Overview
- Players
- Upgrades
- Run
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

## Migration rule

Do not remove Tkinter until the Electron UI reaches functional parity.

Migrate incrementally:

1. Desktop shell
2. Python connectivity
3. Save discovery
4. Save selection
5. Players
6. Upgrades
7. Run
8. Maps
9. save/backup workflow
10. packaging
11. remove Tkinter
