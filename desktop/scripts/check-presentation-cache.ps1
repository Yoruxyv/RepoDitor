[CmdletBinding()]
param(
    [Parameter()]
    [string] $CachePath = (Join-Path $env:APPDATA "repoditor-desktop\presentation")
)

$ErrorActionPreference = "Stop"
$artifactPattern = '^[a-f0-9]{64}\.png$'
$manifestPath = Join-Path $CachePath "manifest.json"

if (-not (Test-Path -LiteralPath $CachePath -PathType Container)) {
    Write-Host "RepoDitor presentation cache does not exist: $CachePath"
    Write-Host "Cache audit passed (nothing cached)."
    exit 0
}

$artifacts = @(
    Get-ChildItem -LiteralPath $CachePath -File |
        Where-Object { $_.Name -match $artifactPattern } |
        Select-Object -ExpandProperty Name
)

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Write-Error "manifest.json is missing while $($artifacts.Count) derived PNG(s) exist."
    exit 1
}

try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
} catch {
    Write-Error "manifest.json could not be parsed: $($_.Exception.Message)"
    exit 1
}

$referenced = @(
    $manifest.entries.PSObject.Properties |
        ForEach-Object { "$($_.Value.sourceIdentity).png" } |
        Sort-Object -Unique
)
$manifestEntryCount = @($manifest.entries.PSObject.Properties).Count
$orphans = @($artifacts | Where-Object { $_ -notin $referenced })
$missing = @($referenced | Where-Object { -not (Test-Path -LiteralPath (Join-Path $CachePath $_) -PathType Leaf) })

Write-Host "RepoDitor presentation cache audit"
Write-Host "Path                 $CachePath"
Write-Host "Manifest entries     $manifestEntryCount"
Write-Host "Referenced PNGs      $($referenced.Count)"
Write-Host "Stored hash PNGs     $($artifacts.Count)"
Write-Host "Unreferenced PNGs    $($orphans.Count)"
Write-Host "Missing PNGs         $($missing.Count)"

if ($orphans.Count -gt 0) {
    Write-Host "`nUnreferenced derived PNGs:" -ForegroundColor Yellow
    $orphans | ForEach-Object { Write-Host "  $_" }
}
if ($missing.Count -gt 0) {
    Write-Host "`nManifest entries with missing PNGs:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  $_" }
}

if ($orphans.Count -gt 0 -or $missing.Count -gt 0) {
    Write-Error "Cache audit failed. Start RepoDitor once with the fix, then run this script again."
    exit 1
}

Write-Host "Cache audit passed. No duplicate/orphaned derived PNGs were found." -ForegroundColor Green
