# RepoDitor Agent Rules

These instructions apply to all AI coding work in this repository.

## 1. Understand Before Coding

Read the task and trace the real code path before editing.

For any non-trivial task that crosses modules, layers, or files, use Graphify first to retrieve the relevant dependency subgraph before broad grep/search or opening many files.

Graphify is an architecture/navigation aid, not an infallible source of truth. Verify important inferred or ambiguous relationships against the actual current files before modifying them.

Prefer targeted Graphify queries with a bounded context budget. Do not dump the entire repository graph into context when a small subgraph answers the question.

After significant merged structural changes, refresh the graph using the currently installed Graphify workflow. Verify the refresh completed successfully before relying on the graph.

`graphify-out/` is generated local tooling and should remain ignored.

## 2. Use Ponytail Principles

Use the installed Ponytail skill for coding and refactoring tasks when available.

Be efficient, not careless.

Before adding code, ask in this order:

1. Does this need to exist at all?
2. Does RepoDitor already contain a helper, service, component, pattern, or type that solves it?
3. Can the standard library/platform solve it?
4. Can an already-installed dependency solve it?
5. What is the smallest clear implementation that satisfies the requirement?

Do not optimize for the fewest characters. Optimize for the least code that remains readable, testable, secure, and maintainable.

Do not remove validation, safety checks, types, error handling, tests, accessibility, or security merely to reduce line count.

## 3. No Overengineering

Apply YAGNI, KISS, and DRY only where duplication is real.

Avoid:
- speculative abstractions
- one-interface/one-implementation ceremony without a concrete benefit
- generic factories/repositories/services invented only for naming
- one-file folders without a useful boundary
- unnecessary wrappers
- unnecessary dependencies
- premature state-management libraries
- premature routing
- premature transport rewrites

Prefer cohesive modules and shallow feature folders.

## 4. No God Files

Do not solve over-abstraction by dumping everything into one file.

Watch especially:
- `desktop/src/App.tsx`
- `desktop/src/app/*`
- Electron `main.cts`
- Electron `preload.cts`
- Python `desktop_api/__main__.py`

Split when a file has multiple independent reasons to change, not merely because it crossed an arbitrary line count.

Keep boundaries by responsibility:
- presentation
- feature orchestration
- typed desktop bridge
- Electron process/IPC
- Python desktop adapter
- Python services
- core/storage

## 5. Package Identity and Folder Cohesion

The repository tree must communicate architecture, not merely store files.

Every meaningful source package or folder should have one clear identity that can be described in one sentence. Files belong where their primary responsibility naturally lives.

Before adding or moving a file, ask:

1. What domain or architectural responsibility owns this file?
2. Does the destination folder already represent that responsibility?
3. Would placing it there make the dependency direction clearer?
4. Is the file actually neutral infrastructure used by multiple domains?
5. Does this move solve a real ownership problem, or only make the tree look symmetrical?

If the ownership problem cannot be stated clearly, leave the file where it is.

### Folder cohesion

Prefer cohesive folders over arbitrary file-count limits.

File count is a review signal, not a rule:

- 1-7 direct files: normally fine; still check cohesion
- 8-12 direct files: review whether distinct subdomains are emerging
- 13-20 direct files: require an explicit cohesion check
- 20+ direct files: explain why keeping one folder is clearer than splitting it

A folder with 12 closely related files can be healthy. A folder with 6 unrelated files can already be poorly organized.

Do not split a cohesive package merely to satisfy a number.

Avoid catch-all ownership such as:

- `misc`
- `common`
- `helpers`
- `utils`
- `shared`

unless the directory or module has a specific, narrow, explainable responsibility. Prefer names that state the actual role, such as `protocol`, `fingerprint`, `unity_serialized`, or `icon_registry`.

Do not create folder hell. Prefer shallow structures and avoid one-file nesting chains without a meaningful architectural boundary.

For example, prefer:

```text
services/unity/
└── serialized.py
```

over:

