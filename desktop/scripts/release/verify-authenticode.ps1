<#
.SYNOPSIS
Fails unless every supplied Windows artifact has a valid expected Authenticode signer.

.DESCRIPTION
Used after official release signing and before checksum publication. The publisher is
an explicit workflow input; this script never obtains or handles signing credentials.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Path,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExpectedPublisher
)

$ErrorActionPreference = "Stop"

foreach ($candidate in $Path) {
    $file = Get-Item -LiteralPath $candidate -ErrorAction Stop
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName

    if ($null -eq $signature.SignerCertificate) {
        throw "$($file.Name) has no Authenticode signer certificate."
    }
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "$($file.Name) has invalid Authenticode status: $($signature.Status)."
    }

    $publisher = $signature.SignerCertificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
        $false
    )
    if ($publisher -cne $ExpectedPublisher) {
        throw "$($file.Name) publisher does not match the expected release publisher."
    }

    Write-Host "$($file.Name): valid Authenticode signature from $publisher."
}
