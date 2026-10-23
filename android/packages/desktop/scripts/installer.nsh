!include "LogicLib.nsh"

; NSIS 설치기는 32비트이며, QueryFullProcessImageNameW는 64비트 대상도 조회한다.
!if ${NSIS_PTR_SIZE} != 4
  !error "PaseoDog installer requires 32-bit NSIS"
!endif

!macro paseodogProcessFunction prefix
Function ${prefix}paseodogProcesses
  Exch $R0 ; 0: 조회, 1: 동의한 설치 폴더의 프로세스 종료
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  StrCpy $R1 0 ; 0: 없음/종료 완료, 1: 실행 중, 2: 확인/종료 실패
  ${If} $INSTDIR == ""
    StrCpy $R1 2
    Goto process_return
  ${EndIf}
  GetFullPathName $R2 "$INSTDIR\"
  System::Call 'shlwapi::PathIsRootW(w R2) i.r2'
  ${If} $2 != 0
    StrCpy $R1 2
    Goto process_return
  ${EndIf}
  StrLen $R4 $R2
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0'
  ${If} $0 == -1
    StrCpy $R1 2
    Goto process_return
  ${EndIf}
  System::Alloc 556
  Pop $1
  ${If} $1 == 0
    StrCpy $R1 2
    Goto process_close_snapshot
  ${EndIf}
  System::Call '*$1(i 556)'

  ; 설치기 자신과 상위 설치기·제거기는 설치 폴더 안에서 실행해도 종료하지 않는다.
  StrCpy $8 "|"
  System::Call 'kernel32::GetCurrentProcessId() i.R3'
  ancestry:
    System::Call 'shlwapi::StrStrIW(w r8, w "|$R3|") p.r2'
    ${If} $2 != 0
      Goto scan_start
    ${EndIf}
    StrLen $9 $8
    IntOp $7 ${NSIS_MAX_STRLEN} - 12
    ${If} $9 > $7
      Goto process_error
    ${EndIf}
    StrCpy $8 "$8$R3|"
    System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2 ?e'
    Pop $7
    ancestry_entry:
      ${If} $2 == 0
        ${If} $7 != 18
          Goto process_error
        ${EndIf}
        Goto scan_start
      ${EndIf}
      System::Call '*$1(i,i,i.r3,i,i,i,i.r9)'
      ${If} $3 == $R3
        ${If} $9 == 0
          Goto scan_start
        ${EndIf}
        StrCpy $R3 $9
        Goto ancestry
      ${EndIf}
      System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2 ?e'
      Pop $7
      Goto ancestry_entry

  scan_start:
    System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2 ?e'
    Pop $7
  scan_entry:
    ${If} $2 == 0
      ${If} $7 != 18
        Goto process_error
      ${EndIf}
      Goto process_free
    ${EndIf}
    System::Call '*$1(i,i,i.r3,i,i,i,i,i,i,&w260.r5)'
    System::Call 'shlwapi::StrStrIW(w r8, w "|$3|") p.r2'
    ${If} $2 != 0
      Goto scan_next
    ${EndIf}
    System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r3) p.r4 ?e'
    Pop $7
    ${If} $4 == 0
      ; 이미 끝난 프로세스와 조회할 수 없는 시스템 프로세스는 대상이 아니다.
      ${If} $7 != 87
      ${AndIf} $5 == "${PRODUCT_FILENAME}.exe"
        Goto process_error
      ${EndIf}
      Goto scan_next
    ${EndIf}
    System::Call 'kernel32::QueryFullProcessImageNameW(p r4, i 0, w.r5, *i ${NSIS_MAX_STRLEN}) i.r2'
    ${If} $2 == 0
      System::Call 'kernel32::GetExitCodeProcess(p r4, *i.r2) i.r7'
      System::Call 'kernel32::CloseHandle(p r4)'
      ${If} $7 == 0
      ${OrIf} $2 == 259
        Goto process_error
      ${EndIf}
      Goto scan_next
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r4)'
    StrCpy $6 $5 $R4
    ${If} $6 != $R2
      Goto scan_next
    ${EndIf}
    ${If} $R0 == 0
      StrCpy $R1 1
      Goto process_free
    ${EndIf}

    ; PID 재사용으로 다른 프로그램을 종료하지 않도록 종료할 핸들에서 경로를 다시 확인한다.
    System::Call 'kernel32::OpenProcess(i 0x101001, i 0, i r3) p.r4 ?e'
    Pop $7
    ${If} $4 == 0
      ${If} $7 == 87
        Goto scan_next
      ${EndIf}
      Goto process_error
    ${EndIf}
    System::Call 'kernel32::QueryFullProcessImageNameW(p r4, i 0, w.r5, *i ${NSIS_MAX_STRLEN}) i.r2'
    StrCpy $6 $5 $R4
    ${If} $2 == 0
    ${OrIf} $6 != $R2
      System::Call 'kernel32::CloseHandle(p r4)'
      Goto process_error
    ${EndIf}
    System::Call 'kernel32::TerminateProcess(p r4, i 1) i.r2'
    ${If} $2 == 0
      System::Call 'kernel32::GetExitCodeProcess(p r4, *i.r2) i.r7'
      ${If} $7 == 0
      ${OrIf} $2 == 259
        System::Call 'kernel32::CloseHandle(p r4)'
        Goto process_error
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::WaitForSingleObject(p r4, i 5000) i.r2'
    System::Call 'kernel32::CloseHandle(p r4)'
    ${If} $2 != 0
      Goto process_error
    ${EndIf}
  scan_next:
    System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2 ?e'
    Pop $7
    Goto scan_entry

  process_error:
    StrCpy $R1 2
  process_free:
    System::Free $1
  process_close_snapshot:
    System::Call 'kernel32::CloseHandle(p r0)'
  process_return:
    StrCpy $R0 $R1
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Exch $R0
FunctionEnd
!macroend

