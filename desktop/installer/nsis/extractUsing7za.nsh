; Based on electron-builder 26.15.3 extractUsing7za. Only callback invocation,
; attempt boundaries and pipe lifetime differ; copy/retry/fallback stays upstream.
!macro extractUsing7za FILE
  Call RepoDitor.OpenProgressPipe
  StrCpy $RepoDitor.ExtractionAttempt "1"
  Push $OUTDIR
  CreateDirectory "$PLUGINSDIR\7z-out"
  ClearErrors
  SetOutPath "$PLUGINSDIR\7z-out"
  GetFunctionAddress $RepoDitor.CallbackAddress RepoDitor.ExtractionCallback
  Nsis7z::ExtractWithCallback "${FILE}" $RepoDitor.CallbackAddress
  Pop $R0
  SetOutPath $R0

  # Retry counter
  StrCpy $R1 0

  LoopExtract7za:
    IntOp $R1 $R1 + 1

    # Attempt to copy files in atomic way
    CopyFiles /SILENT "$PLUGINSDIR\7z-out\*" $OUTDIR
    IfErrors 0 DoneExtract7za

    DetailPrint `Can't modify "${PRODUCT_NAME}"'s files.`
    ${if} $R1 < 5
      # Try copying a few times before asking for a user action.
      Goto RetryExtract7za
    ${else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDRETRY IDCANCEL AbortExtract7za
    ${endIf}

    # Preserve the upstream last-resort direct extraction of the same archive.
    RMDir /r "$PLUGINSDIR\7z-out"
    StrCpy $RepoDitor.ExtractionAttempt "2"
    GetFunctionAddress $RepoDitor.CallbackAddress RepoDitor.ExtractionCallback
    Nsis7z::ExtractWithCallback "${FILE}" $RepoDitor.CallbackAddress
    Goto DoneExtract7za

  AbortExtract7za:
    Quit

  RetryExtract7za:
    Sleep 1000
    Goto LoopExtract7za

  DoneExtract7za:
    ${If} $RepoDitor.ProgressPipe != "-1"
      System::Call 'kernel32::CloseHandle(p $RepoDitor.ProgressPipe)'
      StrCpy $RepoDitor.ProgressPipe "-1"
    ${EndIf}
    ${If} $RepoDitor.ProgressFault == "1"
      SetErrorLevel 3
      Quit
    ${EndIf}
!macroend
