param([string]$Version, [string]$Directory = 'release')
$ErrorActionPreference = 'Stop'
if (-not $Version) { $Version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version }
node scripts/verify-release.mjs $Version $Directory
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed' }
$artifact = Join-Path $Directory "FOX-Setup-$Version-x64.exe"
$manifest = Get-Content -LiteralPath (Join-Path $Directory 'release-manifest.json') -Raw | ConvertFrom-Json
$signature = Get-AuthenticodeSignature -LiteralPath $artifact
if ($manifest.signing -eq 'SIGNED' -and $signature.Status -ne 'Valid') { throw 'Claimed signed release has no valid installer signature' }
if ($signature.Status -eq 'Valid') { if ($manifest.channel -eq 'QA') { throw 'QA stamp does not match signed installer' } }
elseif ($signature.Status -eq 'NotSigned') { if ($manifest.channel -ne 'QA') { throw 'Unsigned official release refused' } }
else { throw "Invalid installer signature: $($signature.Status)" }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Directory 'release-manifest.json') -Encoding utf8
Write-Output "Verified $artifact; $($manifest.signing)"
