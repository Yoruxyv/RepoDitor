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

These parameters reproduce the observed R.E.P.O./ES3 format; they are compatibility requirements,
not modern cryptographic choices made by RepoDitor. The fixed ES3 password used as PBKDF2 input is
format compatibility material, not a RepoDitor user credential, account secret, or application
secret. PBKDF2-HMAC-SHA1/100, AES-CBC, and PKCS#7 would be inappropriate defaults for a new
security-sensitive cryptographic design, but changing them here would derive a different key or
emit an incompatible container. AES-CBC does not authenticate the save, and RepoDitor does not
claim that it does. Static-analysis findings that merely restate these format parameters are
therefore non-actionable on this compatibility path unless they identify a RepoDitor-specific
implementation defect or exploit. A fixed compatibility vector protects both decryption and
encryption from accidental parameter drift.
