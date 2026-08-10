# Save format notes

RepoDitor currently supports the observed R.E.P.O. run-save container:

- AES-CBC encryption
- 16-byte IV prepended to ciphertext
- PBKDF2-HMAC-SHA1 key derivation
- 100 PBKDF2 iterations
- 16-byte AES key
- PKCS#7 padding
- decrypted payload encoded as JSON

The implementation lives in `repo_save_editor.core.crypto`; interfaces must not implement their own crypto path.

These parameters reproduce the game-owned ES3 format; they are compatibility requirements, not
modern cryptographic choices made by RepoDitor. Static-analysis findings for SHA-1, the low PBKDF2
iteration count, CBC mode, and PKCS#7 padding are accepted only on this compatibility path. Changing
them would prevent existing R.E.P.O. saves from decrypting. A fixed compatibility vector protects
both decryption and encryption from accidental parameter drift.
