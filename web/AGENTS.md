# Web Product Boundary

Web is independent of Desktop: browser UI → Web feature/domain logic → browser
save/ES3 layer → local import/export. Do not import Desktop implementation code.
Browser TypeScript may implement proven save parsing/crypto here; Desktop-only
Python, Electron IPC, and installed-game discovery requirements do not apply.
Overlapping save behavior must still agree with evidence-backed Desktop semantics.

## Security and save handling

- Keep save import, decryption, validation, in-memory edits, re-encryption,
  verification, and export in the browser. Never introduce server-side save
  processing. Preserve original recoverability and supported mutation boundaries.
- Save bytes, decrypted JSON, staged edits, and exports must not be persisted to
  browser storage or uploaded. Keep sessions in memory; only approved UI preferences
  persist. Preserve input bounds, unknown data, source integrity, and validation.
- Optional same-origin avatar enrichment is the sole narrow server capability:
  at most 16 validated SteamID64 values, fixed Steam profile requests, and only
  allowlisted HTTPS Steam CDN image URLs in response. No saves, editor values,
  or unknown fields cross this boundary; failure cannot block editing/export.
- Preserve CSP, safe URL validation, failure isolation, and local-file safeguards.
  Installed-asset discovery or presentation never grants mutation permission.
  Capability tooling must follow the
  [evidence workflow](../docs/maintenance/game-update-capabilities.md); do not hand-edit
  generated compatibility policy or broaden authorization after a game update.

## UI and performance

Keep features shallow and `App.tsx` compositional; share UI only for genuine reuse.
Follow Web import, responsive, accessibility, localization, and interaction
conventions rather than imposing Desktop window/layout behavior. Continue using
Phosphor as the application icon family and fallback.

Distinguish initial loading, valid cached content, refresh, invalidation, and
unavailable/error states. Match known content geometry with decorative skeletons
hidden from accessibility APIs, retain valid warm content without artificial delays/flashes, and keep
optional images from blocking data. Preserve focus/reduced motion and clear action
progress; do not serve stale content to seem faster. Measure bottlenecks before
adding decoding, caches, or workers. English-owned UI keys/placeholders and native
language selector conventions follow the [Web guide](README.md#web-translations).

## Validation and browser E2E

Use the independent [Web quality gates](README.md#quality-gates), from `web/`:

```powershell
npm run imports:check
npm run format:check
npm run lint
npm test
npm run build
npm run bundle:check
npm run test:e2e
npm run lighthouse
npm run test:production
```

Do not omit browser E2E for changed real journeys, local file handling, selector
persistence, or responsive behavior. Required checks must actually pass before
completion; report blockers and skipped checks.

Web E2E uses synthetic encrypted fixtures and isolated browser state, with mocked/
controlled network inputs. Assert actual local import/edit/export, rejection,
preservation, accessibility, and cleanup behavior where affected. Preserve failure
screenshots/traces and investigate hangs rather than hiding them with retries.
Browser E2E does not require the Desktop sidecar or installer.
