; Resolve the current user's actual Desktop, including redirected OneDrive folders.
; Keep electron-builder's normal shortcut name and deletion/keep-shortcuts rules.
; Do not delete folders or touch userData.
!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    Push $R0
    Push $R1
    Push $R2
    StrCpy $R2 0
    System::Call 'SHELL32::SHGetKnownFolderPath(g "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}", i 0, p 0, *p .r2)i.r1'
    ${If} $R1 == 0
      System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'
      ${If} $R0 != ""
        StrCpy $oldDesktopLink "$R0\$oldShortcutName.lnk"
      ${EndIf}
    ${EndIf}
    ${If} $R2 != 0
      System::Call 'OLE32::CoTaskMemFree(p r2)'
    ${EndIf}
    Pop $R2
    Pop $R1
    Pop $R0
  ${endif}
!macroend
