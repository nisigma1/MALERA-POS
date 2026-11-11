param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted'){
  throw 'Default-path installer verification is restricted to disposable hosted QA'
}
$installerFile=(Resolve-Path -LiteralPath $Installer).Path
$install=Join-Path $env:LOCALAPPDATA 'Programs\FOX Kafeteri'
$broker=Join-Path $env:LOCALAPPDATA 'MALERA Update'
$data=Join-Path $env:APPDATA 'FOX Kafeteri'
$link=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'MALERA POS.lnk'
foreach($ownedPath in @($install,$broker,$data,$link)){
  if(Test-Path -LiteralPath $ownedPath){throw 'Expected a clean Windows QA account'}
}
$client=Join-Path $broker 'client.mjs'
$launcher=Join-Path $broker 'launch.vbs'
$state=Join-Path $broker 'state.json'
$config=Join-Path $broker 'config.json'
$shell=New-Object -ComObject WScript.Shell
$scriptHost=Join-Path $env:WINDIR 'System32\wscript.exe'
New-Item -ItemType Directory -Path (Join-Path $broker 'runtime') | Out-Null
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $broker 'runtime\node.exe')
Set-Content -LiteralPath $launcher -Value "' Synthetic broker registration for installer QA" -Encoding ASCII
Set-Content -LiteralPath $client -Value '// old broker' -Encoding ASCII
Set-Content -LiteralPath $state -Value '{"version":"qa-before-update"}' -Encoding ASCII
Set-Content -LiteralPath $config -Value '{"repository":"nisigma1/MALERA-POS","branch":"main","allowUnsignedQA":true}' -Encoding ASCII
$stateHash=(Get-FileHash -LiteralPath $state).Hash
$configHash=(Get-FileHash -LiteralPath $config).Hash
$launcherHash=(Get-FileHash -LiteralPath $launcher).Hash
$shortcut=$shell.CreateShortcut($link)
$shortcut.TargetPath=$scriptHost
$shortcut.Arguments='"'+$launcher+'"'
$shortcut.IconLocation=$scriptHost+',0'
$shortcut.Save()
$installation=Start-Process -FilePath $installerFile -ArgumentList @('/currentuser','/S',('/D='+$install)) -WindowStyle Hidden -Wait -PassThru
if($installation.ExitCode -ne 0){throw "Default-path installer exit $($installation.ExitCode)"}
$installedClient=Join-Path $install 'resources\malera-update-client.mjs'
if((Get-FileHash -LiteralPath $client).Hash -ne (Get-FileHash -LiteralPath $installedClient).Hash){throw 'Installer did not replace the registered broker'}
if((Get-FileHash -LiteralPath $state).Hash -ne $stateHash -or
   (Get-FileHash -LiteralPath $config).Hash -ne $configHash -or
   (Get-FileHash -LiteralPath $launcher).Hash -ne $launcherHash){throw 'Installer changed registration state'}
$icon=Join-Path $install 'resources\duo-bar.ico'
$shortcut=$shell.CreateShortcut($link)
if($shortcut.TargetPath -ne $scriptHost -or $shortcut.Arguments -ne ('"'+$launcher+'"') -or
   $shortcut.IconLocation -ne ($icon+',0')){throw 'DUO shortcut did not preserve the registered launcher and refresh its icon'}
if((Get-FileHash -LiteralPath $icon).Hash -ne (Get-FileHash -LiteralPath 'build/duo-bar.ico').Hash){throw 'Installed shortcut icon does not match DUO source'}
if(Test-Path -LiteralPath $data){throw 'Installer touched the application data path'}
& (Join-Path $broker 'runtime\node.exe') $client --status
if($LASTEXITCODE -ne 0){throw 'Installed broker is not executable without its previous modules'}
Write-Output 'PASS: installed broker replaced; registration state unchanged; actual DUO shortcut verified; app data untouched.'