```text
services/items/parsing/serializers/readers/unity_reader.py
```

when the deeper hierarchy adds no ownership clarity.

### Neutral infrastructure

Domain-neutral primitives must not be owned by one feature merely because that feature introduced them first.

If Items and Cosmetics both depend on a generic Unity serialized-file reader, the reader belongs in neutral Unity infrastructure rather than under either domain.

At the same time, do not invent broad `common` or `utils` packages. Extract only genuinely shared, cohesive primitives.

### Source-root hygiene

Source-package roots should primarily contain:

- stable package entry points
- intentionally top-level architecture modules
- truly cross-cutting primitives

Do not turn package roots into dumping grounds for unrelated feature implementation.

### Python `__init__.py`

Every meaningful production Python package should normally have a concise module docstring explaining its identity and architectural boundary.

Keep it short, usually 1-4 sentences.

Example:

```python
"""Installed item metadata and item-specific capability discovery.

This package owns evidence-backed R.E.P.O. item interpretation. Generic Unity
serialized-file parsing belongs to neutral infrastructure.
"""
```

`__init__.py` must not become a dumping ground.

Avoid:

- business logic
- filesystem work
- hidden initialization side effects
- wildcard imports
- importing the whole package tree
- broad re-export surfaces without a concrete API reason

Use `__all__` only when it intentionally defines a stable package API.

An empty production `__init__.py` should be reviewed:

- if the package has a real architectural identity, add a concise docstring
- if it exists only for packaging mechanics, keeping it minimal may be correct
- if the directory has no meaningful identity, reconsider the directory itself

Test packages may remain lighter; do not add ceremonial documentation that provides no value.

### File identity

A file should have one primary reason to change.

Large files are not automatically bad. Small files are not automatically good.

Split or move a file when responsibilities are genuinely independent, not merely because of line count.

Generic names such as `utils.py`, `helpers.ts`, `common.py`, or `types.ts` are acceptable only when the contents are genuinely cohesive and the name does not hide unrelated behavior.

### Package documentation

Add folder-level `README.md` files only for meaningful subsystems that need architectural explanation. Do not create a README in every directory.

When moving package boundaries, keep package docstrings and relevant architecture documentation synchronized.

Preserve zero-cycle architecture. File moves and extractions must not introduce Python or TypeScript import cycles.

## 6. RepoDitor Architecture

Required dependency direction:

```text
React renderer
      ↓
feature orchestration
      ↓
typed preload API
      ↓
Electron IPC
      ↓
Electron Python client
      ↓
Python desktop adapter
      ↓
Python services
      ↓
core / storage
      ↓
.es3
```

Python owns save semantics.

Renderer must never:
- decrypt `.es3`
- know the encryption password
- manipulate raw save JSON
- perform save filesystem operations directly
- parse Steam configuration
- spawn Python
- invoke arbitrary IPC channels

Electron security must retain:

```text
contextIsolation: true
nodeIntegration: false
```

Never expose raw `ipcRenderer`, generic IPC invocation, arbitrary filesystem APIs, arbitrary shell commands, or arbitrary Python execution.

## 7. Existing Domain Behavior

Reuse existing services for:
- saves
- players
- upgrades
- run state
- maps
- game/save discovery

Do not reimplement known save semantics in TypeScript.

Dynamic upgrades remain dynamic.

Maps remain discovery/listing only. Do not add BepInEx, C#, Harmony, runtime injection, or unreliable map forcing.

## 8. Frontend Organization

Prefer feature-first, shallow structure.

A modest feature may be:

```text
features/players/
├── PlayersView.tsx
├── PlayerEditor.tsx
├── api.ts
├── usePlayers.ts
└── types.ts
```

Do not mechanically create `components/hooks/api/types/utils` folders for every feature. Create subfolders only when the feature is large enough to justify them.

Shared UI belongs in shared components only after genuine reuse exists.

`App.tsx` should compose the application, not implement whole product features.

## 9. Responsive Desktop UI

RepoDitor is desktop-first, not mobile-first.

