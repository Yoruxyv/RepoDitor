# Security Policy

RepoDitor has a Windows Desktop application and an independent browser-based Web
application. Both handle encrypted game saves. Desktop's renderer is sandboxed
behind scoped Tauri commands; its Python backend owns save parsing,
validation, backups, encryption and writes. Web processes saves in the browser.

## Supported versions

| Version                               | Supported |
| ------------------------------------- | :-------: |
| `main` branch                         |    Yes    |
| Latest tagged release                 |    Yes    |
| Older releases and historical commits |    No     |
| Third-party forks                     |    No     |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use the repository **Security** tab and select **Report a vulnerability** to submit
the report privately through GitHub's private vulnerability reporting.

Include the affected version or commit, OS/browser version as applicable, affected application
layer, reproducible steps, expected and observed behavior, realistic impact,
sanitized evidence, and a suggested remediation when known.

Never attach a real `.es3` save or `.bak-*` backup. Remove usernames, Steam
identifiers, filesystem paths, machine details, and unrelated personal data
from reports and screenshots.

## In scope

Useful reports include concrete issues involving:

- arbitrary filesystem access, path traversal, or command execution;
- renderer escape or bypass of Tauri capabilities or CSP;
- unauthorized disclosure of save data, encryption material, or credentials; unrestricted Desktop IPC;
- unsafe Python-sidecar command or argument handling;
- failure of stale-file detection, exact-byte backups, staged verification, or
  atomic replacement in a way that risks unrecoverable data loss;
- crafted save files that cross a trust boundary or trigger code execution;
- unsafe avatar URL handling, redirects, or Content Security Policy bypass;
- installer or uninstaller behavior that unexpectedly modifies user saves,
  backups, or unrelated application data;
- exploitable dependency vulnerabilities with a reproducible RepoDitor impact.

## Security expectations

The Desktop boundary requires:

- a restricted WebView2 content security policy and allowlisted Tauri commands;
- local game icons use opaque tokens scoped to the active source and validated
  PNG responses; cache paths stay native;
- no arbitrary renderer filesystem, shell, network-fetch, or Python execution API;
- Python ownership of save semantics, encryption, validation, backup, and writes;
- fingerprint checks before mutation and staged verification before replacement;
- a fail-closed validated-game-process check before editing and writes;
- optional Steam avatar enrichment that fails safely and is never stored in a save;
- an installer and uninstaller that leave R.E.P.O. saves and RepoDitor backups intact.

Web keeps save import, decryption, validation, editing and export in the browser.
Its optional same-origin avatar endpoint accepts only validated Steam IDs, returns
allowlisted HTTPS image URLs and receives no save contents. Browser code does not
import Desktop implementation code or gain access to installed-game files.

## Known design limitations

- The published Windows installers and current build-validation artifacts are
  unsigned. SmartScreen may warn about them. Verify the checksum against the
  canonical release. Distribution requires maintainer approval for the exact
  artifact. Verify Authenticode separately whenever a package is signed.
- RepoDitor has no automatic updater; users install new releases manually.
- The application edits a game-owned format that may change without notice.
- Advanced item and purchase data remains read-only except for the evidence-backed exact-instance
  **Refill to Full** action. Arbitrary charge values and other item mutations remain unsupported.
- Observed R.E.P.O./ES3 saves use PBKDF2-HMAC-SHA1 with exactly 100 iterations, a 16-byte AES key,
  AES-CBC, a 16-byte IV, and PKCS#7 padding. The fixed ES3 password used as PBKDF2 input is format
  compatibility material, not a RepoDitor user credential, account credential, API secret, or
  application secret. It is an observed compatibility parameter supplied to key derivation, not
  something extracted from each `.es3` save. These parameters are compatibility requirements, not
  recommendations for new security-sensitive cryptographic systems. Raising the PBKDF2 iteration
  count, replacing CBC with GCM, changing the padding, or otherwise modernizing the scheme would
  derive a different key or emit an incompatible container. AES-CBC does not provide authentication,
  and RepoDitor does not claim that the ES3 format is authenticated. The known byte-for-byte vector
  in `desktop/python/tests/core/test_crypto.py` intentionally locks this behavior against accidental
  format drift.
- A user or process with control of the trusted Windows account can already read
  or replace files accessible to that account.

## Out of scope

Please avoid reports based only on game bugs, cheating or multiplayer policy,
unproven save-mechanic assumptions, the documented unsigned-installer warning,
scanner findings that only restate the documented ES3 compatibility parameters
without identifying a RepoDitor-specific implementation defect, dependency scanner
output without reproducible impact, attacks requiring control
of the trusted host, or unauthorized testing against R.E.P.O., Steam, GitHub, or
other third-party infrastructure.

Do not perform destructive testing, access data that is not yours, disrupt
services, or test against another person's saves without explicit authorization.

## Coordinated disclosure

Allow reasonable time for investigation and remediation before public
disclosure. Good-faith research that follows this policy and avoids privacy
violations, data loss, and service disruption will be treated as authorized for
improving RepoDitor. This policy does not authorize testing against third-party
services or infrastructure.
