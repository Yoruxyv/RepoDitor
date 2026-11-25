# Desktop React Presentation

React owns presentation, feature orchestration, and typed pending edits under the
parent Desktop boundary. Use typed Tauri adapters; save/game semantics stay in Python.

## Organization and imports

Keep features shallow and cohesive; do not mechanically create components/hooks/
api/types/utils subfolders. Share UI only after real reuse exists. The renderer entry point
composes features rather than implementing them.

Use `@/` for `desktop/renderer` when an import crosses feature/app/shared boundaries
or traverses a parent. Native command adapters live in `renderer/app/tauri/`.
Shared desktop DTOs live in `renderer/app/tauri/desktopContracts.ts`.
Parent-directory renderer imports are forbidden; same-directory `./Foo` imports
may stay relative. Preserve valid aliases. Keep TypeScript, Vite, Vitest, ESLint,
and import-normalization resolution synchronized.

Import normalization is a maintenance tool, not architecture: preview is
non-destructive; check exits non-zero on drift; fix rewrites only renderer imports
covered by this policy; strict mode fails unresolved imports instead of guessing.
Keep valid aliases and same-directory relative imports. Inspect the diff after every automatic rewrite.

## Responsive, accessible presentation

Keep the application desktop-first and usable at wide, normal, and the actual
minimum supported desktop window size. Avoid document overflow, overlaps, unreadable paths,
and crushed forms; add mobile patterns only for a demonstrated Desktop need.
Follow existing accessibility, localization, icons, and interaction conventions;
do not add unrelated animation or visual behavior.

- Use structural skeletons for initial loading when final geometry is known:
  match thumbnails, headings, metadata, controls, card/row size, and spacing.
  Do not substitute generic bars or `Loading...` for a meaningful skeleton.
- Keep valid content during background refresh where practical. Distinguish cold
  loading, valid warm reuse, refresh, invalidation, unavailable content, and errors.
  Never delay valid content for an animation or flash skeletons on a warm return;
  never bypass freshness checks to appear faster.
- Actions such as saving/applying/backups retain clear progress/status. Empty/error
  states show real messages. Optional images load independently: skeletonize only
  a known loading thumbnail; missing/invalid/unmapped images show Phosphor immediately.
  Never keep whole cards loading for optional images that may never exist.
- Skeletons are decorative and hidden from accessibility APIs. Use `aria-busy` on
  the meaningful loading region, preserve focus, respect reduced motion, and render
  only enough representative placeholders for the visible layout, not hundreds.
- Avoid repeated decoding/background work. Measure relevant CPU, memory, I/O,
  startup, decoding, and cache behavior before optimizing confirmed bottlenecks.

Run the parent Desktop frontend gates; add meaningful component/renderer coverage
for changed UI behavior. Real journey changes also require packaged Tauri E2E. Consult
[Desktop UI](../../docs/architecture/electron-ui.md) and
[contributor translation rules](../../CONTRIBUTING.md#translations) for detailed
UI and localization contracts.
