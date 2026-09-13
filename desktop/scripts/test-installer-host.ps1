$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $desktopRoot 'build'))
$checkRoot = [IO.Path]::GetFullPath((Join-Path $buildRoot "installer-checks-$([Guid]::NewGuid().ToString('N'))"))
if (-not $checkRoot.StartsWith($buildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Native check fixtures must stay inside desktop/build.'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources = @(
    (Join-Path $desktopRoot 'installer\host\Arguments.cs'),
    (Join-Path $desktopRoot 'installer\host\InstallerEngine.cs'),
    (Join-Path $desktopRoot 'installer\host\ParentProcessSynchronizer.cs'),
    (Join-Path $desktopRoot 'installer\tests\InstallerEngineChecks.cs')
)
New-Item -ItemType Directory -Path $checkRoot | Out-Null
try {
    $executable = Join-Path $checkRoot 'InstallerEngineChecks.exe'
    & $compiler /nologo /target:exe /platform:x64 "/out:$executable" $sources
    if ($LASTEXITCODE -ne 0) { throw "Native check compilation failed: $LASTEXITCODE" }
    & $executable
    if ($LASTEXITCODE -ne 0) { throw "Native installer checks failed: $LASTEXITCODE" }
}
finally {
    Remove-Item -LiteralPath $checkRoot -Recurse -Force
}
