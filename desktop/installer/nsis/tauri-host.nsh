; Expand from the pinned Tauri template. NSIS owns the payload and registry.
Var RepoDitorInteractive

!macro RepoDitorSelectHost
  ; /S, /P and /UPDATE remain available to automation and the updater.
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode != 1
  ${AndIf} $UpdateMode != 1
    StrCpy $RepoDitorInteractive 1
    SetSilent silent
  ${EndIf}
!macroend

!macro RepoDitorShowHost
  ${If} $RepoDitorInteractive == 1
    InitPluginsDir
    SetOutPath "$PLUGINSDIR\RepoDitor"
    ClearErrors
    File /r "${REPODITOR_HOST}\*"
    ${IfNot} ${Errors}
      ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
      StrCpy $1 "false"
      ${If} $0 != ""
        StrCpy $1 "true"
      ${EndIf}
      ; Missing uninstall registration is normal for a fresh install.
      ClearErrors
      ExecWait '"$OUTDIR\RepoDitorInstallerHost.exe" --tauri true --engine "$EXEPATH" --registry-key "${UNINSTKEY}" --path "$INSTDIR" --scope-locked true --show-scope false --version "${VERSION}" --updated "$1"' $2
      ${IfNot} ${Errors}
        SetErrorLevel $2
        Quit
      ${EndIf}
    ${EndIf}
    MessageBox MB_ICONSTOP "RepoDitor could not open its setup window."
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro RepoDitorVerifyPath failure
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0)i.r2'
  StrCmp $2 0 ${failure}
  IntCmp $2 ${NSIS_MAX_STRLEN} ${failure} 0 ${failure}
  StrCpy $1 "$0" 2 1
  StrCmp $1 ":\" 0 ${failure}
  StrLen $1 "$0"
  IntCmp $1 3 ${failure} ${failure}
  StrCmp $0 "$INSTDIR" 0 ${failure}
  StrCpy $1 "$INSTDIR"
  ${DoWhile} $1 != ""
    System::Call 'kernel32::GetFileAttributesW(w r1)i.r2'
    ${If} $2 != -1
      IntOp $2 $2 & 0x400
      IntCmp $2 0 +2
      Goto ${failure}
    ${EndIf}
    ${GetParent} "$1" $2
    StrCmp $1 "$2" ${failure}
    StrCpy $1 "$2"
  ${Loop}
!macroend

!macro RepoDitorVerifyRegistration failure
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
  StrCmp $0 '$\"$INSTDIR$\"' 0 ${failure}
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "UninstallString"
  StrCmp $0 '$\"$INSTDIR\uninstall.exe$\"' 0 ${failure}
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "MainBinaryName"
  StrCmp $0 "${MAINBINARYNAME}.exe" 0 ${failure}
!macroend

!macro RepoDitorCheckDestination
  ; Check both the branded UI and the standalone /S engine before touching the destination.
  !insertmacro RepoDitorVerifyPath repoditor_unsafe_destination
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
  ${If} $0 != ""
    !insertmacro RepoDitorVerifyRegistration repoditor_unsafe_destination
  ${Else}
    ClearErrors
    FindFirst $0 $1 "$INSTDIR\*"
    repoditor_next_entry:
    IfErrors repoditor_finish_find
    StrCmp $1 "." repoditor_find_next
    StrCmp $1 ".." repoditor_find_next
    FindClose $0
    Goto repoditor_unsafe_destination
    repoditor_find_next:
    FindNext $0 $1
    Goto repoditor_next_entry
    repoditor_finish_find:
    FindClose $0
  ${EndIf}
  ClearErrors
  Goto repoditor_destination_ok
  repoditor_unsafe_destination:
    SetErrorLevel 12
    Quit
  repoditor_destination_ok:
!macroend

!macro RepoDitorUninstallHost
  ${GetOptions} $CMDLINE "/RDREMOVE" $0
  ${IfNot} ${Errors}
    ; Recheck the target when the worker actually starts after confirmation.
    IfSilent 0 repoditor_invalid_uninstall
    StrCmp $EXEPATH "$INSTDIR\uninstall.exe" repoditor_invalid_uninstall
    !insertmacro RepoDitorVerifyPath repoditor_invalid_uninstall
    !insertmacro RepoDitorVerifyRegistration repoditor_invalid_uninstall
    Goto repoditor_uninstall_ready
  ${EndIf}

  ${If} ${Silent}
  ${OrIf} $PassiveMode == 1
  ${OrIf} $UpdateMode == 1
    Goto repoditor_uninstall_ready
  ${EndIf}
  ; An in-place uninstall can be owned by the stock reinstall flow.
  StrCmp $EXEPATH "$INSTDIR\uninstall.exe" repoditor_uninstall_ready
  !insertmacro RepoDitorVerifyPath repoditor_invalid_uninstall
  !insertmacro RepoDitorVerifyRegistration repoditor_invalid_uninstall

  InitPluginsDir
  SetOutPath "$PLUGINSDIR\RepoDitor"
  ClearErrors
  File /r "${REPODITOR_HOST}\*"
  ${IfNot} ${Errors}
    ; We are already NSIS's temporary copy, so the worker can delete the installed executable.
    ExecWait '"$OUTDIR\RepoDitorInstallerHost.exe" --tauri true --mode uninstall --engine "$EXEPATH" --registry-key "${UNINSTKEY}" --path "$INSTDIR" --scope-locked true --show-scope false --version "${VERSION}"' $2
    ${IfNot} ${Errors}
    ${AndIf} $2 != 3
      SetErrorLevel $2
      Quit
    ${EndIf}
  ${EndIf}
  ; Native confirmation still works if the branded host cannot be staged or started.
  Goto repoditor_uninstall_ready

repoditor_invalid_uninstall:
  IfSilent +2 0
  MessageBox MB_ICONSTOP "RepoDitor could not verify the registered installation for removal."
  SetErrorLevel 2
  Quit
repoditor_uninstall_ready:
  ClearErrors
!macroend