!ifdef BUILD_UNINSTALLER
  !insertmacro paseodogProcessFunction "un."
!else
  !insertmacro paseodogProcessFunction ""
!endif

!macro paseodogProcessCall mode
  Push ${mode}
  !ifdef BUILD_UNINSTALLER
    Call un.paseodogProcesses
  !else
    Call paseodogProcesses
  !endif
  Pop $R0
!macroend

!macro customCheckAppRunning
  Push $R0
  !insertmacro paseodogProcessCall 0
  ${If} $R0 == 0
    Goto paseodog_processes_closed
  ${EndIf}
  ${If} $R0 != 1
    MessageBox MB_OK|MB_ICONSTOP "PaseoDog 설치 폴더의 실행 상태를 확인하지 못했습니다. 설치를 중단합니다." /SD IDOK
    SetErrorLevel 1603
    Quit
  ${EndIf}

  ; 무인 설치에서는 실행 중인 작업을 임의로 중단하지 않는다.
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "PaseoDog 설치 폴더의 프로그램이 실행 중입니다.$\r$\n$\r$\n앱과 백그라운드 프로세스를 모두 강제 종료하고 설치를 계속할까요? 진행 중인 작업이 중단되며 저장하지 않은 내용이 손실될 수 있습니다." /SD IDNO IDYES paseodog_close_processes
  SetErrorLevel 1602
  Quit

  paseodog_close_processes:
  !insertmacro paseodogProcessCall 1
  ${If} $R0 == 0
    !insertmacro paseodogProcessCall 0
    ${If} $R0 == 0
      Goto paseodog_processes_closed
    ${EndIf}
  ${EndIf}
  MessageBox MB_OK|MB_ICONSTOP "PaseoDog 프로세스를 종료하지 못해 설치를 중단합니다.$\r$\n$\r$\n설치 파일을 마우스 오른쪽 버튼으로 눌러 '관리자 권한으로 실행'한 뒤 다시 시도하세요." /SD IDOK
  SetErrorLevel 1603
  Quit

  paseodog_processes_closed:
  Pop $R0
!macroend

!macro paseodogCopyTreeFunction
Var paseodogCopySource
Var paseodogCopyDestination

; Shell 파일 복사에서 누락되는 긴 경로도 Win32 확장 경로로 복사하고 결과를 확인한다.
Function paseodogCopyTree
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  StrCpy $R3 0
  System::Call 'kernel32::CreateDirectoryW(w "\\?\$paseodogCopyDestination$R0", p 0) i.R4 ?e'
  Pop $R5
  ${If} $R4 == 0
  ${AndIf} $R5 != 183
    StrCpy $R3 "$R0 (Win32 $R5)"
    Goto copy_return
  ${EndIf}
  ClearErrors
  FindFirst $R1 $R2 "\\?\$paseodogCopySource$R0\*"
  IfErrors copy_find_error
  copy_entry:
    StrCmp $R2 "" copy_close
    StrCmp $R2 "." copy_next
    StrCmp $R2 ".." copy_next
    System::Call 'kernel32::GetFileAttributesW(w "\\?\$paseodogCopySource$R0\$R2") i.R4 ?e'
    Pop $R5
    ${If} $R4 == -1
      Goto copy_error
    ${EndIf}
    IntOp $R4 $R4 & 16
    ${If} $R4 != 0
      Push "$R0\$R2"
      Call paseodogCopyTree
      Pop $R3
      StrCmp $R3 0 copy_next copy_close
    ${EndIf}
    System::Call 'kernel32::CopyFileW(w "\\?\$paseodogCopySource$R0\$R2", w "\\?\$paseodogCopyDestination$R0\$R2", i 0) i.R4 ?e'
    Pop $R5
    ${If} $R4 == 0
      Goto copy_error
    ${EndIf}
  copy_next:
    FindNext $R1 $R2
    Goto copy_entry
  copy_error:
    StrCpy $R3 "$R0\$R2 (Win32 $R5)"
  copy_close:
    FindClose $R1
    Goto copy_return
  copy_find_error:
    System::Call 'kernel32::GetLastError() i.R5'
    StrCpy $R3 "$R0 (Win32 $R5)"
  copy_return:
    StrCpy $R0 $R3
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd
!macroend
