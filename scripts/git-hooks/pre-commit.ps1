[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }

    return @($output)
}

function Normalize-RepoPath {
    param([string]$Path)
    return $Path.Replace('\', '/')
}

$repoRootLines = Invoke-Git -Arguments @('rev-parse', '--show-toplevel')
$repoRoot = ($repoRootLines -join "`n").Trim()

if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    throw 'Could not resolve repository root.'
}

$stagedPaths = @(
    Invoke-Git -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMR', '--') |
        ForEach-Object { Normalize-RepoPath $_ } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

if ($stagedPaths.Count -eq 0) {
    Write-Host '[pre-commit] No staged files to format.'
    exit 0
}

$unstagedPaths = @(
    Invoke-Git -Arguments @('diff', '--name-only', '--diff-filter=ACMR', '--') |
        ForEach-Object { Normalize-RepoPath $_ } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

function Invoke-ProjectPrettier {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Project,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$RepoPaths
    )

    if ($RepoPaths.Count -eq 0) {
        return
    }

    $partiallyStaged = @(
        $RepoPaths | Where-Object { $unstagedPaths -contains $_ }
    )

    if ($partiallyStaged.Count -gt 0) {
        $listed = $partiallyStaged -join "`n  - "
        throw @"
[pre-commit] Refusing to auto-format partially staged files.

These files have both staged and unstaged changes:
  - $listed

Formatting the working-tree copy and re-staging it could accidentally include
your unstaged hunks. Commit or stash those hunks first, then retry.
"@
    }

    $projectRoot = Join-Path $repoRoot $Project
    $prettier = Join-Path $projectRoot 'node_modules\.bin\prettier.cmd'

    if (-not (Test-Path -LiteralPath $prettier -PathType Leaf)) {
        throw "[pre-commit] Missing $Project local Prettier. Run npm ci in '$projectRoot' first."
    }

    $prefixLength = $Project.Length + 1
    $relativePaths = @(
        $RepoPaths | ForEach-Object { $_.Substring($prefixLength) }
    )

    Push-Location $projectRoot
    try {
        Write-Host "[pre-commit] Checking staged $Project files with repo-local Prettier..."
        & $prettier --check --ignore-unknown @relativePaths
        $checkExit = $LASTEXITCODE

        if ($checkExit -eq 0) {
            Write-Host "[pre-commit] $Project staged files already formatted."
            return
        }

        Write-Host "[pre-commit] Formatting staged $Project files..."
        & $prettier --write --ignore-unknown @relativePaths
        if ($LASTEXITCODE -ne 0) {
            throw "[pre-commit] Prettier write failed for $Project."
        }

        & git -C $repoRoot add -- @RepoPaths
        if ($LASTEXITCODE -ne 0) {
            throw "[pre-commit] Could not re-stage formatted $Project files."
        }

        & $prettier --check --ignore-unknown @relativePaths
        if ($LASTEXITCODE -ne 0) {
            throw "[pre-commit] $Project files still fail Prettier after formatting."
        }

        Write-Host "[pre-commit] Formatted and re-staged $Project files."
    }
    finally {
        Pop-Location
    }
}

$desktopPaths = @($stagedPaths | Where-Object { $_.StartsWith('desktop/', [System.StringComparison]::OrdinalIgnoreCase) })
$webPaths = @($stagedPaths | Where-Object { $_.StartsWith('web/', [System.StringComparison]::OrdinalIgnoreCase) })

Invoke-ProjectPrettier -Project 'desktop' -RepoPaths $desktopPaths
Invoke-ProjectPrettier -Project 'web' -RepoPaths $webPaths

Write-Host '[pre-commit] Prettier guard passed.'
