"""Encrypted save persistence and recoverability guarantees.

Storage owns source fingerprint checks, exact-byte backups, staged encrypted
verification, and atomic replacement within the admitted Windows namespace.
Callers own domain/schema validation, write
admission and game-process safety, including its final check before replacement.
"""
