param([int]$FoxProcessId,[string]$Title,[string]$File,[switch]$Desktop)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FoxWindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className,string name);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action,uint param,out Rect rect,uint flags);
}
'@
$uia=[System.Windows.Automation.AutomationElement]
$condition=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new($uia::ProcessIdProperty,$FoxProcessId),[System.Windows.Automation.PropertyCondition]::new($uia::NameProperty,$Title))
$window=$uia::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
if(-not $window){throw 'Exact owned screenshot window missing'}
$handle=[IntPtr]$window.Current.NativeWindowHandle
$owner=[uint32]0;[FoxWindowCapture]::GetWindowThreadProcessId($handle,[ref]$owner) | Out-Null
if($owner -ne $FoxProcessId){throw 'Screenshot window ownership mismatch'}
$rect=[FoxWindowCapture+Rect]::new();if(-not [FoxWindowCapture]::GetWindowRect($handle,[ref]$rect)){throw 'Screenshot bounds unavailable'}
$bitmap=[Drawing.Bitmap]::new($rect.right-$rect.left,$rect.bottom-$rect.top)
$graphics=[Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc()
try {if(-not [FoxWindowCapture]::PrintWindow($handle,$dc,[uint32]2)){throw 'Owned window capture failed'}} finally {$graphics.ReleaseHdc($dc);$graphics.Dispose()}
try {$bitmap.Save($File,[Drawing.Imaging.ImageFormat]::Png)} finally {$bitmap.Dispose()}
$workArea=[FoxWindowCapture+Rect]::new();[FoxWindowCapture]::SystemParametersInfo([uint32]48,[uint32]0,[ref]$workArea,[uint32]0) | Out-Null
$taskbar=[FoxWindowCapture]::FindWindow('Shell_TrayWnd',$null)
if($Desktop){
 if($env:GITHUB_ACTIONS -ne 'true'){throw 'Desktop capture is restricted to the disposable hosted Windows runner'}
 if(-not [FoxWindowCapture]::IsWindowVisible($taskbar)){throw 'Normal Windows taskbar not visible'}
 $screen=[Windows.Forms.SystemInformation]::VirtualScreen
 $desktopImage=[Drawing.Bitmap]::new($screen.Width,$screen.Height);$desktopGraphics=[Drawing.Graphics]::FromImage($desktopImage)
 try {$desktopGraphics.CopyFromScreen($screen.Left,$screen.Top,0,0,$screen.Size);$desktopImage.Save(($File+'.desktop.png'),[Drawing.Imaging.ImageFormat]::Png)} finally {$desktopGraphics.Dispose();$desktopImage.Dispose()}
}
@{title=$Title;ownedProcess=$FoxProcessId;dpi=[FoxWindowCapture]::GetDpiForWindow($handle);window=$rect;workArea=$workArea;taskbarVisible=[FoxWindowCapture]::IsWindowVisible($taskbar);capture='Owned HWND PrintWindow; desktop capture only on disposable CI'} | ConvertTo-Json -Depth 3 | Out-File ($File+'.json') -Encoding utf8
