# RepoDitor Agent Rules

This is the authoritative repository-wide policy for coding agents. Scoped
`AGENTS.md` files add domain rules; do not maintain duplicate policies or a
parallel `CLAUDE.md`.

## Scope and navigation

Before editing, read every `AGENTS.md` from the repository root through each
target file's directory. Parent rules apply to descendants. For cross-domain
work, read every affected chain, including the owner of a script, configuration,
test, or document outside that owner's source subtree. Resolve contradictions
instead of silently bypassing a parent requirement.

Codex startup discovery follows the root-to-working-directory path; do not assume
that starting at the root loads nested guidance. Explicitly read missing chains
before working there. Use normal `AGENTS.md` files, not overrides or custom discovery
configuration. Keep combined chains small enough to load without truncation.

| Domain                                                   | Specialized instructions                                   |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Desktop contracts and validation                         | [desktop/AGENTS.md](desktop/AGENTS.md)                     |
| Electron IPC, protocols, processes                       | [desktop/electron/AGENTS.md](desktop/electron/AGENTS.md)   |
| Python save semantics and asset parsing                  | [desktop/python/AGENTS.md](desktop/python/AGENTS.md)       |
| Desktop React presentation                               | [desktop/src/AGENTS.md](desktop/src/AGENTS.md)             |
| Source and packaged Desktop E2E                          | [desktop/e2e/AGENTS.md](desktop/e2e/AGENTS.md)             |
| Installer, packaging configuration and lifecycle tooling | [desktop/installer/AGENTS.md](desktop/installer/AGENTS.md) |
| Browser product, API, and Web E2E                        | [web/AGENTS.md](web/AGENTS.md)                             |
| Technical documentation and research                     | [docs/AGENTS.md](docs/AGENTS.md)                           |

Use [CONTRIBUTING.md](CONTRIBUTING.md) for setup and contributor checks,
[architecture](docs/architecture/architecture.md) for system ownership, and the
[documentation index](docs/README.md) for technical references. Capability tooling
under `tools/capabilities/` affects both Python and Web; read those domain rules.
CI follows the validation rules below and the affected product's gates.

## Understand and bound the work

- Trace actual contracts, callers, tests, fixtures, dependencies, and documentation
  before editing. Unfamiliar code is not evidence of a defect. Separate verified
  facts from assumptions; establish the root cause before fixing a bug.
- Define observable acceptance criteria and relevant compatibility, security,
  data-integrity, and integration risks. Reproduce bugs and add regression coverage;
  define success/failure behavior for features; establish a baseline and preserve
  public contracts for refactors unless a change is authorized.
- Ask only when ambiguity materially affects correctness, safety, or the outcome.
  Resolve routine details from evidence. Explain architectural tradeoffs and push
  back on disproportionate complexity or weakened guarantees.
- For non-trivial work across files/layers, query Graphify before broad searches.
  Use a bounded relevant subgraph and verify inferred relationships in current
  files. After significant merged structural changes, refresh and verify the
  graph before relying on it. Keep `graphify-out/` ignored.
- Inspect the active checkout, branch, working tree, and staging. Another
  worktree's changes may be absent. Reuse a suitable checkout. State the smallest
  change boundary and give a concise conversational plan for substantial work.

## Small, maintainable changes

Use the installed Ponytail skill for coding/refactoring when available. First ask
whether the code is needed, then reuse an existing owner/helper, the platform,
or an installed dependency before adding machinery. Prefer the smallest readable,
testable, secure solution, not the fewest characters.

Avoid speculative abstractions, unrequested options, duplicate managers/caches/
protocols, single-use frameworks, ceremonial services/interfaces, wrappers,
compatibility shims, and premature optimization, routing, state, or transport
rewrites. Do not defend against cases excluded by verified contracts. Reuse
repeated strings for the same concept without extracting single-use constants;
different correctness, security, or invalidation contracts may justify separation.

Each file/folder needs a clear responsibility. Reuse its natural owner; move or
split only to solve an ownership/dependency problem, not for symmetry or size.
Keep feature folders shallow, neutral shared primitives outside individual
features, source roots limited to entry points/top-level architecture/cross-cutting
primitives, and imports free of cycles. Catch-all names such as `utils`, `common`,
or `shared` must describe a narrow cohesive responsibility.

Folder file counts are review signals: 1-7 normally fit; 8-12 warrant a subdomain
review; 13-20 require an explicit cohesion check; at 20 or more explain why keeping the
folder intact is clearer. Do not split cohesive folders to satisfy a number.

Use language conventions and behavior/invariant-oriented names, not agent names,
phases, or incidental updates. Preserve meaningful version/build/hash/regression
identities. Avoid cosmetic renames. Comments explain non-obvious rationale,
contracts, security, or compatibility rather than restating syntax.

