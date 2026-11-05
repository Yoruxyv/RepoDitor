param(
    [string]$OutputDirectory = 'build/tauri-safety',
    [string]$NormalBackend = '',
    [string]$FaultBackend = '',
    [switch]$CompareStartup,
    [switch]$TestBrowserArgs
)
$ErrorActionPreference = 'Stop'
$desktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repository = [IO.Path]::GetFullPath((Join-Path $desktop '..'))
$output = [IO.Path]::GetFullPath((Join-Path $desktop $OutputDirectory))
$build = Join-Path $desktop 'build'
if (-not $IsWindows) { throw 'The Tauri safety gate requires Windows.' }
if ($CompareStartup -and $TestBrowserArgs) { throw 'Select one startup test mode.' }
if (-not $output.StartsWith("$build\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be inside desktop/build.' }
if (Test-Path -LiteralPath $output) { throw 'Use a fresh output directory; previous diagnostics are preserved.' }
$nativeName = [IO.Path]::GetRelativePath($build, $output).Replace('\', '-')
$nativeOutput = Join-Path $build "recovery-checkpoint/$nativeName"
if (Test-Path -LiteralPath $nativeOutput) { throw 'Native output already exists; use a fresh output directory.' }
New-Item -ItemType Directory -Path $output | Out-Null

function Run-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
function Build-Host([string]$Name, [string]$Features, [bool]$TestPermissions, [bool]$BrowserArgs = $false) {
    $env:TAURI_CONFIG = if ($TestPermissions) { Get-Content -LiteralPath 'src-tauri/recovery.test.conf.json' -Raw } else { $null }
    $hostFeatures = 'tauri/custom-protocol'
    if ($Features) { $hostFeatures += ",$Features" }
    if ($BrowserArgs) {
        $hostFeatures += ',native-ui-test'
        $configuration = if ($TestPermissions) { Get-Content -LiteralPath 'src-tauri/recovery.test.conf.json' -Raw | ConvertFrom-Json } else { [pscustomobject]@{ app = [pscustomobject]@{} } }
        $browser = Get-Content -LiteralPath 'src-tauri/startup.test.conf.json' -Raw | ConvertFrom-Json
        $configuration.app | Add-Member -NotePropertyName windows -NotePropertyValue $browser.app.windows
        $env:TAURI_CONFIG = $configuration | ConvertTo-Json -Depth 12 -Compress
    }
    $arguments = @('build', '--manifest-path', 'src-tauri/Cargo.toml', '--release', '--locked', '--features', $hostFeatures)
    Run-Checked 'cargo' $arguments
    $folder = Join-Path $output "hosts/$Name"
    New-Item -ItemType Directory -Path $folder | Out-Null
    Copy-Item -LiteralPath 'src-tauri/target/release/repoditor-preview.exe' -Destination $folder
    return (Join-Path $folder 'repoditor-preview.exe')
}

$previousConfig = $env:TAURI_CONFIG
$previousBrowserArgs = $env:REPODITOR_NATIVE_BROWSER_ARGS
Push-Location $desktop
Start-Transcript -Path (Join-Path $output 'validation.log') | Out-Null
try {
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:TAURI_CONFIG = $null
    $env:REPODITOR_NATIVE_BROWSER_ARGS = $null
    # Initialize the diagnostic provider before the bounded per-host process snapshot.
    Get-CimInstance Win32_Process -Filter "ProcessId = $PID" | Out-Null
    # Even cargo test validates the configured resource; rebuild it before any Rust compile.
    Run-Checked 'npm' @('run', 'build:sidecar')
    if (-not $NormalBackend) { $NormalBackend = 'build/backend/repoditor-backend' }
    Run-Checked 'npm' @('run', 'build:tauri-ui')
    $env:REPODITOR_RECOVERY_DEFAULT_EXECUTABLE = Build-Host 'default' '' $false (-not $CompareStartup.IsPresent)
    $env:REPODITOR_ARTIFACT_BACKEND = [IO.Path]::GetFullPath($NormalBackend, $desktop)
    $env:REPODITOR_NATIVE_OUTPUT = Join-Path $nativeOutput 'startup'
    $env:REPODITOR_NATIVE_REPORT = Join-Path $output 'startup.json'
    Run-Checked 'npm' @('run', 'typecheck:e2e')
    if (-not $CompareStartup) { $env:REPODITOR_NATIVE_BROWSER_ARGS = '1' }
    if ($TestBrowserArgs) {
        Run-Checked 'npx' @('--no-install', 'playwright', 'test', 'e2e/tauri-startup.spec.ts', '--config', 'playwright.tauri-safety.config.ts', '--grep', 'startup ordinary')
        $startup = Get-Content -LiteralPath $env:REPODITOR_NATIVE_REPORT -Raw | ConvertFrom-Json
        if ($startup.stats.skipped -ne 0 -or $startup.stats.expected -ne 1) { throw 'The ordinary browser-arguments control did not pass.' }
        return
    }
    if ($CompareStartup) {
        # Diagnostic-only dispatch: one immutable ordinary host, fresh profiles per comparison.
        $env:REPODITOR_STARTUP_COMPARISON_EXECUTABLE = $env:REPODITOR_RECOVERY_DEFAULT_EXECUTABLE
        New-Item -ItemType Junction -Path (Join-Path (Split-Path $env:REPODITOR_RECOVERY_DEFAULT_EXECUTABLE) 'backend') -Target $env:REPODITOR_ARTIFACT_BACKEND | Out-Null
        Run-Checked 'npx' @('--no-install', 'playwright', 'test', '--config', 'playwright.tauri-startup.config.ts')
        $comparisons = @(Get-ChildItem -LiteralPath $env:REPODITOR_NATIVE_OUTPUT -Filter 'comparison.json' -Recurse | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
        if ($comparisons.Count -ne 6) { throw 'Controlled comparisons were not all collected.' }
        $comparisons | Select-Object mode, ready | ConvertTo-Json | Write-Host
        if (@($comparisons | Where-Object ready).Count -eq 0) { throw 'No controlled startup variant exposed a bridge. Full safety validation has not run.' }
        return
    }
    # Prove ordinary packaged startup before constructing or launching the synthetic matrix.
    Run-Checked 'npx' @('--no-install', 'playwright', 'test', 'e2e/tauri-startup.spec.ts', '--config', 'playwright.tauri-safety.config.ts')
    $startup = Get-Content -LiteralPath $env:REPODITOR_NATIVE_REPORT -Raw | ConvertFrom-Json
    if ($startup.stats.skipped -ne 0 -or $startup.stats.expected -ne 5) { throw 'Required startup controls did not all pass.' }
    $env:TAURI_CONFIG = $null
    Run-Checked 'uv' @('run', '--locked', '--no-sync', '--project', $repository, '--group', 'test', 'pytest', '-q', '-rs',
        '../desktop/python/tests/core', '../desktop/python/tests/storage', '../desktop/python/tests/desktop_api',
        '../desktop/python/tests/services/test_installed_build.py',
        '--basetemp', (Join-Path $output 'python-fixtures'), '-o', "cache_dir=$output/pytest-cache", '--junitxml', (Join-Path $output 'python.xml'))
    [xml]$python = Get-Content -LiteralPath (Join-Path $output 'python.xml') -Raw
    if ($python.SelectNodes('//testcase/skipped').Count -ne 0) { throw 'Mandatory Windows save-integrity tests were skipped.' }
    foreach ($suite in @('test_windows_save_directory', 'test_writer_coordination', 'test_health_recovery', 'test_save_writes', 'test_cosmetics', 'test_health_receipts', 'test_numeric_integrity', 'test_installed_build', 'test_health_ui', 'test_save_resources', 'test_resource_recovery', 'test_upgrade_transactions')) {
        if ($python.SelectNodes("//testcase[contains(@classname,'$suite')]").Count -eq 0) { throw "Required suite was not collected: $suite" }
    }
    Run-Checked 'cargo' @('fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check')
    Run-Checked 'cargo' @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked')
    Run-Checked 'cargo' @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-features')
    Run-Checked 'cargo' @('build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked')
    $env:REPODITOR_ARTIFACT_HOST = Build-Host 'production' '' $false
    $env:REPODITOR_RECOVERY_EXECUTABLE = Build-Host 'protocol' 'synthetic-health-recovery' $true $true
    $env:REPODITOR_SAFETY_NO_ACL_HOST = Build-Host 'no-acl' 'synthetic-health-recovery' $false $true
    $env:REPODITOR_SAFETY_UI_HOST = Build-Host 'ui' 'synthetic-health-ui' $true $true
    $env:TAURI_CONFIG = $null

    $packageArguments = @('run', '--locked', '--no-sync', '--project', $repository, '--group', 'package', 'pyinstaller',
        '--noconfirm', '--onedir', '--console', '--name', 'repoditor-backend', '--paths', 'python',
        '--collect-all', 'UnityPy', '--collect-all', 'TypeTreeGeneratorAPI', '--collect-all', 'fmod_toolkit',
        '--collect-data', 'archspec', '--hidden-import', 'addressablestools', '--copy-metadata', 'addressablestools')
    if (-not $FaultBackend) {
        Run-Checked 'uv' ($packageArguments + @('--distpath', "$output/fault-backend", '--workpath', "$output/fault-work", '--specpath', "$output/fault-spec", '--hidden-import', 'repo_save_editor.desktop_api.__main__', 'e2e/support/recovery-sidecar.py'))
        $FaultBackend = "$output/fault-backend/repoditor-backend"
    }
    $env:REPODITOR_ARTIFACT_BROWSER_TEST_HOST = $env:REPODITOR_RECOVERY_DEFAULT_EXECUTABLE
    $env:REPODITOR_ARTIFACT_SYNTHETIC_HOST = $env:REPODITOR_SAFETY_UI_HOST
    $env:REPODITOR_ARTIFACT_FAULT_BACKEND = [IO.Path]::GetFullPath($FaultBackend, $desktop)
    $env:REPODITOR_ARTIFACT_OUTPUT = Join-Path $output 'artifact-tests'
    $env:REPODITOR_RECOVERY_BACKEND = $env:REPODITOR_ARTIFACT_FAULT_BACKEND
    $env:REPODITOR_NATIVE_OUTPUT = Join-Path $nativeOutput 'matrix'
    $env:REPODITOR_NATIVE_REPORT = Join-Path $output 'native.json'
    Run-Checked 'npm' @('run', 'test:tauri-artifacts')
    Run-Checked 'npx' @('--no-install', 'playwright', 'test', 'e2e/tauri-recovery.spec.ts', 'e2e/tauri-safety.spec.ts', 'e2e/tauri-upgrade-drafts.spec.ts', '--config', 'playwright.tauri-safety.config.ts')
    $native = Get-Content -LiteralPath $env:REPODITOR_NATIVE_REPORT -Raw | ConvertFrom-Json
    if ($native.stats.skipped -ne 0 -or $native.stats.expected -eq 0) { throw 'Native safety cases were skipped or not collected.' }
    $titles = @($native.suites.specs.title)
    foreach ($case in @(
        'final running: frozen Python blocks unsafe replacement',
        'final unknown: frozen Python blocks unsafe replacement',
        'REPODITOR_RECOVERY_DEFAULT_EXECUTABLE: full synthetic environment cannot grant missing authority',
        'REPODITOR_SAFETY_NO_ACL_HOST: full synthetic environment cannot grant missing authority',
        'explicit synthetic UI retains its authorized health and recovery behavior',
        'two native hosts serialize writers and reconcile cancellation',
        'a replaced parent remains conflicting across frozen process handoff',
        'frozen numeric rejection preserves original bytes and pending evidence',
        'known builds remain unsupported and missing provenance remains unknown',
        'offline recovery preserves conflict evidence and restores exact backup bytes',
        'legacy receipt 1 remains blocked without rewriting namespace evidence',
        'legacy receipt 2 remains blocked without rewriting namespace evidence',
        'synthetic upgrade drafts review and revert without writing save or receipt bytes',
        'upgrade drafts block partial health Save until explicitly reverted',
        'ordinary artifact retains read-only upgrades with no draft controls',
        'ordinary frozen reads reject oversized Run and MetaSave inputs',
        'frozen recovery preserves oversized backup and pending evidence',
        'synthetic upgrade batch Save reopens persisted values and Revert keeps them',
        'upgrade writer termination at before_replace reconciles without partial edits',
        'upgrade writer termination at after_replace reconciles without partial edits',
        'upgrade intent survives lost response and interrupted recovery across host handoff',
        'native upgrades reject forged values and previous open-session requests',
        'final unknown game state blocks the entire upgrade batch with recovery evidence'
    )) {
        if ($case -notin $titles) { throw "Required native case was not collected: $case" }
    }
} finally {
    $env:TAURI_CONFIG = $previousConfig
    $env:REPODITOR_NATIVE_BROWSER_ARGS = $previousBrowserArgs
    Stop-Transcript | Out-Null
    Pop-Location
}
