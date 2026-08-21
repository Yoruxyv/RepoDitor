"""Desktop adapters for local environment and installed-content discovery.

Modules sanitize service-layer discovery results for Electron without owning
Steam parsing, Windows path resolution, save parsing, or game semantics.
Additional discovery domains should expose narrow DTOs here and keep their
authoritative interpretation in ``services``.
"""
