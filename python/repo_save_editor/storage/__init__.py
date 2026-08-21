"""Encrypted save persistence and recoverability guarantees.

Storage owns source fingerprint checks, exact-byte backups, staged encrypted
verification, and atomic replacement. Callers own domain/schema validation and
must establish game-process safety before invoking a write.
"""
