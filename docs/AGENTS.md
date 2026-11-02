# Technical Documentation and Research

The root writing standard applies everywhere; this file adds conventions for
maintained technical guides and research under `docs/`.

- Use the [documentation index](README.md) to find the existing document owner.
  `AGENTS.md` owns agent behavior, `CONTRIBUTING.md` owns setup/contributor checks,
  and architecture/subsystem guides own implementation detail. Link to one
  authoritative explanation instead of duplicating architecture or policy.
- Write for maintainers without conversation context. Explain actual behavior,
  responsibilities/integration boundaries, contracts, asset/data provenance,
  reproducible discovery/validation methods and commands, dependencies, decisions
  and rationale, security/compatibility limits, and unresolved technical problems.
- Preserve exact dates, versions, hashes, commits, build/source fingerprints,
  release history, formal decisions, measurements, compatibility fixtures, and
  failed research when technically meaningful. Distinguish observed evidence,
  interpretation, and causally ambiguous results. Historical measurements are not
  current-artifact validation; do not rewrite frozen evidence to fit new behavior.
- Do not write chronological agent progress reports, research-continuation or
  phase-completion narration, checkpoint/approval announcements, branch/date session
  introductions, repetitive implementation-status tables/conclusions, generic
  filler, or temporary plans disguised as architecture. Avoid excessive bolding;
  do not force all documents into one template.
- Update affected cross-references and package documentation with code changes.
  Avoid redundant Markdown files and repository-wide cosmetic rewrites. Research
  must retain the root read-only/game-data restrictions and the relevant product's
  compatibility and mutation-authorization boundaries.

For documentation-only changes, check Markdown formatting, local links/paths and
heading fragments, and affected external references. Review the full diff for lost
evidence or accidental policy changes. Report unavailable checks honestly; product
build/E2E suites are unnecessary unless behavior also changes.
