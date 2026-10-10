param([int]$FoxProcessId,[ValidateSet('backup','restore')][string]$Action,[string]$File,[switch]$NoConfirmation)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$uia=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]
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
# Common-dialog control IDs are reused by containers and file-type controls.
# Require the actual filename Edit, scoped to this owned dialog, and uniqueness.
$edits=$dialog.FindAll($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit))
$filenameEdits=@($edits | Where-Object { $_.Current.AutomationId -eq '1148' -or $_.Current.Name -eq 'File name:' })
if($filenameEdits.Count -ne 1){
 $dialog.FindAll($scope::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
  Write-Output ("Owned QA control: {0} | {1} | {2}" -f $_.Current.ControlType.ProgrammaticName,$_.Current.AutomationId,$_.Current.Name)
 }
 throw "Expected one owned filename Edit; found $($filenameEdits.Count)"
}
$edit=$filenameEdits[0]
([System.Windows.Automation.ValuePattern]$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($File)
$button=$dialog.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::AutomationIdProperty,'1'))
if(-not $button){throw 'Owned file selection button not found'}
([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
if($Action -eq 'restore' -and -not $NoConfirmation){
 $confirmation=Find-Window 'Rikthe nga backup'
 $confirm=$confirmation.FindFirst($scope::Descendants,[System.Windows.Automation.PropertyCondition]::new($uia::NameProperty,'Rikthe backup-in'))
 if(-not $confirm){throw 'Owned deliberate restore confirmation not found'}
 ([System.Windows.Automation.InvokePattern]$confirm.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
}
Write-Output 'Owned native dialog completed'
