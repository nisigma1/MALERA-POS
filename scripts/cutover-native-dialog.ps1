param([int]$FoxProcessId,[ValidateSet('backup','restore')][string]$Action,[string]$File,[switch]$NoConfirmation)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FoxOwnedDialogControl {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int size);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, string value);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
}
'@
$uia=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]
function Owned-Handle($Control,[string]$Class){
 $handle=[IntPtr]$Control.Current.NativeWindowHandle
 $owner=0u;[FoxOwnedDialogControl]::GetWindowThreadProcessId($handle,[ref]$owner) | Out-Null
 $className=[System.Text.StringBuilder]::new(128)
 [FoxOwnedDialogControl]::GetClassName($handle,$className,128) | Out-Null
 if($handle -eq [IntPtr]::Zero -or $owner -ne $FoxProcessId -or $className.ToString() -ne $Class){throw "Owned $Class HWND validation failed: $className"}
 return $handle
}
function Invoke-OwnedButton($Control){
 $pattern=$null
 if($Control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
  ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
 }else{
  # Hosted Windows can expose classic controls as Pane without UIA patterns.
  # BM_CLICK still activates the actual native Button, after PID/class checks.
  [FoxOwnedDialogControl]::SendMessage((Owned-Handle $Control 'Button'),0x00F5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
 }
}
function Find-Window([string]$Title){
 $condition=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new($uia::ProcessIdProperty,$FoxProcessId),[System.Windows.Automation.PropertyCondition]::new($uia::NameProperty,$Title))
 for($attempt=0;$attempt -lt 250;$attempt++){
  $window=$uia::RootElement.FindFirst($scope::Children,$condition)
  if($window){return $window};Start-Sleep -Milliseconds 100
 }
 throw "Owned FOX dialog did not appear: $Title"
}
$title=if($Action -eq 'backup'){'Krijo backup'}else{'Zgjidh backup për rikthim'}
$dialog=Find-Window $title
# The observed Windows dialog exposes FileNameControlHost and its child 1001;
# the same ID also occurs in the address bar, so scope to the filename host.
$hostControl=$dialog.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::AutomationIdProperty,'FileNameControlHost'))
$edit=if($hostControl){$hostControl.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::AutomationIdProperty,'1001'))}
if(-not $edit){
 $dialog.FindAll($scope::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
  Write-Output ("Owned QA control: {0} | {1} | {2}" -f $_.Current.ControlType.ProgrammaticName,$_.Current.AutomationId,$_.Current.Name)
 }
 throw 'Owned filename control not found inside FileNameControlHost'
}
$pattern=$null
if($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
 ([System.Windows.Automation.ValuePattern]$pattern).SetValue($File)
}else{
 [FoxOwnedDialogControl]::SendMessage((Owned-Handle $edit 'Edit'),0x000C,[IntPtr]::Zero,$File) | Out-Null
}
$button=$dialog.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::AutomationIdProperty,'1'))
if(-not $button){throw 'Owned file selection button not found'}
Invoke-OwnedButton $button
if($Action -eq 'restore' -and -not $NoConfirmation){
 $confirmation=Find-Window 'Rikthe nga backup'
 $confirm=$confirmation.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::NameProperty,'Rikthe backup-in'))
 if(-not $confirm){throw 'Owned deliberate restore confirmation not found'}
 Invoke-OwnedButton $confirm
}
Write-Output 'Owned native dialog completed'
