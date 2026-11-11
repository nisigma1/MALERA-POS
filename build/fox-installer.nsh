; Refresh the broker already registered for the default per-user installation.
; A single bundled file lets an upgrade keep using the old broker if the swap fails.
!macro customInstall
  Push $0
  Push $1
  Push $2
  ${If} $installMode == "CurrentUser"
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\FOX Kafeteri"
    StrCpy $0 "$LOCALAPPDATA\MALERA Update"
    ${If} ${FileExists} "$0\config.json"
    ${AndIf} ${FileExists} "$0\launch.vbs"
    ${AndIf} ${FileExists} "$0\runtime\node.exe"
    ${AndIf} ${FileExists} "$0\client.mjs"
      ClearErrors
      GetTempFileName $1 "$0"
      ${IfNot} ${Errors}
        System::Call 'kernel32::CopyFileW(w "$INSTDIR\resources\malera-update-client.mjs", w "$1", i 0)i.r2'
        ${If} $2 != 0
          System::Call 'kernel32::MoveFileExW(w "$1", w "$0\client.mjs", i 9)i.r2'
        ${EndIf}
        Delete "$1"
      ${EndIf}
      ${If} ${FileExists} "$DESKTOP\MALERA POS.lnk"
        CreateShortCut "$DESKTOP\MALERA POS.lnk" "$SYSDIR\wscript.exe" '$\"$0\launch.vbs$\"' "$INSTDIR\resources\duo-bar.ico" 0
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

; Resolve the current user's actual Desktop, including redirected OneDrive folders.
; Keep electron-builder's normal shortcut name and deletion/keep-shortcuts rules.
; Do not delete folders or touch userData.
!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    Push $0
    Push $1
    Push $2
    StrCpy $2 0
    System::Call 'SHELL32::SHGetKnownFolderPath(g "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}", i 0, p 0, *p .r2)i.r1'
    ${If} $1 == 0
      System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'
      ${If} $0 != ""
        StrCpy $oldDesktopLink "$0\$oldShortcutName.lnk"
      ${EndIf}
    ${EndIf}
    ${If} $2 != 0
      System::Call 'OLE32::CoTaskMemFree(p r2)'
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  ${endif}
!macroend
