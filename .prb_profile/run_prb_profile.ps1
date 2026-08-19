$ErrorActionPreference = 'Stop'

$repo = (Get-Location).Path
if (-not (Test-Path (Join-Path $repo 'desktop\package.json'))) {
    throw 'Run this from the RepoDitor repository root.'
}

$python = Join-Path $repo '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "RepoDitor Python environment is missing: $python" }

$profileDir = Join-Path $repo 'local-evidence'
$profileFile = Join-Path $profileDir 'prb-recharge-profile.jsonl'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Remove-Item $profileFile -Force -ErrorAction SilentlyContinue

$oldEnabled = $env:REPODITOR_PROFILE_RECHARGE
$oldFile = $env:REPODITOR_RECHARGE_PROFILE_FILE
try {
    $env:REPODITOR_PROFILE_RECHARGE = '1'
    $env:REPODITOR_RECHARGE_PROFILE_FILE = $profileFile

    Push-Location (Join-Path $repo 'desktop')
    try {
        npx tsc -p tsconfig.electron.json
        if ($LASTEXITCODE -ne 0) { throw 'Electron TypeScript compilation failed.' }
        npm run typecheck:e2e
        if ($LASTEXITCODE -ne 0) { throw 'E2E typecheck failed.' }
        npx playwright test e2e/prb-recharge-profile.spec.ts --workers=1
        if ($LASTEXITCODE -ne 0) { throw 'PR B profiling capture failed.' }
    }
    finally { Pop-Location }

    & $python (Join-Path $repo '.prb_profile\report.py') $profileFile
    if ($LASTEXITCODE -ne 0) { throw 'PR B profile report failed.' }
    Write-Host "`nRaw evidence: $profileFile"
}
finally {
    if ($null -eq $oldEnabled) { Remove-Item Env:REPODITOR_PROFILE_RECHARGE -ErrorAction SilentlyContinue }
    else { $env:REPODITOR_PROFILE_RECHARGE = $oldEnabled }
    if ($null -eq $oldFile) { Remove-Item Env:REPODITOR_RECHARGE_PROFILE_FILE -ErrorAction SilentlyContinue }
    else { $env:REPODITOR_RECHARGE_PROFILE_FILE = $oldFile }
}
