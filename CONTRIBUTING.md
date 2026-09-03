# Contributing to RepoDitor

Thank you for helping improve RepoDitor. Keep changes focused, evidence-backed,
and safe for users' local saves.

## Before you start

- Search existing issues and pull requests.
- Use a focused branch and a Conventional Commit title.
- Read `AGENTS.md` when using an AI coding tool in this repository.
- Never commit real `.es3` files, backups, credentials, Steam identifiers,
  usernames, or local paths. Use generated/sanitized fixtures and temporary
  copies.

## Architecture boundary

RepoDitor intentionally uses this dependency direction:

```text
React renderer → sandboxed preload → typed Electron IPC → Electron main
→ Python desktop API → services → core/storage → encrypted save
```

Python owns game and save semantics. Do not move encryption, raw-save parsing,
filesystem writes, or game-mechanics calculations into React or Electron.
Preserve `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing,
and narrow preload methods.

## Source documentation

Document ownership where it lives so new features extend the tree instead of
forcing a central comment rewrite. Meaningful Python packages and modules need
concise docstrings; Electron, renderer, and important tooling modules need an
opening comment when their responsibility or trust boundary is not obvious.
Document exported or non-obvious APIs with their contract, lifetime, fallback,
and failure behavior. Do not restate syntax or maintain a closed feature catalog
in comments.

When adding a feature, document its local service/adapter/hook or view modules
and update shared architecture documentation only if a cross-layer boundary or
project-wide invariant actually changed.

## Translations

RepoDitor welcomes focused improvements to existing translations. English is the
canonical source catalog for RepoDitor-owned interface text.

Locale files live under:

```text
desktop/src/app/i18n/locales/
```

Locale filenames use locale/BCP-47-style identifiers. Examples include `en.ts`,
`ja.ts`, `id.ts`, `pt-BR.ts`, and `zh-CN.ts`; an example filename does not mean
that locale is currently shipped. Use `en.ts` as the source of required keys and
provide every translation key in the target locale.

When translating:

- Preserve placeholders exactly, including braces and names such as `{count}`,
  `{label}`, `{before}`, and `{after}`.
- Translate RepoDitor-owned UI text only. Do not translate game-owned or
  generated data through this i18n layer, including player names, Steam
  identities, game-provided item names, cosmetic names, upgrade names, map
  names, or values read from save files.
- Proper names such as RepoDitor, R.E.P.O., Steam, and GitHub generally remain
  unchanged unless there is a deliberate, established localized representation.
- Preserve the meaning of safety warnings, destructive-action confirmations,
  and error messages accurately.
- Prefer natural target-language writing over literal, machine-like
  word-for-word English structure.
- Keep corrections to existing translations focused when practical so they are
  easier to review.

### Translation quality and review

The current Japanese and Korean translations were initially prepared with AI
assistance and have not yet received complete native/fluent-speaker review. Treat
them as community-reviewable translations rather than native-verified,
authoritative wording. Fluent and native-speaker corrections are especially
welcome.

AI or machine assistance is not automatically prohibited for future translation
work, but significant machine/AI assistance should be disclosed in the pull
request. Contributors remain responsible for reviewing what they submit. In
particular:

- Safety warnings, destructive confirmations, errors, and save-safety terminology
  must preserve their meaning accurately.
- Prefer natural target-language phrasing over literal word-for-word English
  structure.
- Keep translation-improvement pull requests focused where practical so wording
  changes remain easy to review.

### Language selector capacity

RepoDitor currently ships exactly **5 registered locales**, matching the compact
language selector's maximum. Adding a sixth locale requires a deliberate selector
redesign and corresponding source/tests; do not bypass or weaken the five-locale
invariant as part of a translation-only change. Keep the existing fixed locale
order and each language's native label.

### Language selector assets

Language-selector flags are bundled SVG assets under
`desktop/src/assets/flags/`; they are not Unicode flag emoji and are not
downloaded at runtime.

Treat flags as decorative visual cues rather than the identity of a locale.
The language name remains the canonical and accessible identity of each option.
Flag images should remain hidden from assistive technology (`alt=""` and
`aria-hidden="true"`).

Country names may be used as limited search aliases where helpful, but they must
not replace the canonical language name. For example, Japan may help users find
Japanese, but the locale represents the Japanese language rather than the
country of Japan.

When a future selector redesign permits an additional locale:

- add its flag as a bundled SVG asset rather than a platform-dependent emoji;
- register the asset through the language-selector metadata;
- preserve an appropriate native/endonym language label;
- document the source and license of any externally sourced new asset.

For translation-only changes, run the following from the repository root:

```powershell
Set-Location desktop
npm run format
npm run imports:check
npm run lint
npm run build
npm test
```

If the language selector itself changes, also run `npm run test:e2e`.

## Evidence and save safety

New save mutations require controlled evidence. Record what changed, what did
not, and what remains causally ambiguous in `docs/research/reverse-engineering.md`.
Never infer a general mutation rule from a field name or a third-party editor.

All production writes must retain game-process checks, typed validation, stale
fingerprints, exact-byte backups, staging, reopen verification, and atomic
replacement. Tests must never target a real user save.

## Development setup

```powershell
git clone https://github.com/Yoruxyv/RepoDitor.git
Set-Location RepoDitor
uv sync --locked

Set-Location desktop
npm ci
```

Run the desktop in development with `npm run dev` from `desktop/`.

## Checks

Python formatting is enforced by Ruff. Desktop JavaScript, TypeScript, TSX, CTS, CSS, and JSON/config files are formatted with Prettier. Run `npm run format` from `desktop/` to apply desktop formatting before committing.

Run the checks affected by your change. The full baseline is:

```powershell
uv run ruff check python tests
uv run ruff format --check python tests
uv run mypy
uv run --locked --group test pytest

Set-Location desktop
npm run imports:check
npm run format:check
npm run lint
npm run release:check
npm run build
npm run bundle:check
npm test
npm run test:e2e
```

Run packaged E2E and installer verification for packaging/release changes.

## Pull requests

Use `.github/PULL_REQUEST_TEMPLATE.md`. Explain the problem and solution,
include exact validation results, and complete the save-safety checklist. Add
sanitized screenshots for visible UI changes. Keep one focused concern per PR
and call out anything intentionally deferred.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md),
not through a public issue.
