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
