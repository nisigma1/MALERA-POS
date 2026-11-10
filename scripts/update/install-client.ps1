param(
 [string]$Repository='nisigma1/MALERA-POS',
 [string]$Branch='main',
 [string]$NodePath,
 [string]$InstalledCommit='4e41058da32d6ddb54e9ebdb8b18b65f02ad7d7d',
 [string]$InstalledVersion='0.7.2-rc.4'
)
$ErrorActionPreference='Stop'
if($Repository -notmatch '^[\w.-]+/[\w.-]+$' -or $InstalledCommit -notmatch '^[a-f0-9]{40}$'){throw 'Invalid repository or installed commit'}
if(!$NodePath){$NodePath=(Get-Command node.exe -ErrorAction Stop).Source}
if(!(Test-Path -LiteralPath $NodePath)){throw 'Node runtime missing'}
$app=Join-Path $env:LOCALAPPDATA 'Programs\FOX Kafeteri\FOX Kafeteri.exe'
if(!(Test-Path -LiteralPath $app)){throw 'Install the POS before registering updates'}
$homeDir=Join-Path $env:LOCALAPPDATA 'MALERA Update'
New-Item -ItemType Directory -Path $homeDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $homeDir 'runtime') -Force | Out-Null
$runtime=Join-Path $homeDir 'runtime\node.exe'
if(!(Test-Path -LiteralPath $runtime) -or (Get-FileHash -LiteralPath $NodePath).Hash -ne (Get-FileHash -LiteralPath $runtime).Hash){Copy-Item -LiteralPath $NodePath -Destination $runtime -Force}
foreach($name in @('client.mjs','core.mjs','launch-control.mjs')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $homeDir $name) -Force}
@{repository=$Repository;branch=$Branch;allowUnsignedQA=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $homeDir 'config.json') -Encoding UTF8
$state=Join-Path $homeDir 'state.json'
if(!(Test-Path -LiteralPath $state)){@{commit=$InstalledCommit;version=$InstalledVersion;releaseId=0} | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8}
$node=Join-Path $homeDir 'runtime\node.exe'
$client=Join-Path $homeDir 'client.mjs'
$launcher=Join-Path $homeDir 'launch.vbs'
$vbs=@"
Set shell = CreateObject("WScript.Shell")
code = shell.Run("""$node"" ""$client"" --launch", 0, True)
If code <> 0 Then MsgBox "MALERA update/launch failed. Check %LOCALAPPDATA%\MALERA Update\status.json. Your database backup is preserved.", 48, "MALERA POS"
"@
Set-Content -LiteralPath $launcher -Value $vbs -Encoding ASCII
$checker=Join-Path $homeDir 'check.vbs'
Set-Content -LiteralPath $checker -Value @"
Set shell = CreateObject("WScript.Shell")
code = shell.Run("""$node"" ""$client"" --check-only", 0, True)
"@ -Encoding ASCII
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'MALERA POS.lnk'))
$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments='"'+$launcher+'"'
$shortcut.WorkingDirectory=$homeDir
$shortcut.Description='MALERA POS - installs tested GitHub updates before launch'
$shortcut.IconLocation=$app+',0'
$shortcut.Save()
$menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
Get-ChildItem -LiteralPath $menu -Filter '*.lnk' -Recurse | ForEach-Object {
 $link=$shell.CreateShortcut($_.FullName)
 if($link.TargetPath -eq $app){$link.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe';$link.Arguments='"'+$launcher+'"';$link.WorkingDirectory=$homeDir;$link.IconLocation=$app+',0';$link.Save()}
}
$action=New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('"'+$checker+'"') -WorkingDirectory $homeDir
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$logon=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'MALERA - Check GitHub updates' -Action $action -Trigger @($trigger,$logon) -Principal $principal -Settings $settings -Description "Stage tested releases from $Repository ($Branch); install only through the desktop launcher while POS is closed." -Force | Out-Null
Write-Output "Updates configured for $Repository branch $Branch. Check every 5 minutes; apply on next desktop launch."
