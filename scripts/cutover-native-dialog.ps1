param([int]$FoxProcessId,[ValidateSet('backup','restore')][string]$Action,[string]$File,[switch]$NoConfirmation)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FoxOwnedDialogControl {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc callback, IntPtr l);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int size);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, string value);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, StringBuilder value);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
}
'@
$uia=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]
function Owned-Handle($Control,[string]$Class){
 $handle=[IntPtr]$Control.Current.NativeWindowHandle
 $owner=[uint32]0;[FoxOwnedDialogControl]::GetWindowThreadProcessId($handle,[ref]$owner) | Out-Null
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
  # BM_CLICK depends on foreground activation, which offscreen QA does not have.
  # Notify the actual owned dialog of its actual Button's BN_CLICKED instead.
  $buttonHandle=Owned-Handle $Control 'Button'
  if(-not [FoxOwnedDialogControl]::IsWindowEnabled($buttonHandle)){throw 'Owned native button is disabled'}
  $dialogHandle=[FoxOwnedDialogControl]::GetParent($buttonHandle)
  $dialogOwner=[uint32]0;[FoxOwnedDialogControl]::GetWindowThreadProcessId($dialogHandle,[ref]$dialogOwner) | Out-Null
  if($dialogOwner -ne $FoxProcessId){throw 'Native button dialog ownership failed'}
  [FoxOwnedDialogControl]::SendMessage($dialogHandle,0x0111,[IntPtr][FoxOwnedDialogControl]::GetDlgCtrlID($buttonHandle),$buttonHandle) | Out-Null
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
if(-not $edit -and $Action -eq 'restore'){
 # Observed Open hierarchy: ComboBoxEx32(1148) > ComboBox(1148) > Edit(1148).
 # Save has a different filename host. Never match the address/search Edit.
 $matches=[System.Collections.Generic.List[System.IntPtr]]::new()
 $callback=[FoxOwnedDialogControl+EnumProc]{param($h,$l)
  $className=[System.Text.StringBuilder]::new(128)
  [FoxOwnedDialogControl]::GetClassName($h,$className,128) | Out-Null
  if($className.ToString() -eq 'Edit' -and [FoxOwnedDialogControl]::GetDlgCtrlID($h) -eq 1148){$matches.Add($h)}
  return $true
 }
 [FoxOwnedDialogControl]::EnumChildWindows([IntPtr]$dialog.Current.NativeWindowHandle,$callback,[IntPtr]::Zero) | Out-Null
 if($matches.Count -ne 1){throw 'Expected exactly one owned Open filename Edit'}
 $edit=$uia::FromHandle($matches[0])
 $parent=$uia::FromHandle([FoxOwnedDialogControl]::GetParent($matches[0]))
 $parentHandle=Owned-Handle $parent 'ComboBox'
 $host=$uia::FromHandle([FoxOwnedDialogControl]::GetParent($parentHandle))
 $hostHandle=Owned-Handle $host 'ComboBoxEx32'
 if([FoxOwnedDialogControl]::GetDlgCtrlID($parentHandle) -ne 1148 -or [FoxOwnedDialogControl]::GetDlgCtrlID($hostHandle) -ne 1148 -or [FoxOwnedDialogControl]::GetParent($hostHandle) -ne [IntPtr]$dialog.Current.NativeWindowHandle){throw 'Owned Open filename hierarchy mismatch'}
}
if(-not $edit){
 $dialog.FindAll($scope::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
  Write-Output ("Owned QA control: {0} | {1} | {2}" -f $_.Current.ControlType.ProgrammaticName,$_.Current.AutomationId,$_.Current.Name)
 }
 $nativeControls=[System.Collections.Generic.List[string]]::new()
 $callback=[FoxOwnedDialogControl+EnumProc]{param($h,$l)
  $className=[System.Text.StringBuilder]::new(128)
  [FoxOwnedDialogControl]::GetClassName($h,$className,128) | Out-Null
  $nativeControls.Add(('Native owned control: {0} | id={1} | hwnd={2} | parent={3}' -f $className,[FoxOwnedDialogControl]::GetDlgCtrlID($h),$h,[FoxOwnedDialogControl]::GetParent($h)))
  return $true
 }
 [FoxOwnedDialogControl]::EnumChildWindows([IntPtr]$dialog.Current.NativeWindowHandle,$callback,[IntPtr]::Zero) | Out-Null
 $nativeControls | Write-Output
 throw 'Owned filename control not found inside FileNameControlHost'
}
$pattern=$null
if($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
 ([System.Windows.Automation.ValuePattern]$pattern).SetValue($File)
}else{
 $editHandle=Owned-Handle $edit 'Edit'
 # WM_SETTEXT updates visible text but the shell dialog can retain its cached
 # filename. Real Edit character input updates that model, like operator typing.
 [FoxOwnedDialogControl]::SendMessage($editHandle,0x00B1,[IntPtr]::Zero,[IntPtr](-1)) | Out-Null
 foreach($character in $File.ToCharArray()){
  [FoxOwnedDialogControl]::SendMessage($editHandle,0x0102,[IntPtr]([int]$character),[IntPtr]1) | Out-Null
 }
 $written=[System.Text.StringBuilder]::new(32768)
 # GetWindowText deliberately cannot read another process's Edit contents.
 [FoxOwnedDialogControl]::SendMessage($editHandle,0x000D,[IntPtr]32768,$written) | Out-Null
 if($written.ToString() -ne $File){throw 'Native filename input did not retain requested path'}
}
$button=$dialog.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::AutomationIdProperty,'1'))
if(-not $button){throw 'Owned file selection button not found'}
$selectionHandle=[IntPtr]$dialog.Current.NativeWindowHandle
Invoke-OwnedButton $button
for($attempt=0;$attempt -lt 100 -and [FoxOwnedDialogControl]::IsWindow($selectionHandle);$attempt++){Start-Sleep -Milliseconds 100}
if([FoxOwnedDialogControl]::IsWindow($selectionHandle)){throw 'Owned file dialog did not complete native selection'}
if($Action -eq 'restore' -and -not $NoConfirmation){
 $confirmation=Find-Window 'Rikthe nga backup'
 $confirm=$confirmation.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::NameProperty,'Rikthe backup-in'))
 if(-not $confirm){throw 'Owned deliberate restore confirmation not found'}
 Invoke-OwnedButton $confirm
}
Write-Output 'Owned native dialog completed'