Every meaningful UI change must remain usable at:
- wide desktop
- normal desktop
- the actual minimum Electron window size

Avoid horizontal document overflow, overlapping controls, unreadable paths, and crushed forms.

Do not add mobile patterns unless the desktop app genuinely needs them.

### Content-aware loading states

Use skeletons for initial content loading when the final layout is known.

A skeleton must represent the geometry of the content that will replace it: thumbnail position, heading, metadata rows, controls, card/row size, and spacing should closely match the real component.

Do not use generic gray bars or generic `Loading...` text when a meaningful structural skeleton is available.

Distinguish content loading from action progress:

- initial content with no usable data yet -> structural skeleton
- background refresh with valid content -> keep the existing content where practical
- explicit actions such as saving, applying, or writing a backup -> keep clear action progress text/status
- empty and error states -> show the real empty/error message, not a skeleton

Optional local images are independent from data loading:

- known icon currently loading -> skeleton only inside the thumbnail box
- icon unavailable, missing, invalid, or unmapped -> Phosphor fallback immediately
- never leave a card skeletonized while waiting for an optional icon that may never exist

Skeletons are decorative. Keep them out of the accessibility tree, use `aria-busy` on the meaningful loading region where appropriate, preserve focus, and respect `prefers-reduced-motion`.

Avoid rendering hundreds of animated skeletons for large catalogs. Render only enough representative placeholders to fill the visible layout.

## 10. Testing

Every phase adds tests for its new behavior.

Do not defer all tests to final hardening.

Use:
- pytest for Python
- renderer/component tests when UI behavior warrants them
- Electron integration/E2E for real desktop journeys
- packaged smoke tests before release

Never perform destructive automated tests against real user save files. Use fixtures and temporary copies.

Do not claim a test passed unless it was actually run.

## 11. Safe Writes

Renderer changes stay in memory until an explicit save operation.

Python owns validation, backup, encryption, and write safety.

Before replacing a real save:
- validate
- create backup
- write temporary output
- verify where practical
- replace safely

Failure must leave the original recoverable.

## 12. Dependencies

Before adding any package:
1. inspect existing dependencies
2. explain why existing code/platform cannot solve the requirement cleanly
3. choose one focused maintained dependency
4. avoid overlapping libraries

Continue using Phosphor as the application UI icon family and as the fallback for game-content thumbnails.

Validated user-local R.E.P.O. cache icons may replace item/cosmetic content-thumbnail placeholders at runtime. Never bundle, commit, upload, extract into fixtures, or redistribute R.E.P.O. artwork. Missing, invalid, or unavailable local icons must fail soft to the Phosphor fallback.

## 13. Frontend Quality, Imports, and Completion Gates

The desktop renderer must comply with the repository's configured TypeScript, ESLint, React, React Hooks, accessibility, SonarJS, Tailwind CSS, and import-normalization rules.

Do not weaken TypeScript strictness, lint rules, accessibility rules, or security settings merely to make checks pass.

Do not add broad `eslint-disable` comments or config-wide suppressions as a shortcut. A narrowly scoped suppression is allowed only when the rule is demonstrably incorrect for that exact case, and the reason must be documented.

### Renderer path aliases

Renderer source code uses `@/` for `desktop/src` and `@electron/` for the
shared Electron contract boundary.

Use an alias whenever a renderer import would otherwise traverse a parent
directory or cross renderer feature/app/shared boundaries.

Examples:

```ts
import { Foo } from "@/features/foo/Foo";
```

instead of:

```ts
import { Foo } from "../../features/foo/Foo";
```

Same-directory relative imports remain valid:

```ts
import { Foo } from "./Foo";
```

Renderer parent-directory imports such as `../helper` are not allowed.

Existing valid `@/` aliases must remain aliases. Import normalization must never "normalize" an existing valid alias back into a relative path.

The `@/` and `@electron/` aliases apply to renderer/source code only.

Do not use the renderer alias in Electron `.cts` files merely for consistency.

