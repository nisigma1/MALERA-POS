param([Parameter(Mandatory=$true)][string]$Root,[switch]$RequireSigned,[string]$ExpectedSigner=$env:FOX_SIGNER_SUBJECT)
$ErrorActionPreference='Stop'
# A PowerShell 7 CI parent can pass its module search path to Windows PowerShell.
# Import this built-in security module from the running shell's own installation.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$releasePath=(Resolve-Path -LiteralPath $Root).Path
$executables=Get-ChildItem -LiteralPath $releasePath -Recurse -File | Where-Object Extension -in '.exe','.dll','.node'
if (-not $executables) { throw 'No release executables' }
$results=@()
foreach ($binary in $executables) {
  $signature=Get-AuthenticodeSignature -LiteralPath $binary.FullName
  $record=[ordered]@{file=$binary.FullName.Substring($releasePath.Length+1);status=[string]$signature.Status;signer=$signature.SignerCertificate.Subject;timestamp=$signature.TimeStamperCertificate.Subject}
  $results+=$record
  if ($RequireSigned) {
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) { throw "Trusted timestamped signature missing: $($record.file)" }
    if ($binary.Name -eq 'FOX Kafeteri.exe' -or $binary.Name -like 'FOX-Setup-*' -or $binary.Name -like 'Uninstall*') {
      if (-not $ExpectedSigner -or $signature.SignerCertificate.Subject -ne $ExpectedSigner) { throw "Unexpected FOX signer: $($record.file)" }
    }
    $sdkTool=Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($sdkTool) { & $sdkTool.Source verify /pa /all $binary.FullName | Out-Null;if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $($record.file)" } }
  }
}
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releasePath 'signature-verification.json') -Encoding utf8
Write-Output "Inspected $($results.Count) executable signatures; required trusted signatures: $RequireSigned"
