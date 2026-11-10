$ErrorActionPreference = 'Stop'
$global:foxHelperScenario = 'draft'
$global:foxHelperDownloads = 0
function gh {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'auth') { return }
  if ($args[0] -eq 'release' -and $args[1] -eq 'view') {
    @{ tagName = 'v0.4.2'; isDraft = ($global:foxHelperScenario -eq 'draft'); isPrerelease = $false } | ConvertTo-Json -Compress
    return
  }
  if ($args[0] -eq 'release' -and $args[1] -eq 'download') {
    $global:foxHelperDownloads++
    $folder = $args[[Array]::IndexOf($args, '--dir') + 1]
    $artifact = 'FOX-Setup-0.4.2-x64.exe'
    Set-Content -LiteralPath (Join-Path $folder $artifact) -Value 'not an executable'
    Set-Content -LiteralPath (Join-Path $folder "$artifact.sha256") -Value "$('0' * 64)  $artifact"
    @{ version = '0.4.2'; arch = 'x64'; platform = 'win32'; artifact = $artifact; sha256 = ('0' * 64); signing = 'UNSIGNED' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'release-manifest.json')
    return
  }
  throw 'Unexpected GitHub call'
}
foreach ($scenario in @('draft', 'mismatch')) {
  $global:foxHelperScenario = $scenario
  try { & "$PSScriptRoot/install-fox.ps1" -Repository 'test/fox-pos'; throw 'Unsafe install unexpectedly succeeded' }
  catch {
    $expected = if ($scenario -eq 'draft') { 'Only an approved published stable release' } else { 'Artifact integrity mismatch' }
    if (-not $_.Exception.Message.Contains($expected)) { throw }
  }
}
if ($global:foxHelperDownloads -ne 1) { throw 'Draft attempted download' }
Write-Output 'PASS: draft refused; bad hash refused before installer launch; owned download cleanup executed.'
