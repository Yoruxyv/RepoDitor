"""Renderer-independent operations exposed through the desktop sidecar.

Adapters validate protocol inputs and translate service results into bounded,
JSON-safe DTOs for Electron main. Save semantics remain in ``services`` and
safe persistence remains in ``storage``; raw decrypted objects and local paths
are not general-purpose protocol output.
"""
