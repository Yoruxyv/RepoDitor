Var RepoDitor.ProgressSession
Var RepoDitor.ProgressHost
Var RepoDitor.ProgressPipe
Var RepoDitor.ExtractionAttempt
Var RepoDitor.CompletedBytes
Var RepoDitor.TotalBytes
Var RepoDitor.ProgressLine
Var RepoDitor.CallbackHadErrors
Var RepoDitor.CallbackAddress
Var RepoDitor.ProgressFault

Function RepoDitor.OpenProgressPipe
  Push $0
  Push $1
  Push $2
  StrCpy $RepoDitor.ProgressPipe "-1"
  StrCpy $RepoDitor.ProgressFault "0"
  ${GetOptions} $CMDLINE "--repoditor-progress=" $RepoDitor.ProgressSession
  ${If} $RepoDitor.ProgressSession != ""
    StrLen $0 $RepoDitor.ProgressSession
    ${If} $0 != 32
      Goto progress_connection_failed
    ${EndIf}
    ${GetOptions} $CMDLINE "--repoditor-progress-host=" $RepoDitor.ProgressHost
    ; FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, OPEN_EXISTING,
    ; SECURITY_SQOS_PRESENT
    ; with SECURITY_ANONYMOUS. The server cannot impersonate an elevated engine.
    System::Call 'kernel32::CreateFileW(w "\\.\pipe\RepoDitor.Extraction.$RepoDitor.ProgressSession", i 0x00100082, i 0, p 0, i 3, i 0x00100000, p 0) p .r0'
    ${If} $0 == -1
      Goto progress_connection_failed
    ${EndIf}
    StrCpy $RepoDitor.ProgressPipe $0
    System::Call 'kernel32::GetNamedPipeServerProcessId(p r0, *i .r1) i .r2'
    ${If} $2 == 0
    ${OrIf} $1 != $RepoDitor.ProgressHost
      System::Call 'kernel32::CloseHandle(p r0)'
      Goto progress_connection_failed
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
  Return
  progress_connection_failed:
    SetErrorLevel 3
    Quit
FunctionEnd

Function RepoDitor.ExtractionCallback
  ; The matching Nsis7z API pushes total, then completed. Pop completed first.
  ; These are raw UInt32 decimal strings; no byte arithmetic is done in NSIS.
  Pop $RepoDitor.CompletedBytes
  Pop $RepoDitor.TotalBytes
  Push $0
  Push $1
  Push $2
  StrCpy $RepoDitor.CallbackHadErrors "0"
  ${If} ${Errors}
    StrCpy $RepoDitor.CallbackHadErrors "1"
  ${EndIf}
  ${If} $RepoDitor.ProgressPipe != "-1"
    StrCpy $RepoDitor.ProgressLine "1|$RepoDitor.ProgressSession|$RepoDitor.ExtractionAttempt|$RepoDitor.CompletedBytes|$RepoDitor.TotalBytes$\n"
    StrLen $1 $RepoDitor.ProgressLine
    System::Call '*(&m128 "$RepoDitor.ProgressLine") p .r0'
    System::Call 'kernel32::WriteFile(p $RepoDitor.ProgressPipe, p r0, i r1, *i .r2, p 0) i .r1'
    System::Free $0
    ${If} $1 == 0
      StrCpy $RepoDitor.ProgressFault "1"
      System::Call 'kernel32::CloseHandle(p $RepoDitor.ProgressPipe)'
      StrCpy $RepoDitor.ProgressPipe "-1"
    ${EndIf}
  ${EndIf}
  ; Preserve callback registers, stack and error flag for upstream copy retries.
  ClearErrors
  ${If} $RepoDitor.CallbackHadErrors == "1"
    SetErrors
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
