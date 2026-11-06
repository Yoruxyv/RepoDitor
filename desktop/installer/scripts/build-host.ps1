param(
    [switch] $Sign
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sdkVersion = "1.0.4191.47"
$sdkSha256 = "F492BBF547D0DA329553B6727435B677579B1E9F91CC9E4A1AD029366D5F23D0"
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$buildRoot = Join-Path $desktopRoot "build\installer-host"
$uiBuildRoot = Join-Path $desktopRoot "build\installer-ui"
$dependencyRoot = Join-Path $desktopRoot "build\webview2-$sdkVersion"
$packagePath = Join-Path $desktopRoot "build\microsoft.web.webview2.$sdkVersion.nupkg"
$packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

Push-Location $desktopRoot
try {
    & npm.cmd run installer:ui:build
    if ($LASTEXITCODE -ne 0) {
        throw "RepoDitor installer UI build failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath (Join-Path $uiBuildRoot "index.html"))) {
    throw "The RepoDitor installer UI production output is missing."
}

if (-not (Test-Path -LiteralPath $packagePath)) {
    [IO.Directory]::CreateDirectory((Split-Path $packagePath -Parent)) | Out-Null
    Invoke-WebRequest -Uri $packageUrl -OutFile $packagePath
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $stream = [IO.File]::OpenRead($packagePath)
    try {
        $actualHash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
    }
    finally {
        $stream.Dispose()
    }
}
finally {
    $sha256.Dispose()
}

if ($actualHash -ne $sdkSha256) {
    throw "The Microsoft.Web.WebView2 $sdkVersion package hash is invalid."
}

if (-not (Test-Path -LiteralPath (Join-Path $dependencyRoot "lib\net462\Microsoft.Web.WebView2.Core.dll"))) {
    if (Test-Path -LiteralPath $dependencyRoot) {
        Remove-Item -LiteralPath $dependencyRoot -Recurse -Force
    }
    [IO.Directory]::CreateDirectory($dependencyRoot) | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $dependencyRoot)
}

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "The 64-bit .NET Framework C# compiler is required: $compiler"
}

$buildParent = [IO.Path]::GetFullPath((Join-Path $desktopRoot "build"))
$resolvedBuildRoot = [IO.Path]::GetFullPath($buildRoot)
if (-not $resolvedBuildRoot.StartsWith($buildParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean installer-host output outside the desktop build directory."
}
if (Test-Path -LiteralPath $resolvedBuildRoot) {
    Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
}
[IO.Directory]::CreateDirectory($resolvedBuildRoot) | Out-Null
$hostPath = Join-Path $buildRoot "RepoDitorInstallerHost.exe"
$coreAssembly = Join-Path $dependencyRoot "lib\net462\Microsoft.Web.WebView2.Core.dll"
$formsAssembly = Join-Path $dependencyRoot "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loader = Join-Path $dependencyRoot "build\native\x64\WebView2Loader.dll"
$license = Join-Path $dependencyRoot "LICENSE.txt"
$notice = Join-Path $dependencyRoot "NOTICE.txt"
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "../host") -Filter "*.cs" -File -Recurse |
    Sort-Object FullName | ForEach-Object FullName)
if ($sources.Count -eq 0) {
    throw "The RepoDitor installer host source set is empty."
}
$icon = Join-Path $desktopRoot "public\icon.ico"

& $compiler "/nologo" "/target:winexe" "/platform:x64" "/optimize+" `
    "/out:$hostPath" "/win32icon:$icon" `
    "/reference:$coreAssembly" "/reference:$formsAssembly" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\System.dll" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\System.Drawing.dll" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\System.Windows.Forms.dll" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll" `
    $sources
if ($LASTEXITCODE -ne 0) {
    throw "RepoDitorInstallerHost compilation failed with exit code $LASTEXITCODE."
}

Copy-Item -LiteralPath $coreAssembly -Destination $buildRoot -Force
Copy-Item -LiteralPath $formsAssembly -Destination $buildRoot -Force
Copy-Item -LiteralPath $loader -Destination $buildRoot -Force
Copy-Item -LiteralPath $license -Destination (Join-Path $buildRoot "Microsoft.Web.WebView2.LICENSE.txt") -Force
Copy-Item -LiteralPath $notice -Destination (Join-Path $buildRoot "Microsoft.Web.WebView2.NOTICE.txt") -Force
Get-ChildItem -LiteralPath $uiBuildRoot | Copy-Item -Destination $buildRoot -Recurse -Force
Copy-Item -LiteralPath $icon -Destination $buildRoot -Force

if ($Sign) {
    $required = @(
        "AZURE_ARTIFACT_SIGNING_ENDPOINT",
        "AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME",
        "AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME"
    )
    foreach ($name in $required) {
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
            throw "Signed installer-host builds require $name."
        }
    }

    if (-not (Get-Command Invoke-TrustedSigning -ErrorAction SilentlyContinue)) {
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser
        Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force -Repository PSGallery -Scope CurrentUser
    }

    Invoke-TrustedSigning `
        -Endpoint $env:AZURE_ARTIFACT_SIGNING_ENDPOINT `
        -CodeSigningAccountName $env:AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME `
        -CertificateProfileName $env:AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME `
        -FileDigest SHA256 `
        -TimestampDigest SHA256 `
        -TimestampRfc3161 "http://timestamp.acs.microsoft.com" `
        -Files $hostPath
}

Write-Output $hostPath
