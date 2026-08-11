# Security Policy

RepoDitor is a local Windows desktop application that handles encrypted game
saves. Its renderer is sandboxed behind narrow Electron IPC contracts, while
the bundled Python backend owns save parsing, validation, backups, encryption,
and writes.

## Supported versions

| Version | Supported |
|---|:---:|
| `main` branch | Yes |
| Latest tagged release | Yes |
| Older releases and historical commits | No |
| Third-party forks | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use the repository **Security** tab and select **Report a vulnerability** to submit
the report privately through GitHub's private vulnerability reporting.

Include the affected version or commit, Windows version, affected application
layer, reproducible steps, expected and observed behavior, realistic impact,
sanitized evidence, and a suggested remediation when known.

Never attach a real `.es3` save or `.bak-*` backup. Remove usernames, Steam
identifiers, filesystem paths, machine details, and unrelated personal data
from reports and screenshots.

## In scope

Useful reports include concrete issues involving:

- arbitrary filesystem access, path traversal, or command execution;
- renderer escape or bypass of Electron context isolation;
- exposure of raw decrypted save JSON, encryption material, or unrestricted IPC;
- unsafe Python-sidecar command or argument handling;
- failure of stale-file detection, exact-byte backups, staged verification, or
  atomic replacement in a way that risks unrecoverable data loss;
- crafted save files that cross a trust boundary or trigger code execution;
- unsafe avatar URL handling, redirects, or Content Security Policy bypass;
- installer or uninstaller behavior that unexpectedly modifies user saves,
  backups, or unrelated application data;
- exploitable dependency vulnerabilities with a reproducible RepoDitor impact.

## Security expectations

RepoDitor's supported boundary requires:

- `contextIsolation: true` and `nodeIntegration: false`;
- narrow typed preload methods rather than raw `ipcRenderer` access;
- no arbitrary renderer filesystem, shell, network-fetch, or Python execution API;
- Python ownership of save semantics, encryption, validation, backup, and writes;
- fingerprint checks before mutation and staged verification before replacement;
- a fail-closed validated-game-process check before editing and writes;
- optional Steam avatar enrichment that fails safely and is never stored in a save;
- an installer and uninstaller that leave R.E.P.O. saves and RepoDitor backups intact.

## Known design limitations

- The historical v0.1.0 Windows installer was unsigned and may trigger a SmartScreen warning.
  The current release workflow is prepared for fail-closed Microsoft cloud signing and
  Authenticode verification, but repository contents cannot prove that the maintainer-owned
  signing identity and protected GitHub environment values have been configured.
- RepoDitor has no automatic updater; users install new releases manually.
- The application edits a game-owned format that may change without notice.
- Advanced item and purchase data remains read-only except for the evidence-backed exact-instance
  **Refill to Full** action. Arbitrary charge values and other item mutations remain unsupported.
- ES3 saves use game-defined PBKDF2-HMAC-SHA1, 100 iterations, AES-CBC, and PKCS#7 padding.
  RepoDitor preserves these parameters solely for save compatibility; they are not used to protect
  RepoDitor credentials, network traffic, or application secrets.
- A user or process with control of the trusted Windows account can already read
  or replace files accessible to that account.

## Out of scope

Please avoid reports based only on game bugs, cheating or multiplayer policy,
unproven save-mechanic assumptions, the documented unsigned-installer warning,
scanner findings that only restate the documented ES3 compatibility parameters,
dependency scanner output without reproducible impact, attacks requiring control
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
