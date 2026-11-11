param([string]$Interop)
if ($Interop.Length -gt 16384 -or $Interop -cnotmatch '\A([A-F0-9]{64}):([A-Za-z0-9+/]+={0,2})\z') {
    throw 'Prepared Windows probe assembly is missing or invalid'
}
$assemblyBytes = [Convert]::FromBase64String($Matches[2])
if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($assemblyBytes)) -cne $Matches[1]) {
    throw 'Prepared Windows probe assembly digest mismatch'
}
[void][Reflection.Assembly]::Load($assemblyBytes)
