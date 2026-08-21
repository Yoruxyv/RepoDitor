"""RepoDitor's trusted Python save-processing backend.

Subpackages separate ES3 primitives, game/save semantics, desktop protocol
adaptation, and persistence.  The Electron renderer never imports this package
or receives its raw decrypted save objects; ``__version__`` is the only
intentionally top-level public value.
"""

__version__ = "0.2.1"
