# Phase 16 numeric installer progress investigation

Investigated on 2026-09-13 against the current repository and installed dependencies.
The request's stop condition applies: **do not implement numeric telemetry through
an upstream extraction-macro replacement or plug-in modification.** The existing
stage display remains unchanged. The independent card-centering defect is fixed.

## Installed implementation and evidence

- electron-builder and app-builder-lib: **26.15.3**.
- Cached compiler: **NSIS v3.04**, electron-builder bundle `nsis-3.0.4.1`.
- Cached resources: `nsis-resources-3.4.1`, using `plugins/x86-unicode/nsis7z.dll`
  even though the application payload is x64.
- Generated `desktop/release/builder-debug.yml` and effective configuration confirm
  standard embedded-payload NSIS installation, with RepoDitor's include file and
  no replacement installer script or ZIP extraction option.
- Inspected `NsisTarget.js`, `installer.nsi`, `installSection.nsh`,
  `include/installer.nsh`, `include/extractAppPackage.nsh`, `common.nsh`,
  `uninstaller.nsh`, and the current split C# host and typed UI bridge.

The installed DLL exports `Extract`, `ExtractWithDetails`, and
`ExtractWithCallback`. This is important: the plug-in **does have real byte
telemetry**; the limitation is how the generated installer invokes it.
The official [Nsis7z distribution](https://nsis.sourceforge.io/Nsis7z_plug-in)
includes source and an example of the callback API. Its x86 Unicode DLL matches
the installed DLL byte-for-byte, SHA-256:

```text
B393F05E8FF919EF071181050E1873C9A776E1A0AE8329AEFFF7007D0CADF592
```

Source inspection covered `Bundles/Nsis7z/nsis7z.cpp` and
`UI/NSIS/ExtractCallbackConsole.{cpp,h}`. An isolated NSIS probe used the installed
compiler and installed DLL, a synthetic 32 MiB archive, an output directory under
ignored build output, and no application registration, uninstall, or elevation.
It produced 15 callback samples, including four intermediate completed-byte
values. Total was consistently 33,554,432 bytes; completed values were
non-decreasing from zero to that total. All eight extracted files matched their
synthetic inputs. `$HWNDPARENT` was zero: the callback works in silent mode
without a native installer progress window. This probe establishes capability,
not production integration or a guarantee about every archive/error case.
The temporary probe and downloaded source are not shipping code.

## Answers to the seven investigation questions

1. **Embedded payload extraction.** `extractEmbeddedAppPackage` chooses the
   architecture and writes `app-64.7z` into `$PLUGINSDIR` with NSIS `File`.
   `extractUsing7za` invokes `Nsis7z::Extract` into `$PLUGINSDIR\7z-out`, then
   `CopyFiles /SILENT` moves the extracted tree into the destination. Its existing
   copy retries can fall back to a second direct `Nsis7z::Extract`. Application
   registration, shortcuts, the stored setup, and installed uninstaller are
   separate operations. Updates first run old-version removal.

2. **Native position/maximum.** There are two different counters. NSIS's normal
   installation-page counter advances over script instructions, with its maximum
   derived from section code sizes. It is not an extraction-byte or overall-work
   counter. The plug-in separately receives 7-Zip `SetTotal`/`SetCompleted` byte
   measurements and maps their ratio onto a native control range of 0–30000.
   See the matching-version [NSIS execution source](https://github.com/kichik/nsis/blob/v304/Source/exehead/exec.c)
   and [UI source](https://github.com/kichik/nsis/blob/v304/Source/exehead/Ui.c).

3. **Silent emission.** `ExtractWithCallback` pushes total, then completed bytes
   onto the NSIS stack and executes the supplied script callback. The callback
   pops completed first, then total. This operates without a progress control.
   The existing `Extract` call does not execute a script callback or return those
   measurements. The template's `Pop $R0` restores the previously pushed output
   directory; it is not a progress result.

4. **electron-builder hooks.** Initialization and header hooks precede the
   install section. `customFiles_x64` runs after decompression and destination
   copying; `customInstall` runs after registration/shortcut work. None selects
   `ExtractWithCallback`, supplies its function address, or runs inside extraction.
   Both normal and fallback extraction calls are hardcoded. A local
   `!macroundef`/replacement of `extractUsing7za`, include shadowing, generated
   script rewriting, or a modified same-name plug-in would take ownership of
   upstream implementation details. These are not the requested supported hook.

5. **Byte reliability.** Callback totals/processed values are genuine decoder
   measurements for extraction, not completion of copying or installation.
   Compressed archive length is available at build time; the generated unpacked
   size is rounded to KiB for space requirements and `ESTIMATED_SIZE` is registry
   metadata. Neither provides a running byte count. The installed callback
   formats UInt64 counters using Windows `%lu`, exposing only 32 bits; archives
   at or beyond 4 GiB would need an explicit size restriction or corrected
   plug-in API. Measurements can be sparse: do not interpolate between samples.

6. **Small local IPC.** A scoped Windows named pipe could carry genuine callback
   data using existing native APIs and .NET, without a network listener or new
   bootstrapper. It would require an operation-specific endpoint, restrictive
   ACLs, authenticated engine client identity, bounded records, and stale-run
   rejection across retries and elevation. Transport is technically feasible
   but cannot retrieve data from the current `Extract` call. No speculative
   transport or numeric contract was added; cross-elevation transport was not
   implemented or tested.

7. **Reading the native progress control.** Silent NSIS bypasses installer pages
   and runs its installation thread without a progress HWND. The ordinary
   instruction counter is therefore not a useful silent extraction source, and
   the plug-in's control updates have no installer control to target. Creating a
   hidden page, locating controls, reading process memory, or intercepting window
   messages would introduce the prohibited UI/internal-state dependence.

## Uninstall, decision, and required change

Standard uninstall invokes removal macros and filesystem/registry operations.
Its hooks provide boundaries, not processed/total removal bytes. The same NSIS
instruction counter does not measure removal work. Leave uninstall indeterminate.

**Real extraction percentages are possible at the plug-in level, but unavailable
through this generated installer's supported lifecycle hooks.** Stop numeric work
at that boundary. No timer, stage weighting, directory polling, guessed count,
hardcoded percentage, or CSS-derived measurement was introduced.

The smallest future change is an upstream-supported extraction callback hook
covering both extraction calls while preserving electron-builder's existing
copy/retry/fallback behavior. That hook could call the installed callback API and
send real counts to `InstallerEngine` over secured local IPC. Otherwise a maintained
template fork or modified native extractor would be required, outside this task's
allowed boundary. Replacing electron-builder's installer is unnecessary.

Only after that hook exists should the typed event support finite, ranged,
monotonic percentages with operation/retry isolation. A measured 100% would mean
payload extraction only. Copying, registration, and authoritative postcondition
verification must remain visible finalization work; only existing native
completion checks may authorize success. There are deliberately no acceptance
tests for supported numeric events because numeric events are not implemented.
Existing tests reject every unsupported percentage, including 0, 43, and 100,
and retain failure, retry, and authoritative completion coverage.
