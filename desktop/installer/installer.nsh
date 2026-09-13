!include FileFunc.nsh
!include LogicLib.nsh

!define REPODITOR_HOST_DIR "${PROJECT_DIR}\build\installer-host"

Var RepoDitor.StageDirectory
Var RepoDitor.HostArguments
Var RepoDitor.ParentProcessId
Var RepoDitor.Scope

!macro RepoDitorStageWebViewHost
  System::Call 'kernel32::GetCurrentProcessId()i .r0'
  StrCpy $RepoDitor.ParentProcessId "$0"
  StrCpy $RepoDitor.StageDirectory "$TEMP\RepoDitorInstaller-$0"
  CreateDirectory "$RepoDitor.StageDirectory"
  SetOutPath "$RepoDitor.StageDirectory"
  File /r "${REPODITOR_HOST_DIR}\*"
!macroend

!ifndef BUILD_UNINSTALLER
  Var RepoDitor.InstallPath
  Var RepoDitor.CurrentUserPath
  Var RepoDitor.AllUsersPath
  Var RepoDitor.AllowExistingPath
  Var RepoDitor.Updated

  Function RepoDitor.ValidateInstallPath
    StrCpy $0 "0"
    ClearErrors
    GetFullPathName $1 "$RepoDitor.InstallPath"
    ${If} ${Errors}
      Return
    ${EndIf}

    System::Call 'shlwapi::PathIsNetworkPathW(w r1) i .r2'
    ${If} $2 != 0
      Return
    ${EndIf}
    System::Call 'shlwapi::PathIsRootW(w r1) i .r2'
    ${If} $2 != 0
      Return
    ${EndIf}
    System::Call 'shlwapi::PathIsPrefixW(w "$PROFILE\AppData\LocalLow\semiwork\Repo", w r1) i .r2'
    ${If} $2 != 0
      Return
    ${EndIf}

    System::Call 'kernel32::lstrcmpiW(w r1, w "$WINDIR") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}
    System::Call 'kernel32::lstrcmpiW(w r1, w "$SYSDIR") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}
    System::Call 'kernel32::lstrcmpiW(w r1, w "$PROFILE") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}
    System::Call 'kernel32::lstrcmpiW(w r1, w "$APPDATA") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}
    System::Call 'kernel32::lstrcmpiW(w r1, w "$LOCALAPPDATA") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}
    System::Call 'kernel32::lstrcmpiW(w r1, w "$PROGRAMFILES") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}
    System::Call 'kernel32::lstrcmpiW(w r1, w "$PROGRAMFILES64") i .r2'
    ${If} $2 == 0
      Return
    ${EndIf}

    System::Call 'kernel32::GetFileAttributesW(w r1) i .r2'
    ${If} $2 != -1
      IntOp $3 $2 & 0x400
      ${If} $3 != 0
        Return
      ${EndIf}

      ${If} $RepoDitor.AllowExistingPath != "1"
        ; electron-builder calls SetOutPath before customInit, which creates a fresh /D directory.
        ; Accept only that empty normal directory; RMDir fails safely for files or non-empty folders.
        SetOutPath "$TEMP"
        ClearErrors
        RMDir "$1"
        ${If} ${Errors}
          Return
        ${EndIf}
      ${EndIf}
    ${EndIf}

    StrCpy $RepoDitor.InstallPath $1
    StrCpy $0 "1"
  FunctionEnd

  !macro customInit
    StrCpy $RepoDitor.InstallPath "$INSTDIR"
    ${If} ${isUpdated}
      StrCpy $RepoDitor.AllowExistingPath "1"
      StrCpy $RepoDitor.Updated "true"
    ${Else}
      StrCpy $RepoDitor.AllowExistingPath "0"
      StrCpy $RepoDitor.Updated "false"

      ; Preserve electron-builder's install-over-existing lifecycle only for the
      ; exact registered location selected by initMultiUser.
      ${If} $installMode == "all"
        ${If} $perMachineInstallationFolder != ""
          System::Call 'kernel32::lstrcmpiW(w "$INSTDIR", w "$perMachineInstallationFolder") i .r0'
          ${If} $0 == 0
            StrCpy $RepoDitor.AllowExistingPath "1"
          ${EndIf}
        ${EndIf}
      ${Else}
        ${If} $perUserInstallationFolder != ""
          System::Call 'kernel32::lstrcmpiW(w "$INSTDIR", w "$perUserInstallationFolder") i .r0'
          ${If} $0 == 0
            StrCpy $RepoDitor.AllowExistingPath "1"
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}

    ${If} ${Silent}
      Call RepoDitor.ValidateInstallPath
      ${If} $0 != "1"
        SetErrorLevel 2
        Quit
      ${EndIf}
      StrCpy $INSTDIR "$RepoDitor.InstallPath"
    ${Else}
      StrCpy $RepoDitor.Scope "$installMode"

      !insertmacro setInstallModePerUser
      StrCpy $RepoDitor.CurrentUserPath "$INSTDIR"
      !insertmacro setInstallModePerAllUsers
      StrCpy $RepoDitor.AllUsersPath "$INSTDIR"

      ${If} $RepoDitor.Scope == "all"
        !insertmacro setInstallModePerAllUsers
      ${Else}
        !insertmacro setInstallModePerUser
        StrCpy $RepoDitor.Scope "current"
      ${EndIf}
      StrCpy $RepoDitor.InstallPath "$INSTDIR"

      !insertmacro RepoDitorStageWebViewHost
      StrCpy $RepoDitor.HostArguments '--mode install --engine "$EXEPATH" --registry-key "${INSTALL_REGISTRY_KEY}" --path "$RepoDitor.InstallPath" --current-path "$RepoDitor.CurrentUserPath" --all-path "$RepoDitor.AllUsersPath" --scope "$RepoDitor.Scope" --version "${VERSION}" --parent-pid "$RepoDitor.ParentProcessId" --updated "$RepoDitor.Updated" --scope-locked "$RepoDitor.Updated" --show-scope "true" --cleanup "true"'
      ClearErrors
      Exec '"$RepoDitor.StageDirectory\RepoDitorInstallerHost.exe" $RepoDitor.HostArguments'
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "RepoDitor Setup could not start its WebView2 interface."
        SetErrorLevel 2
      ${EndIf}
      Quit
    ${EndIf}
  !macroend
