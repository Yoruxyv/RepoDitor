[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    throw 'Run this script from inside the RepoDitor checkout.'
}

$requiredHooks = @(
    '.githooks/pre-commit',
    '.githooks/pre-push',
    'scripts/git-hooks/pre-commit.ps1',
    'scripts/git-hooks/pre-push.ps1'
)

foreach ($relativePath in $requiredHooks) {
    $fullPath = Join-Path $repoRoot ($relativePath.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Required hook file is missing: $relativePath"
    }
}

$existing = (& git config --local --get core.hooksPath 2>$null)
if ($LASTEXITCODE -ne 0) {
    $existing = $null
}

if (-not [string]::IsNullOrWhiteSpace($existing) -and $existing.Trim() -ne '.githooks') {
    throw "core.hooksPath is already '$($existing.Trim())'. Refusing to replace it automatically."
}

& git config --local core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to configure core.hooksPath.'
}

Write-Host 'RepoDitor Git hooks enabled: core.hooksPath=.githooks'
Write-Host 'pre-commit: checks staged Desktop/Web files, formats only when needed, and re-stages them.'
Write-Host 'pre-push: runs the full Desktop and Web npm run format:check gates.'
