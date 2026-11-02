# Electron Boundary

Electron owns IPC validation, trusted protocols, and Python process lifecycle;
Python retains save semantics under the parent Desktop contract.

- Extend existing typed channels and preload methods rather than adding generic
  transports. Validate caller/input shape, authorization, path/namespace ownership,
  bounds, and sanitized errors before forwarding to Python or serving local data.
- Preserve opaque artwork tokens, trusted-root checks, bounded image validation,
  source fingerprints, source-aware cache reuse/invalidation, and failure isolation.
  Discovery or decoded artwork cannot grant save-mutation permission. Keep distinct
  cache contracts separate when their ownership or invalidation differs.
- Check startup failures, timeouts, cancellation, partial initialization, process/
  stream/listener ownership, and teardown. Bounded work does not justify permanent
  workers without measured need. Preserve protocol diagnostics and prevent them
  from becoming user-data or credential disclosures.
- Keep main/preload as process/IPC composition boundaries. Do not move renderer
  orchestration or Python domain behavior into them.
- Renderer `@/` and `@electron/` aliases do not apply to Electron `.cts` files.
  Import-normalization tooling must leave Electron/preload/main imports alone;
  when changing that tooling, read [renderer rules](../src/AGENTS.md).

Run the parent Desktop checks and Electron integration/E2E for boundary changes.
For package/runtime resolution changes, also use the
[installer rules](../installer/AGENTS.md) and packaged smoke gates. Architecture
and process contracts are documented in
[application architecture](../../docs/architecture/architecture.md).
