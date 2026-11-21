$ErrorActionPreference = 'Stop'
$directory = [IO.Directory]::CreateTempSubdirectory('repoditor-probe-')
$assembly = Join-Path $directory.FullName 'TauriProbeInterop.dll'
try {
    Add-Type -LiteralPath (Join-Path $PSScriptRoot 'tauri-probe-interop.cs') -OutputAssembly $assembly
    $bytes = [IO.File]::ReadAllBytes($assembly)
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
    [Console]::WriteLine("${digest}:$([Convert]::ToBase64String($bytes))")
} finally {
    [IO.File]::Delete($assembly)
    $directory.Delete()
}