Keep TypeScript, Vite, Vitest, ESLint, and import-normalization resolution synchronized.

### Import normalization

The import-normalization script is a maintenance tool, not the architectural source of truth.

Expected behavior:
- preview is non-destructive
- check exits non-zero when normalization is required
- fix rewrites only imports covered by the renderer alias policy
- existing valid `@/` aliases are preserved
- renderer parent-directory imports are converted to `@/` or `@electron/`
- same-directory renderer imports may remain relative
- Electron/preload/main imports are not rewritten by renderer alias policy
- unresolved imports fail strict mode rather than being guessed

Always inspect the resulting diff after an automatic import rewrite.

### Required frontend completion gate

Frontend work is not complete until the configured checks required by the task have actually run and passed.

For ordinary renderer/frontend work, the minimum gate is:

```powershell
npm run imports:check
npm run lint
npm run build
npm test
```

Run:

```powershell
npm run test:e2e
```

when the change crosses Electron/preload/IPC/Python boundaries or changes a real desktop user journey.

Run:

```powershell
npm run bundle:check
```

after a production build when renderer bundle size is affected and during release/performance hardening.

Rules:
- `npm run imports:check` must pass.
- `npm run lint` must exit successfully with no ESLint errors.
- New work should not introduce new lint warnings.
- Fix the underlying lint/type/import issue instead of weakening the rule.
- Never claim a check passed unless it was actually run.
- If a required check cannot run, report the exact blocker and do not report the task as complete.

### CI parity

Local quality policy and CI must stay aligned.

When a required local quality command becomes part of the durable completion gate, add the equivalent check to the appropriate GitHub Actions quality job unless there is a documented platform-specific reason not to.

The desktop quality workflow should enforce at least:
- clean dependency install with `npm ci`
- import normalization check
- ESLint
- production build
- renderer/component/contract tests

Electron E2E remains in the Windows integration job.

Bundle-budget checks may remain warning-only until RepoDitor has a measured release budget, but the script itself must execute successfully after build.

## 14. Toolchain and Instruction Freshness

Do not assume agent/tool instructions remain correct forever.

If Graphify, Ponytail, Codex, Electron, Playwright, Python tooling, ESLint, Vite, Vitest, or another required development tool behaves differently from the documented workflow:

1. inspect the currently installed version
2. check the tool's current official documentation/help output
3. determine whether the problem is stale instructions, a compatibility issue, or a real missing capability
4. upgrade the tool only when the upgrade is actually necessary for the requested work, compatibility, security, or a confirmed bug fix
5. verify the new version and rerun the relevant workflow/tests
6. report the version/change and why the upgrade was necessary

Do not upgrade tools or project dependencies merely because a newer version exists.

For repository dependencies:
- avoid unrelated dependency churn
- avoid automatic major-version upgrades unless the task genuinely requires them
- inspect migration/breaking changes before upgrading
- keep lockfiles consistent
- run the relevant test/build/E2E suite after an upgrade

For local agent tooling such as Graphify or Ponytail:
- if the installed version no longer matches the documented invocation or lacks a needed capability, prefer updating the local tool rather than coding around an obsolete workflow
- never silently rewrite RepoDitor product architecture just to accommodate an agent tool

If this `AGENTS.md` becomes materially stale because RepoDitor's verified architecture, testing stack, packaging model, or tool workflow changed, update the relevant rule in the same task. Keep it concise and durable; do not turn it into a changelog.

## 15. Workflow

Before modifying:
- inspect working-tree state
- use Graphify for non-trivial structural work
- inspect actual files
- state the smallest intended change boundary

While modifying:
- write the minimum cohesive code
- preserve existing behavior unless the task explicitly changes it
- do not silently expand scope

After modifying:
- run relevant tests
- run lint/format/build/import checks
- run E2E when the changed behavior crosses the desktop stack
- report exact results
- stop at the requested phase boundary

Do not commit, force-push, rewrite main, create a PR, or delete unrelated code unless explicitly requested.
