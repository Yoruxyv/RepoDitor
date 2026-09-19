[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    throw '[pre-push] Could not resolve repository root.'
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npm) {
    throw '[pre-push] npm.cmd was not found on PATH.'
}

function Invoke-FormatCheck {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Project
    )

    $projectRoot = Join-Path $repoRoot $Project
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container)) {
        throw "[pre-push] Missing $Project/node_modules. Run npm ci in '$projectRoot' first."
    }

    Push-Location $projectRoot
    try {
        Write-Host "[pre-push] Running $Project npm run format:check..."
        & npm.cmd run format:check
        if ($LASTEXITCODE -ne 0) {
            throw @"
[pre-push] $Project formatting check failed.

The push was blocked before anything was sent.
Run:
  Set-Location '$projectRoot'
  npm.cmd run format

Then review the changes, commit them, and push again.
"@
        }
    }
    finally {
        Pop-Location
    }
}

Invoke-FormatCheck -Project 'desktop'
Invoke-FormatCheck -Project 'web'

Write-Host '[pre-push] Desktop and Web Prettier checks passed.'