Every changed line must serve the task; do not invent requirements or silently
expand scope. Preserve conventions, unrelated edits,
untracked files, staging, research, fixtures, and regression coverage. Avoid
adjacent refactors or formatting; report unrelated problems separately. Broader
refactors need scope and regression criteria. Remove only understood task-owned
dead code, imports, debugging, or temporary artifacts. Never trade validation,
types, error handling, accessibility, tests, or security for brevity.

## Security and compatibility

Preserve the existing ownership and trust boundaries. Desktop and Web are
independent implementations: no cross-importing implementation code; overlapping
behavior must agree through evidence-backed semantics and fixtures. Discovery or
presentation availability must never expand mutation authorization. Game updates
require compatibility evidence, not automatic authorization. Future Tauri work
must preserve behavioral/security contracts without an unrequested migration or
mechanical reproduction of Electron internals.

Keep installed-game files read-only. Tests/research use synthetic fixtures and
temporary copies; never modify real saves, game files, or R.E.P.O. LocalLow data
without a separately authorized, validated operation. Preserve path/namespace
authorization, bounded reads, source integrity, cache invalidation, sanitized
errors, process cleanup, and failure isolation wherever applicable. Writes must
leave the original recoverable. Never commit personal saves/backups, credentials,
proprietary game files/artwork, personal data, or generated diagnostic artifacts.

Before adding a dependency, inspect existing code/dependencies, explain why the
platform or installed packages are insufficient, and choose one focused maintained
package without overlap. No unrelated churn or automatic major upgrades. Inspect
breaking changes, keep lockfiles aligned, and rerun affected validation.

## Validation and completion

Add meaningful behavior tests with each behavior change, including relevant
negative cases, boundary validation, timeouts, cancellation, partial initialization,
cleanup, and resource ownership. Prefer deterministic controlled inputs. Do not
duplicate coverage without a reason or test only implementation details.

Investigate failed checks before changing code. Distinguish infrastructure failures
from product defects; never weaken assertions, alter frozen evidence, suppress
diagnostics, or hide hangs with retries/timeouts. Preserve failure/timeout evidence.
Do not weaken strictness, lint, accessibility, or security settings. A narrow lint
suppression needs a demonstrably incorrect rule result and an exact documented reason.

Review the entire task diff against its base, including scope, ownership, security,
and failure paths. Run the affected domain's full gates and required integration
tests; fix in-scope blockers and revalidate changes. Avoid redundant full runs when
nothing relevant changed. Documentation-only work needs Markdown formatting and
link checks, not unrelated product suites.

Keep CI and durable local gates aligned; add equivalent CI enforcement for a new
required command unless a platform-specific exception is documented. Preserve
required jobs and diagnostics; do not bypass checks to obtain green CI.

Report exact checks run, results, skipped/unavailable checks, and uncertainty.
Compilation, historical test results, or exit codes alone do not prove behavior.
Report READY only with no known in-scope blockers; stop at the requested boundary.

## Documentation and instruction maintenance

Update the existing authoritative document before creating another. Document
actual behavior, ownership, decisions, provenance, reproducible procedures,
constraints, limitations, and interpretable measurements for readers without chat
context. Keep code, package documentation, and affected references synchronized.
Create folder READMEs only for subsystems needing architectural explanation.

Keep progress and temporary plans in chat/PRs. Permanent Markdown must not become
an AI-session diary, checkpoint log, branch/date introduction, approval narrative,
or repeated status table. Preserve genuine release history, compatibility evidence,
dates, versions, hashes, measurements, and meaningful failed research. Detailed
writing conventions live under `docs/`; do not duplicate them throughout the tree.

If instructions or tooling disagree with observed behavior, inspect the installed
version and current official help/documentation. Distinguish stale guidance,
compatibility issues, and missing capabilities; update only when needed for the
task, compatibility, security, or a confirmed fix. Prefer fixing obsolete local
agent tooling over bending product architecture around it. Verify/report any
upgrade and rerun affected checks. Correct materially stale instructions in the
same task without turning them into a changelog.

## Git authorization

Use lowercase kebab-case after a conventional category prefix: `feat/`, `fix/`,
`refactor/`, `docs/`, `test/`, `ci/`, `build/`, `perf/`, or `chore/`; never `codex/`.
Verify the branch name before pushing. Never commit/push directly to `main`,
`master`, or another protected/default branch; create an appropriate branch first.
Do not reset, discard, overwrite, force-push, commit, push, open a PR, merge, or
publish without task authorization. Keep PRs focused with factual descriptions
and validation evidence.
