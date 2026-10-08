param([Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository, [string]$Tag)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') { throw 'Requires Windows x64' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Use the downloaded installer, or install and authenticate GitHub CLI first.' }
gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication is required' }
$argsForView = @('release','view','--repo',$Repository,'--json','tagName,isDraft,isPrerelease')
if ($Tag) { $argsForView += $Tag }
$release = (& gh @argsForView | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $release.isDraft -or $release.isPrerelease) { throw 'Only an approved published stable release can be installed' }
$version = $release.tagName -replace '^v',''
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid stable release version' }
$folder = Join-Path ([IO.Path]::GetTempPath()) ('fox-install-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $folder | Out-Null
try {
  gh release download $release.tagName --repo $Repository --dir $folder --pattern "FOX-Setup-$version-x64.exe" --pattern "FOX-Setup-$version-x64.exe.sha256" --pattern 'release-manifest.json'
  if ($LASTEXITCODE -ne 0) { throw 'Release download failed' }
  $artifact = "FOX-Setup-$version-x64.exe"
  $installer = Join-Path $folder $artifact
  $manifest = Get-Content -LiteralPath (Join-Path $folder 'release-manifest.json') -Raw | ConvertFrom-Json
  $checksum = (Get-Content -LiteralPath "$installer.sha256" -Raw).Trim()
  $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifest.version -ne $version -or $manifest.arch -ne 'x64' -or $manifest.platform -ne 'win32' -or $manifest.artifact -ne $artifact -or $manifest.sha256 -ne $hash -or $checksum -ne "$hash  $artifact") { throw 'Artifact integrity mismatch; installer was not run' }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($manifest.signing -eq 'SIGNED' -and $signature.Status -ne 'Valid') { throw 'Signing verification failed' }
  if ($manifest.signing -ne 'SIGNED') { Write-Warning 'UNSIGNED installer: Windows may show Unknown Publisher or SmartScreen. Follow your security policy.' }
  $process = Start-Process -FilePath $installer -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  Write-Output "FOX $version installed. Open FOX Kafeteri from Start Menu."
} finally {
  $resolved = [IO.Path]::GetFullPath($folder)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'fox-install-*') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
