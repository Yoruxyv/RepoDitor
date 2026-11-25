$ErrorActionPreference = 'Stop'
$desktop = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$config = Get-Content (Join-Path $desktop 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a three-part release version.' }
$bundle = Join-Path $desktop "src-tauri/target/release/bundle/nsis/$($config.productName)_${version}_x64-setup.exe"
$portable = Join-Path $desktop "build/tauri-release/$($config.mainBinaryName).exe"
$checked = Get-Content (Join-Path $desktop 'build/tauri-release/artifact-check.json') -Raw | ConvertFrom-Json
if ($checked.authority -ne 'public-editing' -or (Get-FileHash -LiteralPath $portable).Hash -ne $checked.hostSha256) {
    throw 'The portable executable does not match the verified staging receipt.'
}
$nativeHost = Join-Path $desktop "src-tauri/target/release/$($config.mainBinaryName).exe"
$backend = Join-Path $desktop 'build/backend/repoditor-backend/repoditor-backend.exe'
if ((Get-FileHash -LiteralPath $nativeHost).Hash -ne $checked.hostSha256 -or
    (Get-FileHash -LiteralPath $backend).Hash -ne $checked.backendSha256) {
    throw 'The NSIS bundle inputs do not match the checked portable payload.'
}
foreach ($file in @($bundle, $portable)) {
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($file)
    if ($info.ProductVersion -notin @($version, "$version.0") -or
        $info.ProductName -cne $config.productName -or
        (Get-AuthenticodeSignature -LiteralPath $file).Status -ne 'NotSigned') {
        throw "Unexpected version, product identity or signature status for $(Split-Path $file -Leaf)."
    }
}
$directory = Join-Path $desktop 'build/installer'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$sevenZip = $env:REPODITOR_7ZIP_EXE
if (!$sevenZip) {
    $sevenZip = (Get-Command 7z.exe -CommandType Application -ErrorAction SilentlyContinue).Source
}
if (!$sevenZip) { $sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe' }
if (!(Test-Path -LiteralPath $sevenZip -PathType Leaf)) {
    throw '7-Zip is required to verify the NSIS archive. Set REPODITOR_7ZIP_EXE to its executable.'
}
$installerHost = Join-Path $desktop 'build/installer-host/RepoDitorInstallerHost.exe'
$payload = [ordered]@{
    "$($config.mainBinaryName).exe" = $checked.hostSha256
    'backend\repoditor-backend.exe' = $checked.backendSha256
    '$PLUGINSDIR\RepoDitor\RepoDitorInstallerHost.exe' = (Get-FileHash -LiteralPath $installerHost).Hash
}
$inspection = New-Item -ItemType Directory -Path (Join-Path $directory ".verify-$([guid]::NewGuid())")
try {
    $members = @($payload.Keys)
    & $sevenZip x -y -spd $bundle "-o$($inspection.FullName)" @members | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the NSIS release payload.' }
    foreach ($member in $members) {
        $archived = Join-Path $inspection.FullName $member
        if (!(Test-Path -LiteralPath $archived -PathType Leaf) -or
            (Get-FileHash -LiteralPath $archived).Hash -ne $payload[$member]) {
            throw "The installer contains a different $member than the verified release inputs."
        }
    }
} finally {
    $resolved = (Resolve-Path -LiteralPath $inspection.FullName).Path
    $parent = (Resolve-Path -LiteralPath $directory).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $parent -and $resolved -eq $inspection.FullName) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
$fileName = "RepoDitor-Setup-$version-x64.exe"
$setup = Join-Path $directory $fileName
Copy-Item -LiteralPath $bundle -Destination $setup -Force
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $fileName" | Set-Content -LiteralPath "$setup.sha256" -Encoding ascii
Write-Output "Staged unsigned $setup"
Write-Output "SHA-256 $hash"