!else
  !define REPODITOR_FILE_ATTRIBUTE_DIRECTORY 0x10
  !define REPODITOR_FILE_ATTRIBUTE_REPARSE_POINT 0x400
  Var RepoDitor.ShowScope

  !macro customUnInit
    ${IfNot} ${Silent}
      StrCpy $RepoDitor.Scope "$installMode"
      ${If} $RepoDitor.Scope != "all"
        StrCpy $RepoDitor.Scope "current"
      ${EndIf}

      StrCpy $RepoDitor.ShowScope "false"
      ${If} $hasPerUserInstallation == "1"
      ${AndIf} $hasPerMachineInstallation == "1"
        StrCpy $RepoDitor.ShowScope "true"
      ${EndIf}

      !insertmacro RepoDitorStageWebViewHost
      ; NSIS keeps the installed outer uninstaller alive briefly after this temporary inner exits.
      ; Wait for that outer PID so electron-builder's broad app-running check cannot mistake it for RepoDitor.
      ${GetProcessInfo} 0 $0 $1 $2 $3 $4
      ${If} $1 != ""
        StrCpy $RepoDitor.ParentProcessId "$1"
      ${EndIf}
      ; Always relaunch the protected installed entry point. NSIS owns its temporary inner copy;
      ; the host verifies registry and payload removal after that process handoff.
      StrCpy $RepoDitor.HostArguments '--mode uninstall --engine "$INSTDIR\${UNINSTALL_FILENAME}" --registry-key "${UNINSTALL_REGISTRY_KEY}" --path "$INSTDIR" --current-path "$INSTDIR" --all-path "$INSTDIR" --scope "$RepoDitor.Scope" --version "${VERSION}" --parent-pid "$RepoDitor.ParentProcessId" --updated "false" --scope-locked "false" --show-scope "$RepoDitor.ShowScope" --cleanup "true"'
      ${If} ${UAC_IsAdmin}
        ${StdUtils.ExecShellAsUser} $0 "$RepoDitor.StageDirectory\RepoDitorInstallerHost.exe" "open" "$RepoDitor.HostArguments"
      ${Else}
        Exec '"$RepoDitor.StageDirectory\RepoDitorInstallerHost.exe" $RepoDitor.HostArguments'
      ${EndIf}
      Quit
    ${EndIf}
  !macroend

  ; Remove one exact RepoDitor-owned tree without following junctions or symlinks.
  Function un.RemoveRepoDitorData
    Exch $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5

    System::Call 'kernel32::GetFileAttributes(t R0)i .R1'
    StrCmp $R1 -1 done

    IntOp $R2 $R1 & ${REPODITOR_FILE_ATTRIBUTE_REPARSE_POINT}
    IntOp $R3 $R1 & ${REPODITOR_FILE_ATTRIBUTE_DIRECTORY}
    ${If} $R2 != 0
      ${If} $R3 != 0
        RMDir "$R0"
      ${Else}
        Delete "$R0"
      ${EndIf}
      Goto done
    ${EndIf}

    FindFirst $R1 $R2 "$R0\*.*"
    loop:
      StrCmp $R2 "" removeRoot
      StrCmp $R2 "." next
      StrCmp $R2 ".." next

      StrCpy $R3 "$R0\$R2"
      System::Call 'kernel32::GetFileAttributes(t R3)i .R4'
      StrCmp $R4 -1 next
      IntOp $R5 $R4 & ${REPODITOR_FILE_ATTRIBUTE_DIRECTORY}
      ${If} $R5 != 0
        Push "$R3"
        Call un.RemoveRepoDitorData
      ${Else}
        Delete "$R3"
      ${EndIf}

    next:
      FindNext $R1 $R2
      Goto loop

    removeRoot:
      FindClose $R1
      RMDir "$R0"

    done:
      Pop $R5
      Pop $R4
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
  FunctionEnd

  !macro customUnInstall
    ${IfNot} ${isUpdated}
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      Push "$APPDATA\repoditor-desktop"
      Call un.RemoveRepoDitorData
      Push "$LOCALAPPDATA\RepoDitor"
      Call un.RemoveRepoDitorData

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
