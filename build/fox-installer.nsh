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
